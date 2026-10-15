import asyncio
from dataclasses import replace

import pytest

from app.ai.contracts import InterpretationProposal
from app.domain.pcl.entities import CommunicationBlock, Interpretation, ValidationAction
from tests.integration.test_ai_quality import correction, interpreter
from tests.integration.test_communication import communication as communication
from tests.integration.test_communication import completed, event, proposal

pytestmark = pytest.mark.postgres


def test_accepted_associations_include_confirmations_corrections_and_similar_sequences(
    communication,
):
    service, profile, _, blocks = communication
    corrected, _ = correction(service, profile, blocks, "Ce bruit me fatigue, je veux sortir.")
    source = completed(service, profile, blocks[:2])
    confirmed, _ = proposal(service, profile, source)
    service.validate(event(profile, confirmed, ValidationAction.CONFIRM))
    # Current order can differ; the original order and actual accepted wording are sent.
    target = completed(service, profile, blocks[::-1])
    request = interpreter(service).request(profile, target.id)
    assert request.correction_examples == ()
    assert {e.reference_id for e in request.memory_examples} == {corrected.id, confirmed.id}
    assert request.memory_examples[0].text == corrected.corrected_text
    assert [b.block_id for b in request.memory_examples[0].blocks] == [b.id for b in blocks]
    service.validate(event(profile, corrected, ValidationAction.REJECT))
    assert {
        e.reference_id for e in interpreter(service).request(profile, target.id).memory_examples
    } == {confirmed.id}


def test_current_typed_acceptance_scope_and_excluded_current_message(communication):
    service, profile, foreign, blocks = communication
    accepted, source = correction(service, profile, blocks)
    assert interpreter(service).request(profile, source.id).memory_examples == ()
    with service.units() as store:
        forged = Interpretation(
            profile_id=profile,
            sequence_id=source.id,
            text="Forged",
            source="fake",
            confidence=0.9,
            status="confirmed",
        )
        store.add(profile, forged)
    with service.units() as store:
        other_blocks = tuple(
            CommunicationBlock(
                profile_id=foreign, label=b.label, canonical_intent=b.label, status="validated"
            )
            for b in blocks
        )
        for block in other_blocks:
            store.add(foreign, block)
    target = completed(service, profile, blocks)
    assert [
        e.reference_id for e in interpreter(service).request(profile, target.id).memory_examples
    ] == [accepted.id]
    assert (
        interpreter(service)
        .request(foreign, completed(service, foreign, other_blocks).id)
        .memory_examples
        == ()
    )


def test_frequency_counts_distinct_messages_and_meaning_changes_remove_old_associations(
    communication,
):
    service, profile, _, blocks = communication
    item, _ = correction(service, profile, blocks)
    service.validate(event(profile, item, ValidationAction.CORRECT, item.corrected_text))
    correction(service, profile, blocks)
    target = completed(service, profile, blocks)
    assert interpreter(service).request(profile, target.id).memory_examples[0].occurrences == 2
    with service.units() as store:
        old = store.get(profile, CommunicationBlock, blocks[0].id)
        changed = replace(old, label="Nouveau mot")
        store.save(profile, changed)
        store.audit(profile, "block_corrected", old, changed, "human:user")
    assert interpreter(service).request(profile, target.id).memory_examples == ()


def test_new_hypotheses_are_still_unaccepted_and_old_sources_unchanged(communication):
    service, profile, _, blocks = communication
    correction(service, profile, blocks, "Ce bruit me fatigue.")
    target = completed(service, profile, blocks)
    ai = interpreter(service)
    before = service.memory(profile, validated=True)
    ai.provider.interpret.return_value = InterpretationProposal.model_validate(
        {
            "candidates": [
                {"intent": "request", "text": "Bruit, stop : je veux partir.", "confidence": 0.9}
            ]
        }
    )
    result = asyncio.run(ai.interpret(profile, target.id))
    assert len(ai.provider.interpret.call_args.args[0].memory_examples) == 1
    assert all(c.validated_text is None for c in result.candidates)
    assert service.memory(profile, validated=True) == before
