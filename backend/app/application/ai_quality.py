"""Technical interpretation evidence; never a measure of personal semantic truth."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

type FallbackReason = Literal[
    "disabled",
    "model_refusal",
    "unfaithful_words",
    "low_confidence",
    "unavailable",
    "invalid_payload",
]

FALLBACK_REASONS = (
    "disabled",
    "model_refusal",
    "unfaithful_words",
    "low_confidence",
    "unavailable",
    "invalid_payload",
)


@dataclass(frozen=True)
class AttemptEvidence:
    provider: str
    fallback_reason: FallbackReason | None = None
    received_candidates: int = 0
    correction_examples: int = 0
    memory_examples: int = 0

    def snapshot(self, retained: int) -> dict:
        return {
            "ai_quality": {
                "version": 1,
                "provider": self.provider,
                "fallback_reason": self.fallback_reason,
                "received_candidates": self.received_candidates,
                "retained_candidates": 0 if self.fallback_reason else retained,
                "correction_examples": self.correction_examples,
                "memory_examples_selected": self.memory_examples,
            }
        }


@dataclass(frozen=True)
class QualitySummary:
    recorded_attempts: int
    provider_proposals: int
    fallbacks: dict[str, int]
    received_candidates: int
    retained_candidates: int
    attempts_with_corrections: int
    recording_started_at: datetime | None
    interpretation_states: dict[str, int]
    human_actions: dict[str, int]
