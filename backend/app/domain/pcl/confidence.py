"""Configurable product handling; confidence never promotes semantic knowledge."""

from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from app.domain.pcl.entities import Interpretation, InterpretationStatus
from app.domain.pcl.invariants import DomainInvariantError, confidence


class HandlingState(StrEnum):
    PROPOSAL = "proposal"
    CONFIRMATION_REQUIRED = "confirmation_required"
    MULTIPLE_HYPOTHESES = "multiple_hypotheses"
    NOT_UNDERSTOOD = "not_understood"


@dataclass(frozen=True)
class ConfidencePolicy:
    refusal: float = 0.40
    confirmation: float = 0.65
    direct: float = 0.90

    def __post_init__(self):
        for value in (self.refusal, self.confirmation, self.direct):
            confidence(value)
        if not self.refusal < self.confirmation < self.direct:
            raise DomainInvariantError("Confidence thresholds must be strictly increasing")

    def decide(
        self,
        candidates: tuple[Interpretation, ...],
        *,
        preferred_ids: frozenset[UUID] = frozenset(),
    ) -> "ConfidenceDecision":
        """Prefer eligible choices without increasing their confidence or validating them."""
        if any(item.status != InterpretationStatus.PROPOSED for item in candidates):
            raise DomainInvariantError("Confidence handling accepts unvalidated proposals only")
        profiles = {item.profile_id for item in candidates}
        sequences = {item.sequence_id for item in candidates}
        if len(profiles) > 1 or len(sequences) > 1:
            raise DomainInvariantError("Candidates must belong to one profile and sequence")
        ranked = sorted(
            candidates,
            key=lambda item: (item.id not in preferred_ids, -item.confidence, str(item.id)),
        )
        eligible = tuple(item for item in ranked if item.confidence >= self.refusal)
        if not eligible:
            return ConfidenceDecision(HandlingState.NOT_UNDERSTOOD, ())
        score = eligible[0].confidence
        if score >= self.direct:
            return ConfidenceDecision(HandlingState.PROPOSAL, eligible[:3])
        if score >= self.confirmation:
            return ConfidenceDecision(HandlingState.CONFIRMATION_REQUIRED, eligible[:3])
        return ConfidenceDecision(HandlingState.MULTIPLE_HYPOTHESES, eligible[:3])


@dataclass(frozen=True)
class ConfidenceDecision:
    state: HandlingState
    candidates: tuple[Interpretation, ...]
