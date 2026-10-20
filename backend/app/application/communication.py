"""Persistent sequences, proposal memory and explicit human promotion."""

from dataclasses import dataclass
from uuid import UUID

from app.application.ai_quality import AttemptEvidence
from app.application.memory_vocabulary import MemoryReference, check_memory_provenance, resolve
from app.application.pcl_repository import PCLUnits
from app.application.selection_rhythm import SelectionObservation
from app.application.transient import JsonObject, TransientKind, TransientStore
from app.domain.pcl.confidence import ConfidenceDecision, ConfidencePolicy, HandlingState
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Interpretation,
    InterpretationStatus,
    ProposalStatus,
    SemanticRelation,
    SequenceStatus,
    TargetType,
    ValidationEvent,
)
from app.domain.pcl.invariants import DomainInvariantError, identifier
from app.domain.pcl.sequences import edit_sequence
from app.domain.pcl.validation import apply_interpretation_feedback


@dataclass(frozen=True)
class PersonalMemory:
    interpretations: tuple[Interpretation, ...]
    relations: tuple[SemanticRelation, ...]
    blocks: tuple[CommunicationBlock, ...]
    sequences: tuple[CommunicationSequence, ...] = ()


class InterpretationReviewConflict(RuntimeError):
    """A pending review cannot replace a decision made since the page was read."""


class SequenceEditConflict(RuntimeError):
    """The selected occurrence no longer belongs to the draft shown to the person."""


