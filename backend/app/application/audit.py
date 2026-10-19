"""Read semantic evolution by profile and optional typed target."""

from uuid import UUID

from app.application.pcl_repository import PCLUnits
from app.domain.pcl.entities import TargetType
from app.domain.pcl.invariants import DomainInvariantError, count, identifier


class AuditService:
    def __init__(self, units: PCLUnits):
        self.units = units

    def history(
        self,
        profile_id: UUID,
        *,
        target_type: TargetType | None = None,
        target_id: UUID | None = None,
        limit: int = 500,
        newest_first: bool = False,
        before: UUID | None = None,
        meaning_changes_only: bool = False,
    ):
        identifier(profile_id, "profile_id")
        count(limit, "limit", minimum=1)
        if limit > 1000:
            raise DomainInvariantError("Audit history is limited to 1000 events per query")
        if type(newest_first) is not bool or type(meaning_changes_only) is not bool:
            raise DomainInvariantError("History ordering and filtering must be explicit")
        if before is not None:
            identifier(before, "before")
            if not newest_first:
                raise DomainInvariantError("History cursors require newest-first order")
        if target_id is not None:
            identifier(target_id, "target_id")
            if target_type is None:
                raise DomainInvariantError("A target ID requires its target type")
        return_type = TargetType(target_type).value if target_type is not None else None
        with self.units() as store:
            return store.audit_history(
                profile_id,
                target_type=return_type,
                target_id=target_id,
                limit=limit,
                newest_first=newest_first,
                before=before,
                meaning_changes_only=meaning_changes_only,
            )
