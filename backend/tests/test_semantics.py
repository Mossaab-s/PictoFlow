"""Human feedback and confidence obey separate pure domain transitions."""

from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest

from app.domain.pcl.entities import (
    HumanRole,
    RelationStatus,
    RelationType,
    SemanticRelation,
    TargetType,
    ValidationAction,
    ValidationEvent,
)
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.semantics import apply_relation_feedback, change_confidence


@pytest.fixture
def relation():
    return SemanticRelation(
        profile_id=uuid4(),
        source_concept_id=uuid4(),
        target_concept_id=uuid4(),
        relation_type=RelationType.ASSOCIATED_WITH,
        confidence=0.35,
    )


def feedback(relation, action, **changes):
    return ValidationEvent(
        profile_id=relation.profile_id,
        target_type=TargetType.SEMANTIC_RELATION,
        target_id=relation.id,
        action=action,
        actor_role=HumanRole.CAREGIVER,
        **changes,
    )


def test_confidence_one_remains_a_proposal(relation):
    updated = change_confidence(relation, 1.0, at=relation.updated_at + timedelta(seconds=1))
    assert updated.status == RelationStatus.PROPOSED
    assert updated.validation_count == 0
    assert relation.confidence == 0.35


def test_rejection_is_retained_when_confidence_changes(relation):
    rejected = apply_relation_feedback(relation, feedback(relation, ValidationAction.REJECT))
    updated = change_confidence(rejected, 1.0, at=rejected.updated_at + timedelta(seconds=1))
    assert updated.status == RelationStatus.REJECTED
    assert updated.rejection_count == 1


def test_explicit_reconfirmation_keeps_both_counters_and_identity(relation):
    validated = apply_relation_feedback(relation, feedback(relation, ValidationAction.CONFIRM))
    rejected = apply_relation_feedback(validated, feedback(validated, ValidationAction.REJECT))
    confirmed = apply_relation_feedback(rejected, feedback(rejected, ValidationAction.CONFIRM))
    assert confirmed.status == RelationStatus.VALIDATED
    assert (confirmed.validation_count, confirmed.rejection_count) == (2, 1)
    assert confirmed.id == relation.id
    assert confirmed.confidence == relation.confidence
    assert confirmed.source_concept_id == relation.source_concept_id
    assert confirmed.target_concept_id == relation.target_concept_id


@pytest.mark.parametrize(
    "field,value",
    [
        ("profile_id", uuid4()),
        ("target_id", uuid4()),
        ("target_type", TargetType.CONCEPT),
    ],
)
def test_feedback_cannot_target_another_profile_or_object(relation, field, value):
    event = replace(feedback(relation, ValidationAction.CONFIRM), **{field: value})
    with pytest.raises(DomainInvariantError):
        apply_relation_feedback(relation, event)


@pytest.mark.parametrize("confidence", [-0.01, 1.01, float("nan"), float("inf"), True, "0.5"])
def test_invalid_confidence_cannot_change_state(relation, confidence):
    with pytest.raises(DomainInvariantError):
        change_confidence(relation, confidence, at=relation.updated_at)
    assert relation.confidence == 0.35


def test_correction_cannot_silently_change_relation_meaning(relation):
    event = feedback(relation, ValidationAction.CORRECT, corrected_value="another endpoint")
    with pytest.raises(DomainInvariantError):
        apply_relation_feedback(relation, event)


def test_backdated_feedback_and_changes_are_rejected(relation):
    at = relation.updated_at - timedelta(seconds=1)
    with pytest.raises(DomainInvariantError):
        change_confidence(relation, 0.9, at=at)
    with pytest.raises(DomainInvariantError):
        apply_relation_feedback(
            relation, feedback(relation, ValidationAction.CONFIRM, created_at=at)
        )