class CommunicationService:
    def __init__(self, units: PCLUnits, policy: ConfidencePolicy | None = None):
        self.units = units
        self.policy = policy or ConfidencePolicy()

    def start(self, profile_id: UUID, session_id: UUID, context_id: UUID | None = None):
        sequence = CommunicationSequence(
            profile_id=profile_id, session_id=session_id, context_id=context_id
        )
        with self.units() as store:
            store.add(profile_id, sequence)
            store.audit(profile_id, "sequence_started", None, sequence, "human")
        return sequence

    def select(
        self,
        profile_id: UUID,
        sequence_id: UUID,
        action: str,
        block_id: UUID | None = None,
        observation: SelectionObservation | None = None,
        *,
        index: int | None = None,
        expected_block_ids: tuple[UUID, ...] | None = None,
        target_index: int | None = None,
    ):
        if action in {"remove", "move", "replace", "insert"}:
            if (
                type(index) is not int
                or not isinstance(expected_block_ids, tuple)
                or not 1 <= len(expected_block_ids) <= 32
                or not 0 <= index <= len(expected_block_ids) - (0 if action == "insert" else 1)
                or (action not in {"replace", "insert"} and block_id is not None)
            ):
                raise DomainInvariantError("Editing requires an exact ordered draft and index")
            for expected in expected_block_ids:
                identifier(expected, "expected_block_id")
        elif index is not None or expected_block_ids is not None:
            raise DomainInvariantError("Only explicit edits accept an expected draft and index")
        if action in {"replace", "insert"}:
            identifier(block_id, "block_id")
            if action == "replace" and block_id == expected_block_ids[index]:
                raise DomainInvariantError("Replacement must choose a different block")
            if action == "insert" and len(expected_block_ids) >= 32:
                raise DomainInvariantError("Insertion requires a draft of 1 to 31 selections")
        if action == "move":
            if type(target_index) is not int or not 0 <= target_index < len(expected_block_ids):
                raise DomainInvariantError("Moving requires an existing destination index")
        elif target_index is not None:
            raise DomainInvariantError("Only moving accepts a destination index")
        if observation is not None:
            observation = SelectionObservation.model_validate(observation)
            if action != "append":
                raise DomainInvariantError("Only an explicit selection can carry an observation")
        with self.units() as store:
            previous = store.get(profile_id, CommunicationSequence, sequence_id)
            if action in {"remove", "move", "replace", "insert"} and (
                previous.status != SequenceStatus.IN_PROGRESS
                or previous.block_ids != expected_block_ids
            ):
                raise SequenceEditConflict("Message changed; review the current draft")
            if action in {"append", "replace", "insert"}:
                block = store.get(profile_id, CommunicationBlock, block_id)
                if block.status != ProposalStatus.VALIDATED:
                    raise DomainInvariantError("Only validated blocks can be selected")
            current = edit_sequence(
                previous, action, block_id, index=index, target_index=target_index
            )
            details = None
            if observation:
                details = {"selection_observation": observation.model_dump()}
            elif action == "remove":
                details = {"removed_index": index}
            elif action == "move":
                details = {"moved_from_index": index, "moved_to_index": target_index}
            elif action == "replace":
                details = {"replaced_index": index}
            elif action == "insert":
                details = {"inserted_index": index}
            store.save(profile_id, current)
            store.audit(
                profile_id,
                f"sequence_{action}",
                previous,
                current,
                "human",
                new_details=details,
            )
        return current

    def history(self, profile_id: UUID):
        with self.units() as store:
            return tuple(
                item
                for item in store.list(profile_id, CommunicationSequence)
                if item.status == SequenceStatus.COMPLETED
            )

    def propose(
        self,
        profile_id: UUID,
        sequence_id: UUID,
        candidates: tuple[Interpretation, ...],
        *,
        source: str,
        evidence: AttemptEvidence | None = None,
        proposal_details: dict | None = None,
    ) -> ConfidenceDecision:
        identifier(profile_id, "profile_id")
        identifier(sequence_id, "sequence_id")
        if any(
            item.profile_id != profile_id or item.sequence_id != sequence_id for item in candidates
        ):
            raise DomainInvariantError("Proposals must belong to this profile and sequence")
        decision = self.policy.decide(candidates)
        with self.units() as store:
            sequence = store.get(profile_id, CommunicationSequence, sequence_id)
            if sequence.status != SequenceStatus.COMPLETED:
                raise DomainInvariantError("Interpretation requires a completed sequence")
            selected = decision.candidates
            if decision.state == HandlingState.NOT_UNDERSTOOD:
                selected = (
                    Interpretation(
                        profile_id=profile_id,
                        sequence_id=sequence_id,
                        text="",
                        confidence=0.0,
                        source=source,
                        status=InterpretationStatus.NOT_UNDERSTOOD,
                    ),
                )
            if evidence is not None:
                store.audit(
                    profile_id,
                    "interpretation_attempt",
                    None,
                    sequence,
                    evidence.provider,
                    new_details=evidence.snapshot(len(selected)),
                )
            for item in selected:
                if item.source != source:
                    raise DomainInvariantError("Proposal source does not match provenance")
                detail = (proposal_details or {}).get(item.id, {})
                if detail.get("personal_hypothesis"):
                    for ref in detail.get("memory_sources", []):
                        resolve(
                            store,
                            profile_id,
                            MemoryReference(UUID(ref["interpretation_id"]), ref["revision"]),
                            require_association=True,
                        )
                store.add(profile_id, item)
                store.audit(
                    profile_id,
                    f"interpretation_{decision.state.value}",
                    None,
                    item,
                    source,
                    new_details=(proposal_details or {}).get(item.id),
                )
        return decision

    def validate(
        self, event: ValidationEvent, *, expected_status: InterpretationStatus | None = None
    ) -> Interpretation:
        if type(event) is not ValidationEvent or event.target_type != TargetType.INTERPRETATION:
            raise DomainInvariantError("Typed human interpretation feedback is required")
        with self.units() as store:
            previous = store.get(event.profile_id, Interpretation, event.target_id)
            if expected_status is not None and previous.status != expected_status:
                raise InterpretationReviewConflict("Interpretation already reviewed; reload")
            history = store.feedback_history(event.profile_id, event.target_id)
            if history and event.created_at < history[-1].created_at:
                raise DomainInvariantError("Feedback must follow previous decisions")
            sequence = store.get(event.profile_id, CommunicationSequence, previous.sequence_id)
            if sequence.status != SequenceStatus.COMPLETED:
                raise DomainInvariantError("Only completed communication can be validated")
            if event.action != "reject":
                check_memory_provenance(store, event.profile_id, previous)
            # Selecting one hypothesis prevents contradictory accepted meanings per event.
            current = apply_interpretation_feedback(previous, event)
            if current.validated_text is not None:
                for other in store.list(event.profile_id, Interpretation):
                    if (
                        other.sequence_id == current.sequence_id
                        and other.id != current.id
                        and other.validated_text is not None
                    ):
                        if expected_status is not None:
                            raise InterpretationReviewConflict(
                                "Another hypothesis was accepted; reload"
                            )
                        raise DomainInvariantError("Reject the previous accepted hypothesis first")
            store.save(event.profile_id, current)
            store.feedback(event)
            store.audit(
                event.profile_id,
                f"interpretation_{event.action.value}",
                previous,
                current,
                f"human:{event.actor_role.value}",
            )
        return current

    def memory(self, profile_id: UUID, *, validated: bool) -> PersonalMemory:
        if type(validated) is not bool:
            raise DomainInvariantError("Memory partition must be explicit")
        with self.units() as store:
            interpretations = tuple(
                i
                for i in store.list(profile_id, Interpretation)
                if (
                    i.validated_text is not None
                    if validated
                    else i.status == InterpretationStatus.PROPOSED
                )
            )
            sequence_ids = {item.sequence_id for item in interpretations}
            return PersonalMemory(
                interpretations=interpretations,
                sequences=tuple(
                    s
                    for s in store.list(profile_id, CommunicationSequence)
                    if s.id in sequence_ids and s.status == SequenceStatus.COMPLETED
                ),
                relations=tuple(
                    r
                    for r in store.list(profile_id, SemanticRelation)
                    if r.status == ("validated" if validated else "proposed")
                ),
                blocks=tuple(
                    b
                    for b in store.list(profile_id, CommunicationBlock)
                    if b.status == ("validated" if validated else "proposed")
                ),
            )

    def purge(self, profile_id: UUID) -> None:
        with self.units() as store:
            store.purge(profile_id)

    async def erase(self, profile_id: UUID, transient: TransientStore) -> None:
        """Clear configured transient storage first; never claim success on an outage."""
        identifier(profile_id, "profile_id")
        with self.units() as store:
            # Establish profile ownership/existence before clearing any namespace.
            store.list(profile_id, CommunicationSequence)
            await transient.delete_profile(profile_id)
            store.purge(profile_id)


class InteractionMemory:
    """Declared transient context/session only; no promotion path to semantic state."""

    def __init__(self, store: TransientStore):
        self.store = store

    async def put(
        self,
        profile_id: UUID,
        kind: TransientKind,
        reference: UUID,
        value: JsonObject,
        *,
        ttl_seconds: int,
    ):
        self._kind(kind)
        identifier(reference, "reference")
        await self.store.put(profile_id, kind, str(reference), value, ttl_seconds=ttl_seconds)

    async def get(self, profile_id: UUID, kind: TransientKind, reference: UUID):
        self._kind(kind)
        identifier(reference, "reference")
        return await self.store.get(profile_id, kind, str(reference))

    async def clear(self, profile_id: UUID, kind: TransientKind, reference: UUID):
        self._kind(kind)
        identifier(reference, "reference")
        return await self.store.delete(profile_id, kind, str(reference))

    @staticmethod
    def _kind(kind):
        if kind not in (TransientKind.SESSION, TransientKind.CONTEXT):
            raise DomainInvariantError(
                "Interaction memory only accepts session or declared context"
            )
