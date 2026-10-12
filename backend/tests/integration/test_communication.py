import asyncio
import json
import os
from dataclasses import replace
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import sessionmaker

from app.ai.contracts import InterpretationCandidate, InterpretationProposal
from app.ai.manager import ProviderManager
from app.ai.providers.disabled import DisabledProvider
from app.ai.providers.fake import FakeFixtures, FakeProvider, InterpretationFixture
from app.application.audit import AuditService
from app.application.blocks import BlockService, RepresentationService
from app.application.communication import CommunicationService, InteractionMemory
from app.application.interpretation import InterpretationService
from app.application.semantic_space import SemanticNotFoundError, SemanticSpace
from app.application.transient import TransientKind, TransientStoreUnavailable
from app.config import Settings
from app.domain.pcl.confidence import HandlingState
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    Interpretation,
    InterpretationStatus,
    ProposalStatus,
    RelationType,
    Representation,
    RepresentationType,
    TargetType,
    UserCommunicationProfile,
    ValidationAction,
    ValidationEvent,
    utc_now,
)
from app.domain.pcl.gaps import GapStatus, SemanticGapCandidate
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.keyboard import KeyboardZone
from app.infrastructure.postgres.models import (
    AuditRow,
    ConceptRow,
    InterpretationRow,
    ValidationRow,
)
from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository, PostgresPCLUnits
from app.infrastructure.postgres.repositories import PostgresProfileRepository
from app.infrastructure.postgres.semantic_space import PostgresSemanticUnits
from app.infrastructure.redis.factory import create_transient_store

pytestmark = pytest.mark.postgres


