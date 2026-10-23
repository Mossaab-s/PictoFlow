import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from app.ai.contracts import InterpretationProposal
from app.application.ai_context import context_for
from app.application.interpretation_reuse import InterpretationReuse
from app.domain.pcl.entities import CommunicationBlock, ValidationAction
from tests.integration.test_ai_quality import interpreter
from tests.integration.test_communication import communication as communication
from tests.integration.test_communication import completed, event
from tests.integration.test_interpretation_reuse import Cache

pytestmark = pytest.mark.postgres


def blocks_for(service, profile, labels, meanings=None):
    blocks = tuple(
        CommunicationBlock(
            profile_id=profile,
            canonical_intent=(meanings or {}).get(label, label),
            label=label,
            status="validated",
        )
        for label in labels
    )
    with service.units() as store:
        for block in blocks:
            store.add(profile, block)
    return blocks


def generate(ai, service, profile, blocks, candidates):
    target = completed(service, profile, blocks)
    ai.provider.interpret.return_value = InterpretationProposal.model_validate(
        {
            "candidates": candidates,
        }
    )
    return target, asyncio.run(ai.interpret(profile, target.id))


def test_missing_scene_touches_are_not_sent_or_imported_but_exact_acceptance_is_personal(
    communication,
):
    service, profile, foreign, _ = communication
    blocks = blocks_for(service, profile, ("Maman", "Papa", "Manger", "Maison"))
    ai = interpreter(service)
    meal = "Maman, Papa, je voudrais manger à la maison."
    _, source = generate(
        ai,
        service,
        profile,
        blocks,
        [
            {"intent": "request", "text": meal, "confidence": 0.9},
        ],
    )
    service.validate(event(profile, source.candidates[0], ValidationAction.CONFIRM))
    memory = service.memory(profile, validated=True)
    target, result = generate(
        ai,
        service,
        profile,
        blocks[:2],
        [
            {"intent": "request", "text": meal, "confidence": 0.99},
            {"intent": "other", "text": "Maman, Papa !", "confidence": 0.7},
        ],
    )
    assert ai.provider.interpret.call_args.args[0].memory_examples == ()
    assert [item.text for item in result.candidates] == ["Maman, Papa !"]
    assert service.memory(profile, validated=True) == memory
    # Explicit human correction can intentionally establish an implicit meaning
    # for the shorter alignment. It remains profile-specific and memory-first.
    service.validate(event(profile, result.candidates[0], ValidationAction.CORRECT, meal))
    following = completed(service, profile, blocks[:2])
    ai.provider.interpret = AsyncMock(side_effect=AssertionError("Memory should precede AI"))
    reuse = InterpretationReuse(ai, Cache(), {"version": 1})
    remembered = asyncio.run(reuse.interpret(profile, following.id))
    assert remembered.candidates[0].text == meal
    assert remembered.candidates[0].status == "proposed"
    foreign_blocks = blocks_for(service, foreign, ("Maman", "Papa"))
    foreign_target = completed(service, foreign, foreign_blocks)
    assert ai.request(foreign, foreign_target.id).memory_examples == ()


@pytest.mark.parametrize(
    "labels,linked,literal",
    [
        (
            ("Maman", "Papa", "Voiture", "Maison"),
            "Maman, Papa, on pourrait rentrer à la maison en voiture.",
            "Maman, Papa, la voiture est à la maison.",
        ),
        (
            ("Maman", "Télévision"),
            "Maman, je voudrais regarder la télévision.",
            "Maman, la télévision.",
        ),
    ],
)
def test_linking_hypotheses_are_capped_reviewable_and_cached_without_learning(
    communication, labels, linked, literal
):
    service, profile, _, _ = communication
    blocks = blocks_for(service, profile, labels)
    ai = interpreter(service)
    ai.provider.interpret.return_value = InterpretationProposal.model_validate(
        {
            "candidates": [
                {"intent": "request", "text": linked, "confidence": 0.99},
                {
                    "intent": "statement",
                    "text": literal,
                    "confidence": 0.6,
                },
            ],
        }
    )
    reuse = InterpretationReuse(ai, Cache(), {"version": 1})
    before = service.memory(profile, validated=True)
    original = completed(service, profile, blocks)
    first = asyncio.run(reuse.interpret(profile, original.id))
    assert len(first.candidates) == 2
    candidate = next(item for item in first.candidates if item.text == linked)
    assert candidate.confidence == service.policy.confirmation
    assert candidate.source == "openai-compatible" and candidate.status == "proposed"
    with service.units() as store:
        events = store.audit_history(
            profile, target_type="interpretation", target_id=candidate.id, limit=20
        )
        assert any(
            json.loads(e.new_state or "{}").get("presentation", {}).get("inferred_linking")
            for e in events
        )
    copied = asyncio.run(reuse.interpret(profile, completed(service, profile, blocks).id))
    assert ai.provider.interpret.await_count == 1
    assert [item.text for item in copied.candidates] == [item.text for item in first.candidates]
    assert all(item.confidence <= service.policy.confirmation for item in copied.candidates)
    assert context_for(service.units, profile, copied.candidates[0].id).reuse == "cache"
    assert service.memory(profile, validated=True) == before
    service.validate(event(profile, copied.candidates[0], ValidationAction.REJECT))
    assert service.memory(profile, validated=True) == before


@pytest.mark.parametrize("meaning", ["Couche", "Protection hygiénique"])
def test_couche_ambiguity_or_declared_noun_is_handled_without_automatic_learning(
    communication, meaning
):
    service, profile, _, _ = communication
    blocks = blocks_for(service, profile, ("Couche", "Maman", "Dormir"), {"Couche": meaning})
    ai = interpreter(service)
    before = service.memory(profile, validated=True)
    verb = "Maman, je me couche pour dormir."
    noun = "Maman, je voudrais une couche pour dormir."
    _, result = generate(
        ai,
        service,
        profile,
        blocks,
        [
            {"intent": "statement", "text": verb, "confidence": 0.99},
            {"intent": "request", "text": noun, "confidence": 0.6},
        ],
    )
    assert ai.provider.interpret.call_args.args[0].blocks[0].meaning == meaning
    if meaning == "Couche":
        assert {item.text for item in result.candidates} == {verb, noun}
        assert max(item.confidence for item in result.candidates) == service.policy.confirmation
        assert result.state == "confirmation_required"
    else:
        assert [item.text for item in result.candidates] == [noun]
    assert all(
        item.status == "proposed" and item.validated_text is None for item in result.candidates
    )
    assert service.memory(profile, validated=True) == before
