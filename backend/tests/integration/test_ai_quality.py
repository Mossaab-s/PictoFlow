import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.ai.contracts import InterpretationProposal
from app.ai.errors import ProviderPayloadError, ProviderUnavailableError
from app.application.interpretation import InterpretationService
from app.application.profile_archive import RestoreRequest, parse_archive
from app.application.semantic_space import SemanticSpace
from app.domain.pcl.entities import CommunicationBlock, HumanRole, Interpretation, ValidationAction
from app.infrastructure.postgres.ai_quality import quality_summary
from app.infrastructure.postgres.models import AuditRow, InterpretationRow
from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository
from app.infrastructure.postgres.profile_archives import PostgresProfileArchives
from app.infrastructure.postgres.semantic_space import PostgresSemanticUnits
from tests.integration.test_business_api import api as api
from tests.integration.test_communication import communication as communication
from tests.integration.test_communication import completed, event, proposal

pytestmark = pytest.mark.postgres
TEXT = "Bruit, stop : je veux partir."


def interpreter(service):
    provider = AsyncMock()
    provider.provider_id = "openai-compatible"
    provider.interpret.return_value = InterpretationProposal.model_validate(
        {"candidates": [{"intent": "request", "text": TEXT, "confidence": 0.8}]}
    )
    return InterpretationService(service.units, service, provider)


def correction(service, profile, blocks, text=TEXT):
    sequence = completed(service, profile, blocks)
    item, _ = proposal(service, profile, sequence)
    return service.validate(event(profile, item, ValidationAction.CORRECT, text)), sequence


def test_corrections_require_current_human_acceptance_exact_order_and_repetitions(communication):
    service, a, b, blocks = communication
    item, old = correction(service, a, blocks)
    target = completed(service, a, blocks)
    ai = interpreter(service)
    assert ai.request(a, target.id).correction_examples == (TEXT,)
    assert ai.request(a, old.id).correction_examples == ()
    assert ai.request(a, target.id, declared_context=("Maison",)).correction_examples == ()
    assert ai.request(a, completed(service, a, blocks[::-1]).id).correction_examples == ()
    assert ai.request(a, completed(service, a, (*blocks, blocks[0])).id).correction_examples == ()
    service.validate(event(a, item, ValidationAction.REJECT))
    assert ai.request(a, target.id).correction_examples == ()
    # Current corrected status without its typed human feedback is insufficient.
    with service.units() as store:
        forged = Interpretation(
            profile_id=a,
            sequence_id=old.id,
            text=TEXT,
            corrected_text=TEXT,
            status="corrected",
            source="fake",
            confidence=0.9,
        )
        store.add(a, forged)
    assert ai.request(a, target.id).correction_examples == ()
    with service.units() as store:
        assert (
            store.correction_examples(
                b,
                block_ids=target.block_ids,
                concept_ids=(),
                context_id=None,
                exclude_sequence_id=target.id,
            )
            == ()
        )


def test_foreign_and_unvalidated_memory_cannot_become_examples(communication):
    service, a, b, blocks = communication
    correction(service, a, blocks)
    with service.units() as store:
        foreign = tuple(
            CommunicationBlock(
                profile_id=b, label=w.label, canonical_intent=w.label, status="validated"
            )
            for w in blocks
        )
        for block in foreign:
            store.add(b, block)
    target = completed(service, b, foreign)
    assert interpreter(service).request(b, target.id).correction_examples == ()
    unaccepted, _ = proposal(service, b, target)
    service.validate(event(b, unaccepted, ValidationAction.CONFIRM))
    assert (
        interpreter(service).request(b, completed(service, b, foreign).id).correction_examples == ()
    )


@pytest.mark.parametrize("change", ["concept", "block"])
def test_changed_words_or_meanings_exclude_older_corrections(communication, change):
    service, a, _, blocks = communication
    correction(service, a, blocks)
    if change == "concept":
        semantic = SemanticSpace(PostgresSemanticUnits(service.units.factory))
        semantic.rename_concept(a, blocks[0].concept_id, "Bruit personnel")
    else:
        with service.units() as store:
            previous = store.get(a, CommunicationBlock, blocks[0].id)
            current = replace(previous, label="Bruit personnel")
            store.save(a, current)
            store.audit(a, "block_corrected", previous, current, "human:user")
    assert (
        interpreter(service).request(a, completed(service, a, blocks).id).correction_examples == ()
    )


