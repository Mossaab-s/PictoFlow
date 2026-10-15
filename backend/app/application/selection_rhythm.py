"""Optional observed intervals, never an inference about intent or emotion."""

import json
from dataclasses import dataclass
from statistics import median
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.pcl.entities import CommunicationSequence


class SelectionObservation(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        frozen=True,
        revalidate_instances="always",
        hide_input_in_errors=True,
    )
    interval_ms: int | None = Field(default=None, ge=0, le=86_400_000)
    blocked_ms: int = Field(default=0, ge=0, le=86_400_000)
    input_method: Literal["pointer", "keyboard", "unknown"]

    @model_validator(mode="after")
    def coherent_intervals(self):
        if self.blocked_ms > (self.interval_ms or 0):
            raise ValueError("Blocked duration cannot exceed the observed interval")
        return self


@dataclass(frozen=True)
class RhythmInterval:
    interval_ms: int
    blocked_ms: int
    available_ms: int
    input_method: str


@dataclass(frozen=True)
class RhythmReport:
    intervals: tuple[RhythmInterval, ...]
    median_available_ms: float | None
    partial: bool


def rhythm_report(units, profile_id: UUID, sequence_id: UUID):
    with units() as store:
        store.get(profile_id, CommunicationSequence, sequence_id)
        history = store.audit_history(
            profile_id, target_type="communication_sequence", target_id=sequence_id, limit=1000
        )
        intervals = []
        for event in history:
            if event.event_type != "sequence_append":
                continue
            state = json.loads(event.new_state or "{}")
            raw = state.get("presentation", {}).get("selection_observation")
            if not raw:
                continue
            try:
                observation = SelectionObservation.model_validate(raw)
            except ValueError:
                continue
            if observation.interval_ms is not None:
                intervals.append(
                    RhythmInterval(
                        observation.interval_ms,
                        observation.blocked_ms,
                        observation.interval_ms - observation.blocked_ms,
                        observation.input_method,
                    )
                )
        return RhythmReport(
            tuple(intervals),
            float(median(i.available_ms for i in intervals)) if intervals else None,
            len(history) >= 1000,
        )
