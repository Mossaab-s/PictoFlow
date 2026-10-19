import asyncio

import pytest

from app.ai.contracts import InterpretationProposal
from app.domain.pcl.entities import CommunicationBlock, ValidationAction
from tests.integration.test_ai_quality import interpreter
from tests.integration.test_communication import communication as communication
from tests.integration.test_communication import completed, event

pytestmark = pytest.mark.postgres


@pytest.mark.parametrize("noun", ["Caca", "Pipi"])
def test_natural_toileting_phrase_stays_proposed_until_human_choice_and_is_reusable(
    communication, noun
):
    service, profile, foreign_profile, _ = communication
    with service.units() as store:
        blocks = tuple(
            CommunicationBlock(
                profile_id=profile, canonical_intent=label, label=label, status="validated"
            )
            for label in ("Moi", noun)
        )
        for block in blocks:
            store.add(profile, block)
    text = f"Je voudrais faire {noun.lower()}."
    target = completed(service, profile, blocks)
    original_memory = service.memory(profile, validated=True)
    ai = interpreter(service)
    ai.provider.interpret.return_value = InterpretationProposal.model_validate(
        {
            "candidates": [
                {"intent": "request", "text": text, "confidence": 0.8},
                {
                    "intent": "request",
                    "text": f"Je voudrais faire {noun.lower()} et dormir.",
                    "confidence": 0.99,
                },
            ]
        }
    )
    decision = asyncio.run(ai.interpret(profile, target.id))
    assert [c.text for c in decision.candidates] == [text]
    candidate = decision.candidates[0]
    assert candidate.source == "openai-compatible"
    assert candidate.status == "proposed" and candidate.validated_text is None
    assert service.memory(profile, validated=True) == original_memory
    assert next(s for s in service.history(profile) if s.id == target.id) == target
    request = ai.request(profile, completed(service, profile, blocks).id)
    assert request.correction_examples == () and request.memory_examples == ()

    accepted = service.validate(event(profile, candidate, ValidationAction.CORRECT, text))
    following = completed(service, profile, blocks)
    request = ai.request(profile, following.id)
    assert request.correction_examples == (text,)
    assert [example.reference_id for example in request.memory_examples] == [accepted.id]
    before = service.memory(profile, validated=True)
    new_candidate = asyncio.run(ai.interpret(profile, following.id)).candidates[0]
    assert new_candidate.status == "proposed" and new_candidate.validated_text is None
    assert service.memory(profile, validated=True) == before

    # Identical labels in another profile do not inherit the accepted phrase.
    with service.units() as store:
        foreign_blocks = tuple(
            CommunicationBlock(
                profile_id=foreign_profile,
                canonical_intent=b.label,
                label=b.label,
                status="validated",
            )
            for b in blocks
        )
        for block in foreign_blocks:
            store.add(foreign_profile, block)
    foreign_request = ai.request(
        foreign_profile, completed(service, foreign_profile, foreign_blocks).id
    )
    assert foreign_request.correction_examples == () and foreign_request.memory_examples == ()

    service.validate(event(profile, accepted, ValidationAction.REJECT))
    withdrawn = ai.request(profile, completed(service, profile, blocks).id)
    assert withdrawn.correction_examples == () and withdrawn.memory_examples == ()