def test_context_scope_and_lexical_guard_still_limit_personal_corrections(communication):
    service, a, _, blocks = communication
    correction(service, a, blocks, "Le bruit me gêne : je veux partir.")  # Drops Stop, adds a fact.
    target = completed(service, a, blocks)
    assert interpreter(service).request(a, target.id).correction_examples == ()
    correction(service, a, blocks)
    with service.units() as store:
        changed = replace(store.get(a, type(target), target.id), context_id=uuid4())
        store.save(a, changed)
    assert interpreter(service).request(a, target.id).correction_examples == ()


def test_examples_are_bounded_recent_unique_and_do_not_validate_new_proposals(communication):
    service, a, _, blocks = communication
    for text in (TEXT, "Bruit, stop, partir.", "Bruit ! Stop ! Partir !", "Stop, bruit, partir."):
        correction(service, a, blocks, text)
    correction(service, a, blocks, "Stop, bruit, partir.")
    correction(service, a, blocks, "Bruit " * 60 + "stop partir")  # Too long.
    target = completed(service, a, blocks)
    ai = interpreter(service)
    request = ai.request(a, target.id)
    assert request.correction_examples == (
        "Stop, bruit, partir.",
        "Bruit ! Stop ! Partir !",
        "Bruit, stop, partir.",
    )
    before = service.memory(a, validated=True)
    decision = asyncio.run(ai.interpret(a, target.id))
    assert decision.candidates[0].validated_text is None
    assert service.memory(a, validated=True) == before
    assert quality_summary(service.units, a).attempts_with_corrections == 1


def test_attempts_count_once_and_record_candidate_filtering_not_accuracy(communication):
    service, a, b, blocks = communication
    target = completed(service, a, blocks)
    ai = interpreter(service)
    ai.provider.interpret.return_value = InterpretationProposal.model_validate(
        {
            "candidates": [
                {"intent": "request", "text": "Je veux boire.", "confidence": 0.99},
                {"intent": "request", "text": TEXT, "confidence": 0.8},
                {"intent": "request", "text": TEXT, "confidence": 0.1},
            ]
        }
    )
    result = asyncio.run(ai.interpret(a, target.id))
    assert len(result.candidates) == 1
    current = result.candidates[0]
    service.validate(event(a, current, ValidationAction.CORRECT, TEXT))
    service.validate(event(a, current, ValidationAction.REJECT))
    summary = quality_summary(service.units, a)
    assert (summary.recorded_attempts, summary.provider_proposals) == (1, 1)
    assert (summary.received_candidates, summary.retained_candidates) == (3, 1)
    assert sum(summary.fallbacks.values()) == 0
    assert summary.interpretation_states["rejected"] == 1
    assert summary.human_actions == {"correct": 1, "confirm": 0, "reject": 1}
    assert quality_summary(service.units, b).recorded_attempts == 0


def test_attempt_receipt_and_proposals_roll_back_together(communication, monkeypatch):
    service, a, _, blocks = communication
    target = completed(service, a, blocks)
    original = PostgresPCLRepository.audit

    def failure(self, profile, event_type, *args, **kwargs):
        if event_type != "interpretation_attempt":
            raise RuntimeError("Late audit failure")
        return original(self, profile, event_type, *args, **kwargs)

    monkeypatch.setattr(PostgresPCLRepository, "audit", failure)
    with pytest.raises(RuntimeError):
        asyncio.run(interpreter(service).interpret(a, target.id))
    with service.units.factory.begin() as session:
        assert session.scalar(select(func.count()).select_from(InterpretationRow)) == 0
        assert (
            session.scalar(
                select(func.count())
                .select_from(AuditRow)
                .where(AuditRow.event_type == "interpretation_attempt")
            )
            == 0
        )


