"""Scoped persistent communication port. Units commit state and history together."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, TypeVar
from uuid import UUID

from app.domain.pcl.audit import SemanticAuditEvent
from app.domain.pcl.entities import ValidationEvent

T = TypeVar("T")


@dataclass(frozen=True)
class HistoricalFeedback:
    id: UUID
    profile_id: UUID
    target_type: str
    target_id: UUID
    action: str
    corrected_value: str | None
    actor_role: str | None
    actor_reference: str | None
    created_at: datetime


class PCLRepository(Protocol):
    def get(self, profile_id: UUID, entity_type: type[T], entity_id: UUID) -> T: ...

    def list(self, profile_id: UUID, entity_type: type[T]) -> tuple[T, ...]: ...

    def add(self, profile_id: UUID, value: T) -> None: ...

    def save(self, profile_id: UUID, value: T) -> None: ...

    def feedback(self, event: ValidationEvent) -> None: ...

    def feedback_history(
        self, profile_id: UUID, target_id: UUID
    ) -> tuple[HistoricalFeedback, ...]: ...

    def audit(
        self,
        profile_id: UUID,
        event_type: str,
        previous,
        current,
        source: str,
        *,
        previous_details: dict | None = None,
        new_details: dict | None = None,
    ) -> None: ...

    def purge(self, profile_id: UUID) -> None: ...

    def remove_photo(self, profile_id: UUID, photo_id: UUID) -> None: ...

    def audit_history(
        self, profile_id: UUID, *, target_type: str | None, target_id: UUID | None, limit: int
    ) -> tuple[SemanticAuditEvent, ...]: ...


type PCLUnits = Callable[[], AbstractContextManager[PCLRepository]]
