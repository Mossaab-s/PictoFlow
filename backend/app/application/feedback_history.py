"""Read actual human decisions, with explicit typed profile scope and no semantic mutation."""

from typing import Literal
from uuid import UUID

from app.application.pcl_repository import PCLUnits
from app.domain.pcl.entities import CommunicationBlock, Interpretation, SemanticRelation
from app.domain.pcl.invariants import DomainInvariantError, count, identifier

type EvidenceTarget = Literal["interpretation", "communication_block", "semantic_relation"]
ENTITIES = {
    "interpretation": Interpretation,
    "communication_block": CommunicationBlock,
    "semantic_relation": SemanticRelation,
}


class FeedbackHistory:
    def __init__(self, units: PCLUnits):
        self.units = units

    def page(
        self,
        profile_id: UUID,
        target_type: EvidenceTarget,
        target_id: UUID,
        *,
        limit: int = 20,
        before: UUID | None = None,
    ):
        identifier(profile_id, "profile_id")
        identifier(target_id, "target_id")
        count(limit, "limit", minimum=1)
        if limit > 100 or target_type not in ENTITIES:
            raise DomainInvariantError("Invalid feedback page")
        if before is not None:
            identifier(before, "before")
        with self.units() as store:
            store.get(profile_id, ENTITIES[target_type], target_id)
            return store.feedback_page(
                profile_id, target_type, target_id, limit=limit, before=before
            )
