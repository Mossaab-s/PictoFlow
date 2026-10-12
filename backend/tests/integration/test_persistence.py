from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import sessionmaker

from app.domain.pcl.entities import (
    Concept,
    Representation,
    RepresentationType,
    UserCommunicationProfile,
)
from app.infrastructure.postgres.database import transaction
from app.infrastructure.postgres.models import (
    AuditRow,
    Base,
    BlockRow,
    InterpretationRow,
    RelationRow,
    SequenceItemRow,
    SequenceRow,
    ValidationRow,
)
from app.infrastructure.postgres.repositories import (
    PostgresConceptRepository,
    PostgresProfileRepository,
    PostgresRepresentationRepository,
)
from tests.integration.conftest import migration_config

pytestmark = pytest.mark.postgres


@pytest.fixture
def data(session):
    profiles = PostgresProfileRepository(session)
    concepts = PostgresConceptRepository(session)
    a, b = UserCommunicationProfile(), UserCommunicationProfile()
    profiles.add(a)
    profiles.add(b)
    noise = Concept(profile_id=a.id, canonical_key="NOISE", label="Bruit")
    leave = Concept(profile_id=a.id, canonical_key="LEAVE", label="Partir")
    other = Concept(profile_id=b.id, canonical_key="NOISE", label="Musique")
    for concept in (noise, leave, other):
        concepts.add(concept.profile_id, concept)
    session.commit()
    return a, b, noise, leave, other


def test_migration_creates_all_tables_and_rolls_back(postgres_connection):
    connection = postgres_connection
    assert set(Base.metadata.tables) <= set(sa.inspect(connection).get_table_names())
    assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    command.downgrade(migration_config(connection), "base")
    assert sa.inspect(connection).get_table_names() == ["alembic_version"]
    command.upgrade(migration_config(connection), "head")
    assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []


def test_concept_persists_and_returns_domain_object(session, data):
    a, _, noise, _, _ = data
    repository = PostgresConceptRepository(session)
    session.expunge_all()
    assert repository.get_by_id(a.id, noise.id) == noise
    renamed = repository.update_label(a.id, noise.id, "Le bruit")
    session.commit()
    assert renamed.id == noise.id and renamed.canonical_key == noise.canonical_key
    assert repository.get_by_id(a.id, noise.id).label == "Le bruit"


def test_cross_profile_read_and_update_are_denied(session, data):
    a, b, noise, _, _ = data
    repository = PostgresConceptRepository(session)
    assert repository.get_by_id(b.id, noise.id) is None
    assert repository.update_label(b.id, noise.id, "Wrong profile") is None
    assert repository.get_by_id(a.id, noise.id).label == "Bruit"
    with pytest.raises(ValueError, match="active profile"):
        repository.add(b.id, noise)


def test_canonical_keys_are_unique_within_profile(session, data):
    a, _, _, _, _ = data
    with pytest.raises(IntegrityError):
        PostgresConceptRepository(session).add(
            a.id, Concept(profile_id=a.id, canonical_key="NOISE", label="Duplicate")
        )
    session.rollback()


def test_representation_removal_preserves_concept_and_other_representations(session, data):
    a, b, noise, _, _ = data
    repository = PostgresRepresentationRepository(session)
    image = Representation(
        profile_id=a.id,
        concept_id=noise.id,
        type=RepresentationType.PICTOGRAM,
        source="test",
        license="test-license",
    )
    text = Representation(
        profile_id=a.id,
        concept_id=noise.id,
        type=RepresentationType.TEXT,
        source="user",
        label="Bruit",
    )
    repository.add(a.id, image)
    repository.add(a.id, text)
    session.commit()
    assert repository.get_by_id(a.id, image.id) == image
    assert repository.get_by_id(b.id, image.id) is None
    assert repository.delete(b.id, image.id) is False
    assert repository.delete(a.id, image.id) is True
    session.commit()
    assert repository.get_by_id(a.id, image.id) is None
    assert repository.get_by_id(a.id, text.id) == text
    assert PostgresConceptRepository(session).get_by_id(a.id, noise.id) == noise


def test_representation_cannot_reference_another_profile_concept(session, data):
    a, _, _, _, other = data
    with pytest.raises(IntegrityError):
        PostgresRepresentationRepository(session).add(
            a.id,
            Representation(
                profile_id=a.id, concept_id=other.id, type=RepresentationType.TEXT, source="test"
            ),
        )
    session.rollback()