@pytest.fixture
def communication(postgres_connection):
    factory = sessionmaker(
        bind=postgres_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    a, b = UserCommunicationProfile(), UserCommunicationProfile()
    with factory.begin() as session:
        for profile in (a, b):
            PostgresProfileRepository(session).add(profile)
    units = PostgresPCLUnits(factory)
    blocks = []
    with units() as store:
        for key in ("NOISE", "STOP", "LEAVE"):
            concept = Concept(profile_id=a.id, canonical_key=key, label=key)
            store.add(a.id, concept)
            block = CommunicationBlock(
                profile_id=a.id, concept_id=concept.id, label=key, status=ProposalStatus.VALIDATED
            )
            store.add(a.id, block)
            store.feedback(
                ValidationEvent(
                    profile_id=a.id,
                    target_type=TargetType.COMMUNICATION_BLOCK,
                    target_id=block.id,
                    action=ValidationAction.CONFIRM,
                )
            )
            blocks.append(block)
    return CommunicationService(units), a.id, b.id, tuple(blocks)


def completed(service, a, blocks):
    sequence = service.start(a, uuid4())
    for block in blocks:
        sequence = service.select(a, sequence.id, "append", block.id)
    return service.select(a, sequence.id, "complete")


def proposal(service, a, sequence, score=0.78):
    candidate = Interpretation(
        profile_id=a,
        sequence_id=sequence.id,
        text="Je veux sortir.",
        confidence=score,
        source="fake",
    )
    return candidate, service.propose(a, sequence.id, (candidate,), source="fake")


def event(a, candidate, action, correction=None):
    return ValidationEvent(
        profile_id=a,
        target_type=TargetType.INTERPRETATION,
        target_id=candidate.id,
        action=action,
        corrected_value=correction,
    )


def test_sequence_history_order_and_completion_do_not_promote_memory(communication):
    service, a, b, blocks = communication
    first = completed(service, a, blocks)
    second = completed(service, a, reversed(blocks))
    assert first.block_ids == tuple(block.id for block in blocks)
    assert second.block_ids == tuple(block.id for block in reversed(blocks))
    unfinished = service.start(a, uuid4())
    assert unfinished not in service.history(a)
    assert service.history(a) == (first, second)
    assert service.history(b) == ()
    assert service.memory(a, validated=True).interpretations == ()
    assert service.memory(a, validated=True).relations == ()
    assert service.memory(a, validated=True).sequences == ()


def test_correction_precedence_rejection_reconfirmation_and_append_only_history(communication):
    service, a, b, blocks = communication
    sequence = completed(service, a, blocks)
    item, decision = proposal(service, a, sequence)
    assert decision.state == HandlingState.CONFIRMATION_REQUIRED
    assert service.memory(a, validated=False).interpretations == (item,)
    assert service.memory(a, validated=True).interpretations == ()
    corrected = service.validate(event(a, item, ValidationAction.CORRECT, "Le bruit me gêne."))
    assert corrected.text == item.text and corrected.validated_text == "Le bruit me gêne."
    assert service.memory(a, validated=True).sequences == (sequence,)
    confirmed = service.validate(event(a, item, ValidationAction.CONFIRM))
    assert confirmed == corrected
    rejected = service.validate(event(a, item, ValidationAction.REJECT))
    assert rejected.corrected_text == corrected.corrected_text
    assert service.memory(a, validated=True).interpretations == ()
    again = service.validate(event(a, item, ValidationAction.CONFIRM))
    assert again.validated_text == corrected.corrected_text
    assert service.memory(b, validated=True).interpretations == ()
    with service.units() as store:
        facts = store.feedback_history(a, item.id)
        assert [e.action for e in facts] == ["correct", "confirm", "reject", "confirm"]
        assert facts[0].corrected_value == corrected.corrected_text
        with pytest.raises(DBAPIError), store.session.begin_nested():
            store.session.execute(
                ValidationRow.__table__.delete().where(ValidationRow.id == facts[0].id)
            )


def test_refusal_creates_no_meaning_and_cannot_be_confirmed(communication):
    service, a, _, blocks = communication
    sequence = completed(service, a, blocks)
    _, decision = proposal(service, a, sequence, 0.28)
    assert decision.state == HandlingState.NOT_UNDERSTOOD and decision.candidates == ()
    assert service.memory(a, validated=False).interpretations == ()
    assert service.memory(a, validated=True).interpretations == ()
    with service.units() as store:
        refusal = store.list(a, Interpretation)[0]
        assert refusal.text == "" and refusal.status == InterpretationStatus.NOT_UNDERSTOOD
    with pytest.raises(DomainInvariantError):
        service.validate(event(a, refusal, ValidationAction.CONFIRM))


def test_foreign_ids_and_uncompleted_sequences_cannot_be_used(communication):
    service, a, b, blocks = communication
    sequence = service.start(a, uuid4())
    for operation in (
        lambda: service.select(b, sequence.id, "append", blocks[0].id),
        lambda: service.select(b, service.start(b, uuid4()).id, "append", blocks[0].id),
    ):
        with pytest.raises(SemanticNotFoundError):
            operation()
    with pytest.raises(DomainInvariantError):
        proposal(service, a, sequence)
    finished = completed(service, a, blocks)
    item, _ = proposal(service, a, finished)
    with pytest.raises(SemanticNotFoundError):
        service.validate(event(b, item, ValidationAction.CONFIRM))


def test_feedback_and_audit_failures_roll_back_promotion(communication, monkeypatch):
    service, a, _, blocks = communication
    item, _ = proposal(service, a, completed(service, a, blocks))

    def fail(*args):
        raise RuntimeError("audit failed")

    monkeypatch.setattr(PostgresPCLRepository, "audit", fail)
    with pytest.raises(RuntimeError):
        service.validate(event(a, item, ValidationAction.CONFIRM))
    assert service.memory(a, validated=False).interpretations == (item,)
    with service.units() as store:
        assert store.feedback_history(a, item.id) == ()


def test_duplicate_feedback_does_not_overwrite_correction(communication):
    service, a, _, blocks = communication
    item, _ = proposal(service, a, completed(service, a, blocks))
    fact = event(a, item, ValidationAction.CORRECT, "Le bruit me gêne.")
    corrected = service.validate(fact)
    with pytest.raises(IntegrityError):
        service.validate(replace(fact, created_at=utc_now(), corrected_value="Autre sens"))
    assert service.memory(a, validated=True).interpretations == (corrected,)


def test_profile_memory_erasure_removes_history_and_keeps_other_profile(communication):
    service, a, b, blocks = communication
    item, _ = proposal(service, a, completed(service, a, blocks))
    service.validate(event(a, item, ValidationAction.CONFIRM))
    own = service.start(b, uuid4())
    service.purge(a)
    assert service.memory(a, validated=True).blocks == ()
    with service.units() as store:
        assert store.list(a, CommunicationSequence) == ()
        for row in (AuditRow, ValidationRow, ConceptRow, InterpretationRow):
            assert (
                store.session.scalar(
                    select(func.count()).select_from(row).where(row.profile_id == a)
                )
                == 0
            )
    with service.units() as store:
        assert store.get(b, CommunicationSequence, own.id) == own


@pytest.mark.redis
def test_session_cleanup_and_complete_erasure_are_scoped(communication):
    url = os.environ.get("PICTOFLOW_TEST_REDIS_URL")
    if not url:
        pytest.skip("Redis URL required")
    service, a, b, blocks = communication
    item, _ = proposal(service, a, completed(service, a, blocks))
    accepted = service.validate(event(a, item, ValidationAction.CONFIRM))

    async def scenario():
        store = create_transient_store(Settings(redis_url=url, _env_file=None))
        interaction = InteractionMemory(store)
        reference = uuid4()
        try:
            for profile in (a, b):
                await interaction.put(
                    profile,
                    TransientKind.SESSION,
                    reference,
                    {"selected_blocks": [str(blocks[0].id)]},
                    ttl_seconds=30,
                )
                await interaction.put(
                    profile, TransientKind.CONTEXT, reference, {"place": "gym"}, ttl_seconds=30
                )
            await interaction.clear(a, TransientKind.SESSION, reference)
            assert service.memory(a, validated=True).interpretations == (accepted,)
            await service.erase(a, store)
            assert await interaction.get(a, TransientKind.CONTEXT, reference) is None
            assert await interaction.get(b, TransientKind.SESSION, reference) is not None
            assert service.memory(a, validated=True).interpretations == ()
        finally:
            await store.delete_profile(a)
            await store.delete_profile(b)
            await store.aclose()

    asyncio.run(scenario())


def test_transient_outage_does_not_erase_persistent_memory(communication):
    service, a, _, blocks = communication
    item, _ = proposal(service, a, completed(service, a, blocks))
    accepted = service.validate(event(a, item, ValidationAction.CONFIRM))

    class Unavailable:
        async def delete_profile(self, profile_id):
            raise TransientStoreUnavailable("offline")

    with pytest.raises(TransientStoreUnavailable):
        asyncio.run(service.erase(a, Unavailable()))
    assert service.memory(a, validated=True).interpretations == (accepted,)


def test_end_to_end_gap_approval_block_validation_and_stable_keyboard(communication):
    service, a, b, blocks = communication
    block_service = BlockService(service.units)
    semantic = SemanticSpace(PostgresSemanticUnits(service.units.factory))
    discomfort = semantic.create_concept(a, "DISCOMFORT", "Gêne")
    for target, score in ((discomfort.id, 0.91), (blocks[2].concept_id, 0.84)):
        relation = semantic.create_relation(
            a, blocks[0].concept_id, target, RelationType.ASSOCIATED_WITH, score
        )
        semantic.confirm_relation(a, relation.id, actor_role="user")
    for position, block in enumerate(blocks):
        block_service.place(a, block.id, KeyboardZone.STABLE, position, actor_role="user")
    stable = block_service.keyboard(a)
    for index in range(6):
        sequence = completed(service, a, blocks)
        interpreter = InterpretationService(
            service.units, service, ProviderManager(DisabledProvider())
        )
        request = interpreter.request(a, sequence.id)
        fixtures = FakeFixtures(
            interpretations=(
                InterpretationFixture(
                    request=request,
                    response=InterpretationProposal(
                        candidates=(
                            InterpretationCandidate(
                                intent="LEAVE_DUE_TO_NOISE",
                                text="Le bruit me gêne et je veux partir.",
                                confidence=0.78,
                            ),
                        )
                    ),
                ),
            )
        )
        interpreter.provider = ProviderManager(FakeProvider(fixtures))
        decision = asyncio.run(interpreter.interpret(a, sequence.id))
        item = decision.candidates[0]
        if index < 5:
            service.validate(event(a, item, ValidationAction.CONFIRM))
    gaps = block_service.detect_gaps(a)
    assert len(gaps) == 1 and gaps[0].status == GapStatus.PROPOSED
    assert (gaps[0].occurrence_count, gaps[0].validated_count) == (6, 5)
    assert block_service.detect_gaps(a) == gaps
    assert block_service.detect_gaps(b) == ()
    assert block_service.keyboard(a) == stable
    with pytest.raises(DomainInvariantError):
        block_service.from_gap(a, gaps[0].id, "Sortir")
    block_service.decide_gap(a, gaps[0].id, approve=True, actor_role="user")
    candidate = block_service.from_gap(a, gaps[0].id, "Le bruit me gêne, je veux sortir")
    assert candidate.status == "proposed" and candidate.origin == "pcl_suggestion"
    assert block_service.keyboard(a) == stable
    activated = block_service.validate(a, candidate.id, action="confirm", actor_role="user")
    assert activated.stability == "adaptive"
    projected = block_service.keyboard(a)
    assert tuple(p for p in projected if p.zone == KeyboardZone.STABLE) == stable
    assert [p.block_id for p in projected if p.zone == KeyboardZone.ADAPTIVE] == [candidate.id]
    assert block_service.detect_gaps(a) == ()
    assert len(service.memory(a, validated=True).relations) == 2
    replaced = block_service.replace_visual(a, activated.id, "local-image.svg")
    assert replaced.canonical_intent == activated.canonical_intent
    assert replaced.semantic_gap_id == activated.semantic_gap_id
    with service.units() as store:
        assert store.get(a, SemanticGapCandidate, gaps[0].id).status == GapStatus.RESOLVED


def test_no_provider_interpretation_and_rejected_evidence_cannot_create_gap(communication):
    service, a, _, blocks = communication
    block_service = BlockService(service.units)
    for _ in range(6):
        sequence = completed(service, a, blocks)
        interpreter = InterpretationService(
            service.units, service, ProviderManager(DisabledProvider())
        )
        decision = asyncio.run(interpreter.interpret(a, sequence.id))
        assert decision.state == HandlingState.MULTIPLE_HYPOTHESES
        assert decision.candidates[0].source == "pcl"
        service.validate(event(a, decision.candidates[0], ValidationAction.REJECT))
    assert block_service.detect_gaps(a) == ()


def test_representation_update_and_archive_preserve_concept_and_provenance(communication):
    service, a, b, blocks = communication
    representations = RepresentationService(service.units)
    concept_id = blocks[0].concept_id
    original = representations.create(
        Representation(
            profile_id=a,
            concept_id=concept_id,
            type=RepresentationType.PICTOGRAM,
            source="external-library",
            license="test-license",
            attribution="test-author",
            commercial_use_allowed=False,
        )
    )
    text = representations.create(
        Representation(
            profile_id=a,
            concept_id=concept_id,
            type=RepresentationType.TEXT,
            source="user",
            label="Bruit",
        )
    )
    changed = representations.update(a, original.id, asset_reference="replacement.svg")
    assert changed.concept_id == original.concept_id
    assert changed.license == original.license and changed.attribution == original.attribution
    archived = representations.archive(a, original.id)
    assert archived.status == "archived"
    with service.units() as store:
        assert store.get(a, Concept, concept_id).id == concept_id
        assert store.get(a, Representation, text.id) == text
    with pytest.raises(SemanticNotFoundError):
        representations.archive(b, original.id)
    with pytest.raises(DomainInvariantError):
        representations.update(a, original.id, concept_id=uuid4())


def test_audit_records_corrections_rejections_layout_and_profile_scope(communication):
    service, a, b, blocks = communication
    item, _ = proposal(service, a, completed(service, a, blocks))
    service.validate(event(a, item, ValidationAction.CORRECT, "Le bruit me gêne."))
    service.validate(event(a, item, ValidationAction.REJECT))
    audit = AuditService(service.units)
    history = audit.history(a, target_type=TargetType.INTERPRETATION, target_id=item.id)
    assert [e.event_type for e in history] == [
        "interpretation_confirmation_required",
        "interpretation_correct",
        "interpretation_reject",
    ]
    assert json.loads(history[1].previous_state)["text"] == item.text
    assert json.loads(history[1].new_state)["corrected_text"] == "Le bruit me gêne."
    assert audit.history(b, target_type=TargetType.INTERPRETATION, target_id=item.id) == ()
    assert service.memory(a, validated=True).interpretations == ()
    block_service = BlockService(service.units)
    block_service.place(a, blocks[0].id, KeyboardZone.STABLE, 4, actor_role="user")
    layout_history = audit.history(
        a, target_type=TargetType.COMMUNICATION_BLOCK, target_id=blocks[0].id
    )
    assert json.loads(layout_history[-1].new_state)["presentation"]["position"] == 4


def test_gap_rejection_block_rejection_and_foreign_access_preserve_history(communication):
    service, a, b, blocks = communication
    block_service = BlockService(service.units)
    for _ in range(5):
        item, _ = proposal(service, a, completed(service, a, blocks))
        service.validate(event(a, item, ValidationAction.CONFIRM))
    gap = block_service.detect_gaps(a)[0]
    rejected = block_service.decide_gap(a, gap.id, approve=False, actor_role="caregiver")
    assert block_service.detect_gaps(a) == (rejected,)
    with pytest.raises(DomainInvariantError):
        block_service.from_gap(a, gap.id, "Sortir")
    with pytest.raises(SemanticNotFoundError):
        block_service.decide_gap(b, gap.id, approve=True, actor_role="user")
    block_service.decide_gap(a, gap.id, approve=True, actor_role="user")
    candidate = block_service.from_gap(a, gap.id, "Sortir")
    with pytest.raises(DomainInvariantError):
        block_service.from_gap(a, gap.id, "Doublon")
    block_service.validate(
        a, candidate.id, action="correct", actor_role="user", label="Aller dehors"
    )
    block_service.validate(a, candidate.id, action="reject", actor_role="user")
    assert candidate.id not in [p.block_id for p in block_service.keyboard(a)]
    with pytest.raises(SemanticNotFoundError):
        block_service.replace_visual(b, candidate.id, "other.svg")
    with service.units() as store:
        assert store.get(a, CommunicationBlock, candidate.id).label == "Aller dehors"
    assert (
        AuditService(service.units)
        .history(a, target_type=TargetType.COMMUNICATION_BLOCK, target_id=candidate.id)[-1]
        .event_type
        == "block_reject"
    )
