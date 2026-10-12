"""Immutable state for one personal communication space; no provider or storage handle."""

from dataclasses import dataclass, replace

from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    Interpretation,
    InterpretationStatus,
    Representation,
    SemanticRelation,
    SequenceStatus,
    TargetType,
    UserCommunicationProfile,
    ValidationAction,
    ValidationEvent,
)
from app.domain.pcl.gaps import SemanticGapCandidate
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.validation import apply_interpretation_feedback


@dataclass(frozen=True, kw_only=True, slots=True)
class PCLSnapshot:
    profile: UserCommunicationProfile
    concepts: tuple[Concept, ...] = ()
    representations: tuple[Representation, ...] = ()
    blocks: tuple[CommunicationBlock, ...] = ()
    relations: tuple[SemanticRelation, ...] = ()
    sequences: tuple[CommunicationSequence, ...] = ()
    interpretations: tuple[Interpretation, ...] = ()
    validation_events: tuple[ValidationEvent, ...] = ()
    gaps: tuple[SemanticGapCandidate, ...] = ()

    def __post_init__(self) -> None:
        if type(self.profile) is not UserCommunicationProfile:
            raise DomainInvariantError("A PCL snapshot requires a communication profile")
        collections = (
            ("concepts", Concept, TargetType.CONCEPT),
            ("representations", Representation, TargetType.REPRESENTATION),
            ("blocks", CommunicationBlock, TargetType.COMMUNICATION_BLOCK),
            ("relations", SemanticRelation, TargetType.SEMANTIC_RELATION),
            ("sequences", CommunicationSequence, TargetType.COMMUNICATION_SEQUENCE),
            ("interpretations", Interpretation, TargetType.INTERPRETATION),
            ("gaps", SemanticGapCandidate, TargetType.SEMANTIC_GAP_CANDIDATE),
            ("validation_events", ValidationEvent, None),
        )
        targets = {}
        for name, expected_type, target_type in collections:
            values = getattr(self, name)
            if not isinstance(values, (tuple, list)):
                raise DomainInvariantError("Snapshot collections must be ordered collections")
            values = tuple(values)
            object.__setattr__(self, name, values)
            if any(type(value) is not expected_type for value in values):
                raise DomainInvariantError("Snapshot contains an unsupported domain object")
            if any(value.profile_id != self.profile.id for value in values):
                raise DomainInvariantError("Every object must belong to the snapshot's profile")
            mapping = {value.id: value for value in values}
            if len(mapping) != len(values):
                raise DomainInvariantError("Duplicate object identity in a snapshot collection")
            if target_type is not None:
                targets[target_type] = mapping
        if len({concept.canonical_key for concept in self.concepts}) != len(self.concepts):
            raise DomainInvariantError("Concept canonical keys must be unique within a profile")

        def require(target_type: TargetType, identifier):
            if identifier not in targets[target_type]:
                raise DomainInvariantError(
                    "A reference is missing from this profile's semantic space"
                )
            return targets[target_type][identifier]

        for representation in self.representations:
            require(TargetType.CONCEPT, representation.concept_id)
        for block in self.blocks:
            if block.semantic_gap_id is not None:
                gap = require(TargetType.SEMANTIC_GAP_CANDIDATE, block.semantic_gap_id)
                if block.canonical_intent != gap.validated_intent:
                    raise DomainInvariantError("A gap block must preserve the approved meaning")
            if block.concept_id is not None:
                require(TargetType.CONCEPT, block.concept_id)
            if block.representation_id is not None:
                representation = require(TargetType.REPRESENTATION, block.representation_id)
                if block.concept_id is not None and representation.concept_id != block.concept_id:
                    raise DomainInvariantError(
                        "Block representation must preserve its concept identity"
                    )
        for relation in self.relations:
            require(TargetType.CONCEPT, relation.source_concept_id)
            require(TargetType.CONCEPT, relation.target_concept_id)
        for sequence in self.sequences:
            for identifier in sequence.block_ids:
                require(TargetType.COMMUNICATION_BLOCK, identifier)
        for interpretation in self.interpretations:
            require(TargetType.COMMUNICATION_SEQUENCE, interpretation.sequence_id)

        previous_time = None
        events_by_target = {}
        for event in self.validation_events:
            target = require(event.target_type, event.target_id)
            if event.created_at < target.created_at:
                raise DomainInvariantError("Feedback must not precede its target")
            if previous_time is not None and event.created_at < previous_time:
                raise DomainInvariantError("Validation history must be chronological")
            previous_time = event.created_at
            events_by_target.setdefault((event.target_type, event.target_id), []).append(event)

        def feedback(target_type, obj, *, accepted: bool):
            history = events_by_target.get((target_type, obj.id), [])
            allowed = (
                (ValidationAction.CONFIRM, ValidationAction.CORRECT)
                if accepted
                else (ValidationAction.REJECT,)
            )
            if not history or history[-1].action not in allowed:
                raise DomainInvariantError(
                    "Stored validation state requires matching human feedback"
                )
            return history

        for target_type, items in (
            (TargetType.REPRESENTATION, self.representations),
            (TargetType.COMMUNICATION_BLOCK, self.blocks),
            (TargetType.SEMANTIC_RELATION, self.relations),
        ):
            for obj in items:
                if obj.status == "validated":
                    feedback(target_type, obj, accepted=True)
                elif obj.status == "rejected":
                    feedback(target_type, obj, accepted=False)
        for interpretation in self.interpretations:
            status = interpretation.status
            if status in (InterpretationStatus.CONFIRMED, InterpretationStatus.CORRECTED):
                history = feedback(TargetType.INTERPRETATION, interpretation, accepted=True)
                sequence = require(TargetType.COMMUNICATION_SEQUENCE, interpretation.sequence_id)
                if sequence.status != SequenceStatus.COMPLETED:
                    raise DomainInvariantError(
                        "Accepted meaning requires a completed communication sequence"
                    )
                corrections = [
                    event for event in history if event.action == ValidationAction.CORRECT
                ]
                if corrections:
                    if (
                        status != InterpretationStatus.CORRECTED
                        or interpretation.corrected_text != corrections[-1].corrected_value
                    ):
                        raise DomainInvariantError(
                            "Human correction must override the original proposal"
                        )
                elif status != InterpretationStatus.CONFIRMED:
                    raise DomainInvariantError(
                        "Corrected state requires an explicit correction event"
                    )
            elif status == InterpretationStatus.REJECTED:
                feedback(TargetType.INTERPRETATION, interpretation, accepted=False)
            elif events_by_target.get((TargetType.INTERPRETATION, interpretation.id)):
                raise DomainInvariantError("Proposal/refusal state cannot hide validation feedback")
        for gap in self.gaps:
            if gap.status in ("approved", "resolved"):
                feedback(TargetType.SEMANTIC_GAP_CANDIDATE, gap, accepted=True)
            elif gap.status == "rejected":
                feedback(TargetType.SEMANTIC_GAP_CANDIDATE, gap, accepted=False)

    def add_interpretation(self, proposal: Interpretation) -> "PCLSnapshot":
        if proposal.status not in (
            InterpretationStatus.PROPOSED,
            InterpretationStatus.NOT_UNDERSTOOD,
        ):
            raise DomainInvariantError(
                "New interpretations must remain unvalidated proposals or refusals"
            )
        return replace(self, interpretations=(*self.interpretations, proposal))

    def record_interpretation_feedback(self, event: ValidationEvent) -> "PCLSnapshot":
        if event.target_type != TargetType.INTERPRETATION or event.profile_id != self.profile.id:
            raise DomainInvariantError("Feedback must target this profile's interpretation")
        proposal = next((item for item in self.interpretations if item.id == event.target_id), None)
        if proposal is None:
            raise DomainInvariantError("Interpretation is not in this profile")
        updated = apply_interpretation_feedback(proposal, event)
        return replace(
            self,
            interpretations=tuple(
                updated if item.id == proposal.id else item for item in self.interpretations
            ),
            validation_events=(*self.validation_events, event),
        )
