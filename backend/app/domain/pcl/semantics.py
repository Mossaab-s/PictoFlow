"""Pure relation transitions. Confidence is never a human validation decision."""

from dataclasses import replace
from datetime import datetime

from app.domain.pcl.entities import (
    RelationStatus,
    SemanticRelation,
    TargetType,
    ValidationAction,
    ValidationEvent,
)
from app.domain.pcl.invariants import DomainInvariantError, timestamp


def change_confidence(
    relation: SemanticRelation, confidence: float, *, at: datetime
) -> SemanticRelation:
    timestamp(at, "at")
    if at < relation.updated_at:
        raise DomainInvariantError("A semantic change cannot precede the current state")
    return replace(relation, confidence=confidence, updated_at=at)


def apply_relation_feedback(relation: SemanticRelation, event: ValidationEvent) -> SemanticRelation:
    if (
        event.profile_id != relation.profile_id
        or event.target_type != TargetType.SEMANTIC_RELATION
        or event.target_id != relation.id
    ):
        raise DomainInvariantError("Feedback must target this relation in this profile")
    if event.created_at < relation.updated_at:
        raise DomainInvariantError("Feedback cannot precede the current relation state")
    if event.action == ValidationAction.CONFIRM:
        return replace(
            relation,
            status=RelationStatus.VALIDATED,
            validation_count=relation.validation_count + 1,
            updated_at=event.created_at,
        )
    if event.action == ValidationAction.REJECT:
        return replace(
            relation,
            status=RelationStatus.REJECTED,
            rejection_count=relation.rejection_count + 1,
            updated_at=event.created_at,
        )
    raise DomainInvariantError("Changing relation meaning requires a new proposal")
