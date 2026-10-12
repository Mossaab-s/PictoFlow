"""Immutable semantic history snapshots; history is not validated personal memory."""

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from app.domain.pcl import invariants as check
from app.domain.pcl.entities import TargetType


@dataclass(frozen=True, kw_only=True)
class SemanticAuditEvent:
    id: UUID
    profile_id: UUID
    event_type: str
    target_type: TargetType
    target_id: UUID
    previous_state: str | None
    new_state: str | None
    source: str
    created_at: datetime

    def __post_init__(self):
        check.identity_and_dates(self)
        check.identifier(self.target_id, "target_id")
        check.text(self.event_type, "event_type")
        check.text(self.source, "source")
        check.enum_field(self, "target_type", TargetType)
        for value in (self.previous_state, self.new_state):
            if value is not None:
                try:
                    decoded = json.loads(value)
                    json.dumps(decoded, allow_nan=False)
                    if not isinstance(decoded, dict):
                        raise ValueError
                except (ValueError, TypeError, RecursionError):
                    raise check.DomainInvariantError(
                        "Audit snapshots must be finite JSON objects"
                    ) from None
