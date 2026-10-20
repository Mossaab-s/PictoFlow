"""Exact-sequence repetition of explicitly accepted meanings, scoped to one profile."""

import hashlib
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from app.domain.pcl import invariants as check
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    Interpretation,
    SequenceStatus,
    utc_now,
)


class GapStatus(StrEnum):
    PROPOSED = "proposed"
    APPROVED = "approved"
    REJECTED = "rejected"
    RESOLVED = "resolved"


@dataclass(frozen=True, kw_only=True, slots=True)
class SemanticGapCandidate:
    profile_id: UUID
    source_sequence_signature: str
    validated_intent: str
    occurrence_count: int
    validated_count: int
    existing_block_match: bool = False
    status: GapStatus = GapStatus.PROPOSED
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=utc_now)

    def __post_init__(self):
        check.identity_and_dates(self)
        check.text(self.source_sequence_signature, "source_sequence_signature")
        check.text(self.validated_intent, "validated_intent")
        check.count(self.occurrence_count, "occurrence_count", minimum=1)
        check.count(self.validated_count, "validated_count", minimum=1)
        if self.validated_count > self.occurrence_count:
            raise check.DomainInvariantError("Validated events cannot exceed completed occurrences")
        if type(self.existing_block_match) is not bool:
            raise check.DomainInvariantError("existing_block_match must be boolean")
        check.enum_field(self, "status", GapStatus)


def sequence_signature(sequence: CommunicationSequence) -> str:
    encoded = str(sequence.profile_id) + ":" + ",".join(map(str, sequence.block_ids))
    return hashlib.sha256(encoded.encode()).hexdigest()


def gap_block_meaning(block: CommunicationBlock, concepts: tuple[Concept, ...]) -> str | None:
    """Illustrated needs target a concept; ordinary concepts are not gap evidence."""
    if block.canonical_intent is not None:
        return block.canonical_intent
    if block.semantic_gap_id is not None:
        return next((c.label for c in concepts if c.id == block.concept_id), None)
    return None


@dataclass(frozen=True)
class GapPolicy:
    minimum_occurrences: int = 5
    minimum_validated: int = 4

    def __post_init__(self):
        check.count(self.minimum_occurrences, "minimum_occurrences", minimum=1)
        check.count(self.minimum_validated, "minimum_validated", minimum=1)
        if self.minimum_validated > self.minimum_occurrences:
            raise check.DomainInvariantError(
                "Validated threshold cannot exceed occurrence threshold"
            )

    def detect(
        self,
        profile_id: UUID,
        sequences: tuple[CommunicationSequence, ...],
        interpretations: tuple[Interpretation, ...],
        blocks: tuple[CommunicationBlock, ...],
        concepts: tuple[Concept, ...] = (),
    ):
        check.identifier(profile_id, "profile_id")
        if any(
            item.profile_id != profile_id
            for item in (*sequences, *interpretations, *blocks, *concepts)
        ):
            raise check.DomainInvariantError("Gap evidence must belong to exactly one profile")
        completed = {s.id: s for s in sequences if s.status == SequenceStatus.COMPLETED}
        if len({s.id for s in sequences}) != len(sequences):
            raise check.DomainInvariantError("Duplicate sequence evidence")
        occurrences = Counter(sequence_signature(s) for s in completed.values())
        accepted = {}
        for item in interpretations:
            if item.validated_text is not None:
                if item.sequence_id not in completed:
                    raise check.DomainInvariantError(
                        "Accepted gap evidence requires completed sequences"
                    )
                if item.sequence_id in accepted:
                    raise check.DomainInvariantError(
                        "Multiple accepted interpretations for one event"
                    )
                accepted[item.sequence_id] = item.validated_text
        evidence = Counter(
            (sequence_signature(completed[key]), meaning) for key, meaning in accepted.items()
        )
        active_intents = {gap_block_meaning(b, concepts) for b in blocks if b.status == "validated"}
        return tuple(
            SemanticGapCandidate(
                profile_id=profile_id,
                source_sequence_signature=signature,
                validated_intent=intent,
                occurrence_count=occurrences[signature],
                validated_count=count,
            )
            for (signature, intent), count in sorted(evidence.items())
            if occurrences[signature] >= self.minimum_occurrences
            and count >= self.minimum_validated
            and intent not in active_intents
        )
