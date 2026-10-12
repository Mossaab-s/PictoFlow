"""A corrected relation replaces meaning through explicit human feedback, never in place."""

import json
from dataclasses import replace
from uuid import UUID

from app.application.pcl_repository import PCLUnits
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


class RelationCorrectionService:
    def __init__(self, units: PCLUnits):
        self.units = units

    def correct(
        self,
        profile_id: UUID,
        relation_id: UUID,
        *,
        source_id: UUID,
        target_id: UUID,
        relation_type: RelationType,
        confidence: float,
        actor_role: HumanRole,
    ):
        replacement = SemanticRelation(
            profile_id=profile_id,
            source_concept_id=source_id,
            target_concept_id=target_id,
            relation_type=relation_type,
            confidence=confidence,
        )
        with self.units() as store:
            previous = store.get(profile_id, SemanticRelation, relation_id)
            store.get(profile_id, Concept, source_id)
            store.get(profile_id, Concept, target_id)
            correction = ValidationEvent(
                profile_id=profile_id,
                target_type=TargetType.SEMANTIC_RELATION,
                target_id=relation_id,
                action=ValidationAction.CORRECT,
                actor_role=actor_role,
                corrected_value=json.dumps(
                    {
                        "replacement_id": str(replacement.id),
                        "source_concept_id": str(source_id),
                        "target_concept_id": str(target_id),
                        "relation_type": replacement.relation_type.value,
                        "confidence": confidence,
                    }
                ),
            )
            # Correction explicitly withdraws the old relation and accepts its replacement.
            rejected = replace(
                previous,
                status=RelationStatus.REJECTED,
                rejection_count=previous.rejection_count + 1,
                updated_at=utc_now(),
            )
            accepted = replace(
                replacement,
                status=RelationStatus.VALIDATED,
                validation_count=1,
                updated_at=utc_now(),
            )
            store.save(profile_id, rejected)
            store.add(profile_id, accepted)
            store.feedback(correction)
            store.feedback(
                ValidationEvent(
                    profile_id=profile_id,
                    target_type=TargetType.SEMANTIC_RELATION,
                    target_id=relation_id,
                    action=ValidationAction.REJECT,
                    actor_role=actor_role,
                )
            )
            store.feedback(
                ValidationEvent(
                    profile_id=profile_id,
                    target_type=TargetType.SEMANTIC_RELATION,
                    target_id=accepted.id,
                    action=ValidationAction.CONFIRM,
                    actor_role=actor_role,
                )
            )
            store.audit(
                profile_id,
                "relation_correct",
                previous,
                rejected,
                f"human:{correction.actor_role.value}",
            )
            store.audit(
                profile_id,
                "relation_corrected_replacement",
                None,
                accepted,
                f"human:{correction.actor_role.value}",
            )
        return accepted
