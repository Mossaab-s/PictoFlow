"""Read-only suggestions and explicit proposals from a profile's accepted phrases."""

import json
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from uuid import UUID, uuid5

from app.application.communication import CommunicationService
from app.application.memory_vocabulary import (
    MemoryReference,
    MemorySuggestionConflict,
    join_words,
    normalized,
    resolve,
    revision,
    tokens,
)
from app.application.offline_communication import digest
from app.application.semantic_space import SemanticNotFoundError
from app.domain.pcl.confidence import ConfidenceDecision, ConfidencePolicy, HandlingState
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    HumanRole,
    Interpretation,
    Representation,
)
from app.domain.pcl.invariants import DomainInvariantError


@dataclass(frozen=True)
class PhraseSuggestion:
    reference: MemoryReference
    text: str


@dataclass(frozen=True)
class WordSuggestion:
    reference: MemoryReference
    text: str
    source_text: str
    representation: Representation | None


@dataclass(frozen=True)
class SuggestionPage:
    profile_id: UUID
    mode: str
    words: tuple[WordSuggestion, ...]
    phrases: tuple[PhraseSuggestion, ...]
    total: int
    offset: int
    limit: int


class MemorySuggestions:
    def __init__(self, units, policy: ConfidencePolicy | None = None):
        self.units = units
        self.policy = policy or ConfidencePolicy()

    def page(self, profile_id: UUID, mode: str, query: str = "", offset=0, limit=12):
        if mode not in ("words", "phrases") or not 1 <= limit <= 24 or offset < 0:
            raise DomainInvariantError("Invalid suggestion page")
        with self.units() as store:
            sequences = {
                s.id
                for s in store.list(profile_id, CommunicationSequence)
                if s.status == "completed"
            }
            items = sorted(
                (
                    i
                    for i in store.list(profile_id, Interpretation)
                    if i.validated_text and i.sequence_id in sequences
                ),
                key=lambda i: (i.created_at, str(i.id)),
                reverse=True,
            )
            blocks = [
                b for b in store.list(profile_id, CommunicationBlock) if b.status == "validated"
            ]
            visuals = {
                r.id: r for r in store.list(profile_id, Representation) if r.status == "validated"
            }
            seen, result = set(), []
            for item in items:
                text = item.validated_text
                source_revision = revision(text)
                if mode == "phrases":
                    if text not in seen and normalized(query.strip()) in normalized(text):
                        result.append(
                            PhraseSuggestion(MemoryReference(item.id, source_revision), text)
                        )
                        seen.add(text)
                    continue
                for index, word in enumerate(tokens(text)):
                    key = normalized(word)
                    if key in seen or normalized(query.strip()) not in key:
                        continue
                    seen.add(key)
                    matches = [b for b in blocks if normalized(b.label) == key]
                    visual = (
                        visuals.get(matches[0].representation_id) if len(matches) == 1 else None
                    )
                    if visual and visual.concept_id != matches[0].concept_id:
                        visual = None
                    result.append(
                        WordSuggestion(
                            MemoryReference(item.id, source_revision, index), word, text, visual
                        )
                    )
            page = tuple(result[offset : offset + limit])
            return SuggestionPage(
                profile_id,
                mode,
                page if mode == "words" else (),
                page if mode == "phrases" else (),
                len(result),
                offset,
                limit,
            )

    def propose(
        self,
        profile_id: UUID,
        sequence_id: UUID,
        request_id: UUID,
        references: tuple[MemoryReference, ...],
        actor_role: HumanRole,
    ):
        if (
            not references
            or len(references) > 32
            or (len(references) > 1 and any(r.index is None for r in references))
        ):
            raise DomainInvariantError("Choose one phrase or one to 32 words")
        fingerprint = digest(
            {"references": [asdict(r) for r in references], "actor_role": actor_role.value}
        )
        proposal_id = uuid5(sequence_id, f"memory-proposal:{request_id}")
        with self.units() as store:
            sequence = store.get(profile_id, CommunicationSequence, sequence_id)
            if sequence.status != "completed":
                raise MemorySuggestionConflict(
                    "Terminez votre message avant de proposer une phrase."
                )
            values = tuple(resolve(store, profile_id, r) for r in references)
            text = values[0] if references[0].index is None else join_words(values)
            if not text.strip() or len(text) > 4000:
                raise MemorySuggestionConflict(
                    "La proposition doit contenir de 1 à 4 000 caractères."
                )
            try:
                previous = store.get(profile_id, Interpretation, proposal_id)
            except SemanticNotFoundError:
                previous = None
            if previous:
                events = store.audit_history(
                    profile_id, target_type="interpretation", target_id=proposal_id, limit=100
                )
                if not any(
                    e.event_type == "memory_proposal"
                    and json.loads(e.new_state or "{}")
                    .get("presentation", {})
                    .get("memory_request_hash")
                    == fingerprint
                    for e in events
                ):
                    raise MemorySuggestionConflict("Cette demande a déjà été utilisée.")
                return ConfidenceDecision(HandlingState.CONFIRMATION_REQUIRED, (previous,))
            candidate = Interpretation(
                profile_id=profile_id,
                sequence_id=sequence_id,
                id=proposal_id,
                text=text,
                source="pcl-memory",
                confidence=self.policy.confirmation,
            )

            @contextmanager
            def bound():
                yield store

            decision = CommunicationService(bound, self.policy).propose(
                profile_id, sequence_id, (candidate,), source="pcl-memory"
            )
            store.audit(
                profile_id,
                "memory_proposal",
                None,
                candidate,
                f"human:{actor_role.value}",
                new_details={
                    "memory_sources": [
                        json.loads(json.dumps(asdict(r), default=str)) for r in references
                    ],
                    "memory_request_hash": fingerprint,
                },
            )
            return ConfidenceDecision(
                decision.state, (store.get(profile_id, Interpretation, candidate.id),)
            )
