import asyncio

import pytest

from app.ai.contracts import InterpretationProposal
from app.application.ai_context import context_for
from app.application.memory_vocabulary import MemorySuggestionConflict
from app.application.profile_archive import RestoreRequest, parse_archive
from app.domain.pcl.entities import HumanRole, ValidationAction
from app.infrastructure.postgres.profile_archives import PostgresProfileArchives
from tests.integration.test_ai_quality import correction, interpreter
from tests.integration.test_communication import communication as communication
from tests.integration.test_communication import completed, event

pytestmark = pytest.mark.postgres
TEXT = "Ce bruit me fatigue : stop, je veux partir."


def hypothesis(service, profile, blocks):
    source, _ = correction(service, profile, blocks, TEXT)
    target = completed(service, profile, blocks)
    ai = interpreter(service)
    ai.provider.interpret.return_value = InterpretationProposal.model_validate(
        {"candidates": [{"intent": "personal", "text": TEXT, "confidence": 0.99}]}
    )
    return source, target, ai


def test_personal_hypothesis_requires_human_choice_and_becomes_next_reference(communication):
    service, profile, _, blocks = communication
    source, target, ai = hypothesis(service, profile, blocks)
    before = service.memory(profile, validated=True)
    decision = asyncio.run(ai.interpret(profile, target.id))
    assert decision.state == "confirmation_required"
    candidate = decision.candidates[0]
    assert candidate.confidence == service.policy.confirmation
    assert candidate.validated_text is None
    assert service.memory(profile, validated=True) == before
    context = context_for(service.units, profile, candidate.id)
    assert context.personal_hypothesis
    assert context.references[0].interpretation_id == source.id
    assert context.references[0].text == TEXT
    service.validate(event(profile, candidate, ValidationAction.CONFIRM))
    service.validate(event(profile, source, ValidationAction.REJECT))
    assert not context_for(service.units, profile, candidate.id).references[0].available
    future = ai.request(profile, completed(service, profile, blocks).id)
    assert [e.reference_id for e in future.memory_examples] == [candidate.id]


@pytest.mark.parametrize("personal_score", [0.99, 0.4, 0.39])
def test_personal_priority_keeps_generic_alternatives_and_requires_explicit_acceptance(
    communication, personal_score
):
    service, profile, _, blocks = communication
    source, target, ai = hypothesis(service, profile, blocks)
    literal = "Bruit, stop : je veux partir."
    ai.provider.interpret.return_value = InterpretationProposal.model_validate(
        {
            "candidates": [
                {"intent": "literal", "text": literal, "confidence": 0.98},
                {"intent": "personal", "text": TEXT, "confidence": personal_score},
                {"intent": "literal", "text": "Stop, bruit : je veux partir.", "confidence": 0.8},
            ]
        }
    )
    before = service.memory(profile, validated=True)
    decision = asyncio.run(ai.interpret(profile, target.id))
    assert service.memory(profile, validated=True) == before
    assert all(item.status == "proposed" for item in decision.candidates)
    assert all(item.validated_text is None for item in decision.candidates)
    if personal_score < service.policy.refusal:
        assert len(decision.candidates) == 2
        assert decision.candidates[0].text == literal
        assert decision.state == "proposal"
        return
    personal, generic, other = decision.candidates
    assert personal.text == TEXT and generic.text == literal
    assert personal.confidence == min(personal_score, service.policy.confirmation)
    assert (generic.confidence, other.confidence) == (0.98, 0.8)
    assert decision.state == (
        "confirmation_required"
        if personal_score >= service.policy.confirmation
        else "multiple_hypotheses"
    )
    context = context_for(service.units, profile, personal.id)
    assert context.personal_hypothesis
    assert context.references[0].interpretation_id == source.id
    assert not context_for(service.units, profile, generic.id).personal_hypothesis
    service.validate(event(profile, personal, ValidationAction.REJECT))
    assert service.memory(profile, validated=True) == before
    assert (
        service.validate(event(profile, generic, ValidationAction.CONFIRM)).validated_text
        == literal
    )


def test_source_withdrawal_blocks_unaccepted_hypothesis_but_never_blocks_rejection(communication):
    service, profile, _, blocks = communication
    source, target, ai = hypothesis(service, profile, blocks)
    candidate = asyncio.run(ai.interpret(profile, target.id)).candidates[0]
    service.validate(event(profile, source, ValidationAction.REJECT))
    with pytest.raises(MemorySuggestionConflict):
        service.validate(event(profile, candidate, ValidationAction.CONFIRM))
    assert service.validate(event(profile, candidate, ValidationAction.REJECT)).status == "rejected"


def test_source_changed_while_model_is_running_does_not_persist_stale_hypothesis(communication):
    service, profile, _, blocks = communication
    source, target, ai = hypothesis(service, profile, blocks)
    output = ai.provider.interpret.return_value

    async def changed(request):
        service.validate(event(profile, source, ValidationAction.REJECT))
        return output

    ai.provider.interpret.side_effect = changed
    with pytest.raises(MemorySuggestionConflict):
        asyncio.run(ai.interpret(profile, target.id))
    assert all(
        i.sequence_id != target.id for i in service.memory(profile, validated=False).interpretations
    )


def test_personal_reference_provenance_survives_restore_with_new_profile_ids(communication):
    from uuid import uuid4

    service, profile, _, blocks = communication
    source, target, ai = hypothesis(service, profile, blocks)
    candidate = asyncio.run(ai.interpret(profile, target.id)).candidates[0]
    archives = PostgresProfileArchives(service.units.factory)
    restored = archives.restore(
        RestoreRequest(
            request_id=uuid4(),
            actor_role=HumanRole.USER,
            confirm=True,
            display_name="Mémoire fictive restaurée",
            snapshot=parse_archive(archives.export(profile)),
        )
    )
    items = service.memory(restored.id, validated=False).interpretations
    copied = next(i for i in items if i.text == candidate.text and i.status == "proposed")
    evidence = context_for(service.units, restored.id, copied.id)
    assert evidence.personal_hypothesis
    assert evidence.references[0].interpretation_id != source.id
    assert evidence.references[0].text == TEXT


def test_editing_a_source_meaning_blocks_first_acceptance_and_hides_stale_reference(communication):
    from dataclasses import replace

    from app.domain.pcl.entities import Concept

    service, profile, _, blocks = communication
    source, target, ai = hypothesis(service, profile, blocks)
    candidate = asyncio.run(ai.interpret(profile, target.id)).candidates[0]
    with service.units() as store:
        before = store.get(profile, Concept, blocks[0].concept_id)
        after = replace(before, label="Un autre sens personnel")
        store.save(profile, after)
        store.audit(profile, "concept_renamed", before, after, "human:user")
    assert not context_for(service.units, profile, candidate.id).references[0].available
    with pytest.raises(MemorySuggestionConflict):
        service.validate(event(profile, candidate, ValidationAction.CONFIRM))
