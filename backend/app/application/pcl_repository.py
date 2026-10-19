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


@dataclass(frozen=True)
class FeedbackEvidence:
    id: UUID
    profile_id: UUID
    target_type: str
    target_id: UUID
    action: str
    corrected_value: str | None
    actor_role: str | None
    created_at: datetime


@dataclass(frozen=True)
class FeedbackPage:
    items: tuple[FeedbackEvidence, ...]
    next_cursor: UUID | None


@dataclass(frozen=True)
class AcceptedTrace:
    interpretation_id: UUID
    sequence_id: UUID
    block_ids: tuple[UUID, ...]
    text: str
    accepted_at: datetime


class PCLRepository(Protocol):
    def accepted_traces(
        self,
        profile_id: UUID,
        *,
        block_ids: tuple[UUID, ...],
        exclude_sequence_id: UUID,
        reference_id: UUID | None = None,
    ) -> tuple[AcceptedTrace, ...]: ...

    def get(self, profile_id: UUID, entity_type: type[T], entity_id: UUID) -> T: ...

    def list(self, profile_id: UUID, entity_type: type[T]) -> tuple[T, ...]: ...

    def add(self, profile_id: UUID, value: T) -> None: ...

    def save(self, profile_id: UUID, value: T) -> None: ...

    def feedback(self, event: ValidationEvent) -> None: ...

    def feedback_history(
        self, profile_id: UUID, target_id: UUID
    ) -> tuple[HistoricalFeedback, ...]: ...

    def correction_examples(
        self,
        profile_id: UUID,
        *,
        block_ids: tuple[UUID, ...],
        concept_ids: tuple[UUID, ...],
        context_id: UUID | None,
        exclude_sequence_id: UUID,
    ) -> tuple[str, ...]: ...

    def feedback_page(
        self,
        profile_id: UUID,
        target_type: str,
        target_id: UUID,
        *,
        limit: int,
        before: UUID | None,
    ) -> FeedbackPage: ...

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
        self,
        profile_id: UUID,
        *,
        target_type: str | None,
        target_id: UUID | None,
        limit: int,
        newest_first: bool = False,
        before: UUID | None = None,
        meaning_changes_only: bool = False,
    ) -> tuple[SemanticAuditEvent, ...]: ...


type PCLUnits = Callable[[], AbstractContextManager[PCLRepository]]