@pytest.mark.parametrize("confidence", [-0.1, 1.1, float("nan"), float("inf")])
def test_relation_rejects_invalid_confidence(session, data, confidence):
    a, _, noise, leave, _ = data
    session.add(
        RelationRow(
            profile_id=a.id,
            source_concept_id=noise.id,
            target_concept_id=leave.id,
            relation_type="associated_with",
            confidence=confidence,
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_relation_fk_rejects_cross_profile_target_even_without_repository(session, data):
    a, _, noise, _, other = data
    session.add(
        RelationRow(
            profile_id=a.id,
            source_concept_id=noise.id,
            target_concept_id=other.id,
            relation_type="associated_with",
            confidence=0.9,
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_relation_confidence_does_not_imply_validation(session, data):
    a, _, noise, leave, _ = data
    relation = RelationRow(
        profile_id=a.id,
        source_concept_id=noise.id,
        target_concept_id=leave.id,
        relation_type="associated_with",
        confidence=0.99,
    )
    session.add(relation)
    session.flush()
    assert relation.status == "proposed"
    assert relation.validation_count == 0


def test_profile_deletion_is_restricted_instead_of_cascading(session, data):
    a, _, noise, _, _ = data
    with pytest.raises(IntegrityError):
        session.execute(
            sa.text("DELETE FROM user_communication_profile WHERE id = :id"), {"id": a.id}
        )
    session.rollback()
    assert PostgresConceptRepository(session).get_by_id(a.id, noise.id) == noise


def test_sequence_preserves_order_and_repeated_blocks(session, data):
    a, _, noise, _, _ = data
    block = BlockRow(profile_id=a.id, concept_id=noise.id, label="Bruit", origin="user")
    sequence = SequenceRow(profile_id=a.id, session_id=uuid4())
    session.add_all([block, sequence])
    session.flush()
    for position in range(3):
        session.add(
            SequenceItemRow(
                profile_id=a.id, sequence_id=sequence.id, block_id=block.id, position=position
            )
        )
    session.flush()
    items = session.scalars(
        sa.select(SequenceItemRow)
        .where(SequenceItemRow.profile_id == a.id, SequenceItemRow.sequence_id == sequence.id)
        .order_by(SequenceItemRow.position)
    ).all()
    assert [item.position for item in items] == [0, 1, 2]
    assert [item.block_id for item in items] == [block.id] * 3


@pytest.mark.parametrize("row_type", [ValidationRow, AuditRow])
def test_event_targets_cannot_cross_profile_boundaries(session, data, row_type):
    a, _, _, _, other = data
    values = (
        {"action": "confirm"}
        if row_type is ValidationRow
        else {"event_type": "concept_updated", "source": "user"}
    )
    session.add(
        row_type(
            profile_id=a.id,
            target_type="concept",
            target_id=other.id,
            concept_id=other.id,
            **values,
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_interpretation_rejects_sequence_from_other_profile(session, data):
    a, b, _, _, _ = data
    sequence = SequenceRow(profile_id=b.id, session_id=uuid4())
    session.add(sequence)
    session.flush()
    session.commit()
    session.add(
        InterpretationRow(
            profile_id=a.id, sequence_id=sequence.id, text="Proposal", confidence=0.8, source="fake"
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


@pytest.mark.parametrize("row_type", [ValidationRow, AuditRow])
@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_history_is_append_only(session, data, row_type, operation):
    a, _, noise, _, _ = data
    values = (
        {"action": "confirm"}
        if row_type is ValidationRow
        else {"event_type": "concept_created", "source": "user"}
    )
    event = row_type(
        profile_id=a.id, target_type="concept", target_id=noise.id, concept_id=noise.id, **values
    )
    session.add(event)
    session.commit()
    sql = (
        f"DELETE FROM {row_type.__tablename__} WHERE id = :id"
        if operation == "DELETE"
        else (f"UPDATE {row_type.__tablename__} SET target_id = target_id WHERE id = :id")
    )
    with pytest.raises(DBAPIError, match="append-only"):
        session.execute(sa.text(sql), {"id": event.id})
    session.rollback()
    assert session.scalar(sa.select(row_type).where(row_type.id == event.id)) is not None


def test_transaction_rolls_back_on_failure(postgres_connection, session, data):
    a, _, _, _, _ = data
    factory = sessionmaker(bind=postgres_connection, join_transaction_mode="create_savepoint")
    concept = Concept(profile_id=a.id, canonical_key="ROLLBACK", label="Temporary")
    with pytest.raises(RuntimeError, match="Abort"):
        with transaction(factory) as unit:
            PostgresConceptRepository(unit).add(a.id, concept)
            raise RuntimeError("Abort")
    assert PostgresConceptRepository(session).get_by_id(a.id, concept.id) is None


def test_transaction_commits_successful_changes(postgres_connection, session, data):
    a, _, _, _, _ = data
    factory = sessionmaker(bind=postgres_connection, join_transaction_mode="create_savepoint")
    concept = Concept(profile_id=a.id, canonical_key="COMMIT", label="Saved")
    with transaction(factory) as unit:
        PostgresConceptRepository(unit).add(a.id, concept)
    assert PostgresConceptRepository(session).get_by_id(a.id, concept.id) == concept
