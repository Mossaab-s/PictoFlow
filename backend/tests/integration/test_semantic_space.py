"""SEM-002 acceptance against migrated PostgreSQL, including atomic history writes."""

from dataclasses import replace
from uuid import uuid4

import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.application.semantic_space import SemanticNotFoundError, SemanticSpace
from app.domain.pcl.entities import (
    HumanRole,
    RelationStatus,
    RelationType,
    TargetType,
    UserCommunicationProfile,
    ValidationAction,
    ValidationEvent,
    utc_now,
)
from app.domain.pcl.invariants import DomainInvariantError
from app.infrastructure.postgres.models import ValidationRow
from app.infrastructure.postgres.repositories import PostgresProfileRepository
from app.infrastructure.postgres.semantic_space import (
    PostgresSemanticRepository,
    PostgresSemanticUnits,
)
from tests.integration.conftest import migration_config

pytestmark = pytest.mark.postgres


@pytest.fixture
def space(postgres_connection):
    factory = sessionmaker(
        bind=postgres_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    with factory.begin() as session:
        profiles = (UserCommunicationProfile(), UserCommunicationProfile())
        for profile in profiles:
            PostgresProfileRepository(session).add(profile)
    units = PostgresSemanticUnits(factory)
    return SemanticSpace(units), profiles[0].id, profiles[1].id


def pair(service, profile_id):
    noise = service.create_concept(profile_id, "NOISE", "Bruit")
    leave = service.create_concept(profile_id, "LEAVE", "Partir")
    relation = service.create_relation(
        profile_id, noise.id, leave.id, RelationType.ASSOCIATED_WITH, 0.82
    )
    return noise, leave, relation


def test_acceptance_only_validated_personal_neighbors_are_returned(space):
    service, a, b = space
    noise, leave, leaving = pair(service, a)
    headphones = service.create_concept(a, "HEADPHONES", "Casque")
    fear = service.create_concept(a, "FEAR", "Peur")
    wearing = service.create_relation(
        a, noise.id, headphones.id, RelationType.ASSOCIATED_WITH, 0.90
    )
    proposed = service.create_relation(a, noise.id, fear.id, RelationType.ASSOCIATED_WITH, 0.35)
    service.confirm_relation(a, leaving.id, actor_role=HumanRole.USER)
    service.confirm_relation(a, wearing.id, actor_role=HumanRole.CAREGIVER)
    assert service.get_neighbours(a, noise.id) == (headphones, leave)
    assert [r.id for r in service.get_validated_relations(a, noise.id)] == [wearing.id, leaving.id]
    assert service.get_strongest_relations(a, noise.id, limit=1)[0].id == wearing.id
    assert service.get_relations(a, noise.id, status=RelationStatus.PROPOSED) == (proposed,)
    assert service.get_neighbours(b, noise.id) == ()
    assert service.get_validated_relations(b, noise.id) == ()
    # Matching canonical keys in B do not copy A's personal associations.
    b_noise = service.create_concept(b, "NOISE", "Bruit")
    assert service.get_neighbours(b, b_noise.id) == ()


def test_label_change_preserves_identity_and_relation_history(space):
    service, a, _ = space
    noise, leave, relation = pair(service, a)
    renamed = service.rename_concept(a, leave.id, "Aller dehors")
    service.confirm_relation(a, relation.id, actor_role=HumanRole.USER)
    assert renamed.id == leave.id and renamed.canonical_key == "LEAVE"
    assert service.get_neighbours(a, noise.id) == (renamed,)
    history = service.get_history(a, TargetType.CONCEPT, leave.id)
    assert [change.event_type for change in history] == ["concept_created", "concept_renamed"]
    assert history[-1].previous == leave
    assert history[-1].current == renamed


def test_confidence_does_not_promote_and_rejection_survives_it(space):
    service, a, _ = space
    noise, _, relation = pair(service, a)
    updated = service.update_confidence(a, relation.id, 1.0)
    assert updated.status == RelationStatus.PROPOSED
    assert service.get_neighbours(a, noise.id) == ()
    validated = service.confirm_relation(a, relation.id, actor_role=HumanRole.PROFESSIONAL)
    rejected = service.reject_relation(a, relation.id, actor_role=HumanRole.USER)
    updated = service.update_confidence(a, relation.id, 0.99)
    assert updated.status == RelationStatus.REJECTED
    assert (updated.validation_count, updated.rejection_count) == (1, 1)
    assert service.get_validated_relations(a, noise.id) == ()
    assert service.get_relations(a, noise.id, status=RelationStatus.REJECTED) == (updated,)
    history = service.get_history(a, TargetType.SEMANTIC_RELATION, relation.id)
    assert [h.event_type for h in history] == [
        "relation_proposed",
        "relation_confidence_changed",
        "relation_confirm",
        "relation_reject",
        "relation_confidence_changed",
    ]
    assert history[2].current == validated
    assert history[3].previous == validated and history[3].current == rejected
    assert history[2].source == "human:professional"
    with service.units() as store:
        rows = tuple(
            store.session.scalars(select(ValidationRow).order_by(ValidationRow.created_at))
        )
        assert [row.actor_role for row in rows] == ["professional", "user"]


@pytest.mark.parametrize(
    "operation", ["rename", "confidence", "confirm", "reject", "source", "target"]
)
def test_foreign_profile_cannot_write_or_observe_history(space, operation):
    service, a, b = space
    noise, leave, relation = pair(service, a)
    b_concept = service.create_concept(b, "OWN", "Personnel")
    with pytest.raises(SemanticNotFoundError):
        match operation:
            case "rename":
                service.rename_concept(b, noise.id, "Intrusion")
            case "confidence":
                service.update_confidence(b, relation.id, 1.0)
            case "confirm":
                service.confirm_relation(b, relation.id, actor_role=HumanRole.USER)
            case "reject":
                service.reject_relation(b, relation.id, actor_role=HumanRole.USER)
            case "source":
                service.create_relation(
                    b, noise.id, b_concept.id, RelationType.ASSOCIATED_WITH, 0.5
                )
            case "target":
                service.create_relation(
                    b, b_concept.id, leave.id, RelationType.ASSOCIATED_WITH, 0.5
                )
    assert service.get_history(b, TargetType.SEMANTIC_RELATION, relation.id) == ()
    assert len(service.get_history(a, TargetType.SEMANTIC_RELATION, relation.id)) == 1
    assert service.get_relations(a, noise.id, status=RelationStatus.PROPOSED) == (relation,)


def test_types_direction_deduplication_and_strength_ties(space):
    service, a, _ = space
    noise, leave, relation = pair(service, a)
    ids = []
    for kind in RelationType:
        added = service.create_relation(a, noise.id, leave.id, kind, 0.82)
        ids.append(added.id)
        service.confirm_relation(a, added.id, actor_role=HumanRole.USER)
        filtered = service.get_relations(a, noise.id, relation_type=kind)
        assert len(filtered) == 1 and filtered[0].relation_type == kind
    assert [r.id for r in service.get_strongest_relations(a, noise.id)] == sorted(ids)
    assert service.get_neighbours(a, noise.id) == (leave,)
    assert service.get_neighbours(a, leave.id) == ()
    assert service.get_relations(a, noise.id, status=RelationStatus.PROPOSED) == (relation,)


@pytest.mark.parametrize("confidence", [-0.1, 1.1, float("nan"), float("inf"), True])
def test_invalid_confidence_leaves_no_history_or_state_change(space, confidence):
    service, a, _ = space
    noise, _, relation = pair(service, a)
    with pytest.raises(DomainInvariantError):
        service.update_confidence(a, relation.id, confidence)
    assert service.get_relations(a, noise.id, status=RelationStatus.PROPOSED) == (relation,)
    assert len(service.get_history(a, TargetType.SEMANTIC_RELATION, relation.id)) == 1


def test_audit_failure_rolls_back_relation_and_validation_fact(space, monkeypatch):
    service, a, _ = space
    noise, _, relation = pair(service, a)

    def fail(self, change):
        raise RuntimeError("simulated audit failure")

    monkeypatch.setattr(PostgresSemanticRepository, "append_history", fail)
    with pytest.raises(RuntimeError, match="audit failure"):
        service.confirm_relation(a, relation.id, actor_role=HumanRole.USER)
    assert service.get_relations(a, noise.id, status=RelationStatus.PROPOSED) == (relation,)
    assert len(service.get_history(a, TargetType.SEMANTIC_RELATION, relation.id)) == 1
    with service.units() as store:
        assert store.session.scalar(select(func.count()).select_from(ValidationRow)) == 0


def test_duplicate_feedback_identity_rolls_back_counters(space):
    service, a, _ = space
    noise, _, relation = pair(service, a)
    event = ValidationEvent(
        profile_id=a,
        target_type=TargetType.SEMANTIC_RELATION,
        target_id=relation.id,
        action=ValidationAction.CONFIRM,
    )
    confirmed = service.record_feedback(event)
    # Same event ID with a fresh timestamp must not count as a second confirmation.
    with pytest.raises(IntegrityError):
        service.record_feedback(replace(event, created_at=utc_now()))
    assert service.get_validated_relations(a, noise.id) == (confirmed,)
    assert len(service.get_history(a, TargetType.SEMANTIC_RELATION, relation.id)) == 2


def test_invalid_inputs_missing_profile_and_duplicate_key_are_atomic(space):
    service, a, _ = space
    noise, _, _ = pair(service, a)
    with pytest.raises(SemanticNotFoundError):
        service.create_concept(uuid4(), "UNKNOWN", "Inconnu")
    with pytest.raises(IntegrityError):
        service.create_concept(a, "NOISE", "Autre sens")
    with pytest.raises(DomainInvariantError):
        service.rename_concept(a, noise.id, " ")
    with pytest.raises(DomainInvariantError):
        service.confirm_relation(a, uuid4(), actor_role="provider")
    for limit in (0, -1, True, 1.5):
        with pytest.raises(DomainInvariantError):
            service.get_strongest_relations(a, noise.id, limit=limit)
    assert len(service.get_history(a, TargetType.CONCEPT, noise.id)) == 1


def test_role_migration_preserves_existing_feedback_without_inventing_a_role(
    space, postgres_connection
):
    service, a, _ = space
    _, _, relation = pair(service, a)
    config = migration_config(postgres_connection)
    command.downgrade(config, "0001_pcl_foundation")
    event_id = uuid4()
    postgres_connection.execute(
        text("""
        INSERT INTO validation_event
            (id, profile_id, target_type, target_id, semantic_relation_id, action, created_at)
        VALUES (:id, :profile, 'semantic_relation', :target, :target, 'confirm', :at)
    """),
        {"id": event_id, "profile": a, "target": relation.id, "at": utc_now()},
    )
    command.upgrade(config, "head")
    with service.units() as store:
        row = store.session.scalar(select(ValidationRow).where(ValidationRow.id == event_id))
        assert row.actor_role is None
        assert row.action == "confirm" and row.target_id == relation.id
