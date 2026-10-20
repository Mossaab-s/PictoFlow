"""PostgreSQL semantic unit: a transaction covers state, feedback and audit."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.application.semantic_space import (
    SemanticChange,
    SemanticNotFoundError,
    SemanticValue,
)
from app.domain.pcl.entities import (
    Concept,
    RelationStatus,
    RelationType,
    SemanticRelation,
    TargetType,
    ValidationAction,
    ValidationEvent,
)
from app.domain.pcl.invariants import identifier
from app.infrastructure.postgres.database import transaction
from app.infrastructure.postgres.models import (
    AuditRow,
    BlockRow,
    ConceptRow,
    ProfileRow,
    RelationRow,
    ValidationRow,
)
from app.infrastructure.postgres.repositories import to_domain, to_values


def _snapshot(value: SemanticValue | None) -> dict | None:
    if value is None:
        return None
    return json.loads(json.dumps(to_values(value), default=str, allow_nan=False))


def _restore(target_type: str, values: dict | None) -> SemanticValue | None:
    if values is None:
        return None
    fields = dict(values)
    for name in ("id", "profile_id", "source_concept_id", "target_concept_id"):
        if name in fields:
            fields[name] = UUID(fields[name])
    for name in ("created_at", "updated_at"):
        fields[name] = datetime.fromisoformat(fields[name])
    entity_type = Concept if target_type == TargetType.CONCEPT else SemanticRelation
    return entity_type(**fields)


class PostgresSemanticRepository:
    def __init__(self, session: Session, actor_reference: str | None = None):
        self.session = session
        self.actor_reference = actor_reference
        self._profile: UUID | None = None

    def profile_exists(self, profile_id: UUID) -> bool:
        identifier(profile_id, "profile_id")
        if self._profile is not None:
            if self._profile != profile_id:
                raise ValueError("A semantic transaction cannot span multiple profiles")
            return True
        found = self.session.scalar(
            select(ProfileRow.id).where(ProfileRow.id == profile_id).with_for_update()
        )
        if found is not None:
            self._profile = profile_id
        return found is not None

    def _scope(self, profile_id: UUID):
        if not self.profile_exists(profile_id):
            raise SemanticNotFoundError("Profile not found")

    def _find(self, row_type, profile_id: UUID, entity_id: UUID, *, lock: bool = False):
        self._scope(profile_id)
        identifier(entity_id, "entity_id")
        query = select(row_type).where(row_type.profile_id == profile_id, row_type.id == entity_id)
        if lock:
            query = query.with_for_update()
        row = self.session.scalar(query)
        if row is None:
            raise SemanticNotFoundError("Semantic object not found in this profile")
        return row

    def concept(self, profile_id: UUID, concept_id: UUID, *, lock: bool = False) -> Concept:
        return to_domain(Concept, self._find(ConceptRow, profile_id, concept_id, lock=lock))

    def concept_has_gap(self, profile_id: UUID, concept_id: UUID) -> bool:
        self._scope(profile_id)
        return (
            self.session.scalar(
                select(BlockRow.id)
                .where(
                    BlockRow.profile_id == profile_id,
                    BlockRow.concept_id == concept_id,
                    BlockRow.semantic_gap_id.is_not(None),
                )
                .limit(1)
            )
            is not None
        )

    def relation(
        self, profile_id: UUID, relation_id: UUID, *, lock: bool = False
    ) -> SemanticRelation:
        return to_domain(
            SemanticRelation, self._find(RelationRow, profile_id, relation_id, lock=lock)
        )

    def add(self, profile_id: UUID, value: SemanticValue) -> None:
        self._scope(profile_id)
        self._check_scope(profile_id, value)
        row_type = ConceptRow if isinstance(value, Concept) else RelationRow
        self.session.add(row_type(**to_values(value)))
        self.session.flush()

    def save(self, profile_id: UUID, value: SemanticValue) -> None:
        self._check_scope(profile_id, value)
        row_type = ConceptRow if isinstance(value, Concept) else RelationRow
        row = self._find(row_type, profile_id, value.id, lock=True)
        # Identity, canonical keys and directed endpoints are never relabelled.
        names = (
            ("label", "updated_at")
            if isinstance(value, Concept)
            else ("confidence", "validation_count", "rejection_count", "status", "updated_at")
        )
        for name in names:
            setattr(row, name, getattr(value, name))
        self.session.flush()

    def add_feedback(self, event: ValidationEvent) -> None:
        self._scope(event.profile_id)
        if event.target_type != TargetType.SEMANTIC_RELATION or event.action not in (
            ValidationAction.CONFIRM,
            ValidationAction.REJECT,
        ):
            raise ValueError("Expected relation confirmation or rejection")
        self.session.add(
            ValidationRow(
                id=event.id,
                profile_id=event.profile_id,
                target_type=event.target_type,
                target_id=event.target_id,
                semantic_relation_id=event.target_id,
                action=event.action,
                actor_role=event.actor_role,
                actor_reference=self.actor_reference or event.actor_reference,
                corrected_value=None,
                created_at=event.created_at,
            )
        )
        self.session.flush()

    def append_history(self, change: SemanticChange) -> None:
        self._scope(change.profile_id)
        self._check_scope(change.profile_id, change.current)
        if change.previous is not None:
            self._check_scope(change.profile_id, change.previous)
        target_type = (
            TargetType.CONCEPT
            if isinstance(change.current, Concept)
            else TargetType.SEMANTIC_RELATION
        )
        self.session.add(
            AuditRow(
                id=change.id,
                profile_id=change.profile_id,
                target_type=target_type,
                target_id=change.current.id,
                **{f"{target_type.value}_id": change.current.id},
                event_type=change.event_type,
                previous_state=_snapshot(change.previous),
                new_state=_snapshot(change.current),
                source=change.source,
                created_at=change.current.updated_at,
            )
        )
        self.session.flush()

    def relations(
        self,
        profile_id: UUID,
        concept_id: UUID,
        *,
        status: RelationStatus,
        relation_type: RelationType | None,
        limit: int | None,
    ) -> tuple[SemanticRelation, ...]:
        self._scope(profile_id)
        query = (
            select(RelationRow)
            .where(
                RelationRow.profile_id == profile_id,
                RelationRow.source_concept_id == concept_id,
                RelationRow.status == status,
            )
            .order_by(RelationRow.confidence.desc(), RelationRow.id)
        )
        if relation_type is not None:
            query = query.where(RelationRow.relation_type == relation_type)
        if limit is not None:
            query = query.limit(limit)
        return tuple(to_domain(SemanticRelation, row) for row in self.session.scalars(query))

    def history(
        self, profile_id: UUID, target_type: TargetType, target_id: UUID
    ) -> tuple[SemanticChange, ...]:
        self._scope(profile_id)
        rows = self.session.scalars(
            select(AuditRow)
            .where(
                AuditRow.profile_id == profile_id,
                AuditRow.target_type == target_type,
                AuditRow.target_id == target_id,
            )
            .order_by(AuditRow.created_at, AuditRow.id)
        )
        changes = []
        for row in rows:
            current = _restore(row.target_type, row.new_state)
            if current is None:
                raise ValueError("Semantic change is missing its resulting state")
            changes.append(
                SemanticChange(
                    id=row.id,
                    profile_id=row.profile_id,
                    event_type=row.event_type,
                    previous=_restore(row.target_type, row.previous_state),
                    current=current,
                    source=row.source,
                )
            )
        return tuple(changes)

    @staticmethod
    def _check_scope(profile_id: UUID, value: SemanticValue) -> None:
        if value.profile_id != profile_id:
            raise ValueError("Semantic object does not belong to the active profile")


class PostgresSemanticUnits:
    def __init__(self, factory: sessionmaker[Session], actor_reference: str | None = None):
        self.factory = factory
        self.actor_reference = actor_reference

    @contextmanager
    def __call__(self) -> Iterator[PostgresSemanticRepository]:
        with transaction(self.factory) as session:
            yield PostgresSemanticRepository(session, self.actor_reference)