@pytest.mark.parametrize(
    "reason",
    [
        "disabled",
        "model_refusal",
        "unfaithful_words",
        "low_confidence",
        "invalid_payload",
        "unavailable",
    ],
)
def test_each_fallback_reason_is_durable_without_auto_validation(communication, reason):
    service, a, _, blocks = communication
    sequence = completed(service, a, blocks)
    ai = interpreter(service)
    if reason == "disabled":
        ai.provider.provider_id = "disabled"
    elif reason in ("invalid_payload", "unavailable"):
        ai.provider.interpret.side_effect = (
            ProviderPayloadError("Synthetic invalid response")
            if reason == "invalid_payload"
            else ProviderUnavailableError("Synthetic outage")
        )
    elif reason == "model_refusal":
        ai.provider.interpret.return_value = InterpretationProposal(status="not_understood")
    else:
        ai.provider.interpret.return_value = InterpretationProposal.model_validate(
            {
                "candidates": [
                    {
                        "intent": "test",
                        "text": "Je veux boire." if reason == "unfaithful_words" else TEXT,
                        "confidence": 0.1 if reason == "low_confidence" else 0.9,
                    }
                ]
            }
        )
    for _ in range(2):
        result = asyncio.run(ai.interpret(a, sequence.id))
        assert result.candidates[0].source == "pcl"
        assert result.candidates[0].validated_text is None
    summary = quality_summary(service.units, a)
    assert summary.recorded_attempts == summary.fallbacks[reason] == 2
    assert sum(summary.fallbacks.values()) == 2 and summary.retained_candidates == 0
    assert summary.human_actions == {"confirm": 0, "correct": 0, "reject": 0}


def test_quality_receipts_and_correction_evidence_survive_archive_restore(communication):
    service, a, _, blocks = communication
    correction(service, a, blocks)
    target = completed(service, a, blocks)
    asyncio.run(interpreter(service).interpret(a, target.id))
    archives = PostgresProfileArchives(service.units.factory)
    snapshot = parse_archive(archives.export(a))
    restored = archives.restore(
        RestoreRequest(
            request_id=uuid4(),
            actor_role=HumanRole.USER,
            confirm=True,
            display_name="Fictif restauré",
            snapshot=snapshot,
        )
    )
    assert quality_summary(service.units, restored.id) == quality_summary(service.units, a)
    with service.units() as store:
        new_blocks = store.list(restored.id, CommunicationBlock)
    by_label = {block.label: block for block in new_blocks}
    sequence = completed(service, restored.id, tuple(by_label[b.label] for b in blocks))
    assert interpreter(service).request(restored.id, sequence.id).correction_examples == (TEXT,)


def test_unrecognised_or_damaged_receipts_do_not_crash_aggregate_reader(communication):
    service, a, _, blocks = communication
    target = completed(service, a, blocks)
    with service.units() as store:
        for version in (1, "1", 999):
            store.audit(
                a,
                "interpretation_attempt",
                None,
                target,
                "fake",
                new_details={
                    "ai_quality": {
                        "version": version,
                        "fallback_reason": "unavailable",
                        "received_candidates": "unexpected text",
                        "retained_candidates": 10**30,
                        "correction_examples": {},
                    }
                },
            )
    summary = quality_summary(service.units, a)
    assert summary.recorded_attempts == 1
    assert summary.received_candidates == summary.retained_candidates == 0
    assert summary.attempts_with_corrections == 0


def test_quality_api_is_read_only_scoped_and_purge_removes_statistics(api):
    a = api.post("/api/v1/profiles").json()["id"]
    b = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{a}"
    block = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Boire",
            "pictogram_key": "drink",
            "actor_role": "user",
        },
    ).json()
    api.post(
        base + "/blocks/" + block["id"] + "/feedback",
        json={"action": "confirm", "actor_role": "user", "confirm_representation": True},
    ).raise_for_status()
    seq = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()["id"]
    path = base + "/sequences/" + seq
    api.post(path + "/selection", json={"action": "append", "block_id": block["id"]})
    api.post(path + "/selection", json={"action": "complete"})
    api.post(path + "/interpret", json={}).raise_for_status()
    before = api.get(base + "/audit").json()
    report = api.get(base + "/ai-quality").json()
    assert report["recorded_attempts"] == report["fallbacks"]["disabled"] == 1
    assert report["provider_proposals"] == report["received_candidates"] == 0
    assert "Boire" not in str(report) and a not in str(report) and seq not in str(report)
    assert api.get(base + "/audit").json() == before
    assert api.get(f"/api/v1/profiles/{b}/ai-quality").json()["recorded_attempts"] == 0
    assert api.get(f"/api/v1/profiles/{uuid4()}/ai-quality").status_code == 404
    api.delete(base + "/memory").raise_for_status()
    assert api.get(base + "/ai-quality").json()["recorded_attempts"] == 0
