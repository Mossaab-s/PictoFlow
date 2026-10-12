"""Profile-scoped semantic operations with atomic state, feedback and history writes."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, replace
from typing import Protocol
from uuid import UUID, uuid4

from app.domain.pcl.entities import (
    Concept,
    HumanRole,
    RelationStatus,
    RelationType,
    SemanticRelation,
    TargetType,
    ValidationAction,
    ValidationEvent,
    utc_now,
)
from app.domain.pcl.invariants import DomainInvariantError, count, identifier
from app.domain.pcl.semantics import apply_relation_feedback, change_confidence

SemanticValue = Concept | SemanticRelation


class SemanticNotFoundError(LookupError):
    """The object is absent from the supplied profile (including foreign IDs)."""


@dataclass(frozen=True, kw_only=True)
class SemanticChange:
    id: UUID
    profile_id: UUID
    event_type: str
    previous: SemanticValue | None
    current: SemanticValue
    source: str


class SemanticRepository(Protocol):
    def profile_exists(self, profile_id: UUID) -> bool: ...

    def concept(self, profile_id: UUID, concept_id: UUID, *, lock: bool = False) -> Concept: ...

    def relation(
        self, profile_id: UUID, relation_id: UUID, *, lock: bool = False
    ) -> SemanticRelation: ...

    def add(self, profile_id: UUID, value: SemanticValue) -> None: ...

    def save(self, profile_id: UUID, value: SemanticValue) -> None: ...

    def add_feedback(self, event: ValidationEvent) -> None: ...

    def append_history(self, change: SemanticChange) -> None: ...

    def relations(
        self,
        profile_id: UUID,
        concept_id: UUID,
        *,
        status: RelationStatus,
        relation_type: RelationType | None,
        limit: int | None,
    ) -> tuple[SemanticRelation, ...]: ...

    def history(
        self, profile_id: UUID, target_type: TargetType, target_id: UUID
    ) -> tuple[SemanticChange, ...]: ...


class SemanticSpace:
    def __init__(self, units: Callable[[], AbstractContextManager[SemanticRepository]]) -> None:
        self.units = units

    def create_concept(self, profile_id: UUID, canonical_key: str, label: str) -> Concept:
        identifier(profile_id, "profile_id")
        value = Concept(profile_id=profile_id, canonical_key=canonical_key, label=label)
        with self.units() as store:
            if not store.profile_exists(profile_id):
                raise SemanticNotFoundError("Profile not found")
            store.add(profile_id, value)
            self._audit(store, "concept_created", None, value, "pcl")
        return value

    def rename_concept(self, profile_id: UUID, concept_id: UUID, label: str) -> Concept:
        self._scope(profile_id, concept_id)
        with self.units() as store:
            previous = store.concept(profile_id, concept_id, lock=True)
            value = replace(previous, label=label, updated_at=utc_now())
            store.save(profile_id, value)
            self._audit(store, "concept_renamed", previous, value, "pcl")
        return value

    def create_relation(
        self,
        profile_id: UUID,
        source_id: UUID,
        target_id: UUID,
        relation_type: RelationType,
        confidence: float,
    ) -> SemanticRelation:
        identifier(profile_id, "profile_id")
        value = SemanticRelation(
            profile_id=profile_id,
            source_concept_id=source_id,
            target_concept_id=target_id,
            relation_type=relation_type,
            confidence=confidence,
        )
        with self.units() as store:
            store.concept(profile_id, source_id)
            store.concept(profile_id, target_id)
            store.add(profile_id, value)
            self._audit(store, "relation_proposed", None, value, "pcl")
        return value

    def update_confidence(
        self, profile_id: UUID, relation_id: UUID, confidence: float
    ) -> SemanticRelation:
        self._scope(profile_id, relation_id)
        with self.units() as store:
            previous = store.relation(profile_id, relation_id, lock=True)
            value = change_confidence(previous, confidence, at=utc_now())
            store.save(profile_id, value)
            self._audit(store, "relation_confidence_changed", previous, value, "pcl")
        return value

    def record_feedback(self, event: ValidationEvent) -> SemanticRelation:
        if type(event) is not ValidationEvent or event.target_type != TargetType.SEMANTIC_RELATION:
            raise DomainInvariantError("A typed human relation validation event is required")
        with self.units() as store:
            previous = store.relation(event.profile_id, event.target_id, lock=True)
            value = apply_relation_feedback(previous, event)
            store.save(event.profile_id, value)
            store.add_feedback(event)
            self._audit(
                store,
                f"relation_{event.action.value}",
                previous,
                value,
                f"human:{event.actor_role.value}",
            )
        return value

    def confirm_relation(
        self,
        profile_id: UUID,
        relation_id: UUID,
        *,
        actor_role: HumanRole,
        actor_reference: str | None = None,
    ) -> SemanticRelation:
        return self.record_feedback(
            ValidationEvent(
                profile_id=profile_id,
                target_type=TargetType.SEMANTIC_RELATION,
                target_id=relation_id,
                action=ValidationAction.CONFIRM,
                actor_role=actor_role,
                actor_reference=actor_reference,
            )
        )

    def reject_relation(
        self,
        profile_id: UUID,
        relation_id: UUID,
        *,
        actor_role: HumanRole,
        actor_reference: str | None = None,
    ) -> SemanticRelation:
        return self.record_feedback(
            ValidationEvent(
                profile_id=profile_id,
                target_type=TargetType.SEMANTIC_RELATION,
                target_id=relation_id,
                action=ValidationAction.REJECT,
                actor_role=actor_role,
                actor_reference=actor_reference,
            )
        )

    def get_relations(
        self,
        profile_id: UUID,
        concept_id: UUID,
        *,
        status: RelationStatus = RelationStatus.VALIDATED,
        relation_type: RelationType | None = None,
        limit: int | None = None,
    ) -> tuple[SemanticRelation, ...]:
        """Outgoing only; strongest first, then UUID for deterministic ties."""
        self._scope(profile_id, concept_id)
        status = RelationStatus(status)
        relation_type = RelationType(relation_type) if relation_type is not None else None
        if limit is not None:
            count(limit, "limit", minimum=1)
        with self.units() as store:
            # Missing/foreign concepts yield no data, without revealing their owner.
            try:
                store.concept(profile_id, concept_id)
            except SemanticNotFoundError:
                return ()
            return store.relations(
                profile_id, concept_id, status=status, relation_type=relation_type, limit=limit
            )

    def get_validated_relations(
        self, profile_id: UUID, concept_id: UUID
    ) -> tuple[SemanticRelation, ...]:
        return self.get_relations(profile_id, concept_id)

    def get_strongest_relations(
        self, profile_id: UUID, concept_id: UUID, *, limit: int = 5
    ) -> tuple[SemanticRelation, ...]:
        return self.get_relations(profile_id, concept_id, limit=limit)

    def get_neighbours(self, profile_id: UUID, concept_id: UUID) -> tuple[Concept, ...]:
        self._scope(profile_id, concept_id)
        with self.units() as store:
            try:
                store.concept(profile_id, concept_id)
            except SemanticNotFoundError:
                return ()
            relations = store.relations(
                profile_id,
                concept_id,
                status=RelationStatus.VALIDATED,
                relation_type=None,
                limit=None,
            )
            ids = dict.fromkeys(relation.target_concept_id for relation in relations)
            return tuple(store.concept(profile_id, target_id) for target_id in ids)

    def get_history(
        self, profile_id: UUID, target_type: TargetType, target_id: UUID
    ) -> tuple[SemanticChange, ...]:
        self._scope(profile_id, target_id)
        target_type = TargetType(target_type)
        if target_type not in (TargetType.CONCEPT, TargetType.SEMANTIC_RELATION):
            raise DomainInvariantError("Semantic history supports concepts and relations")
        with self.units() as store:
            return store.history(profile_id, target_type, target_id)

    @staticmethod
    def _scope(profile_id: UUID, target_id: UUID) -> None:
        identifier(profile_id, "profile_id")
        identifier(target_id, "target_id")

    @staticmethod
    def _audit(
        store: SemanticRepository,
        event_type: str,
        previous: SemanticValue | None,
        current: SemanticValue,
        source: str,
    ) -> None:
        store.append_history(
            SemanticChange(
                id=uuid4(),
                profile_id=current.profile_id,
                event_type=event_type,
                previous=previous,
                current=current,
                source=source,
            )
        )
