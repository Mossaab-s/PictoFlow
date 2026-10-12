"""Human-controlled gap approval, block activation and representation replacement."""

from dataclasses import replace
from uuid import UUID

from app.application.pcl_repository import PCLUnits
from app.domain.pcl.entities import (
    BlockOrigin,
    BlockStability,
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    HumanRole,
    Interpretation,
    ProposalStatus,
    Representation,
    TargetType,
    ValidationAction,
    ValidationEvent,
    utc_now,
)
from app.domain.pcl.gaps import GapPolicy, GapStatus, SemanticGapCandidate
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.keyboard import KeyboardPosition, KeyboardZone, project_keyboard


class BlockService:
    def __init__(self, units: PCLUnits, gaps: GapPolicy | None = None):
        self.units = units
        self.gaps = gaps or GapPolicy()

    def detect_gaps(self, profile_id: UUID):
        with self.units() as store:
            detected = self.gaps.detect(
                profile_id,
                store.list(profile_id, CommunicationSequence),
                store.list(profile_id, Interpretation),
                store.list(profile_id, CommunicationBlock),
            )
            existing = {
                (g.source_sequence_signature, g.validated_intent): g
                for g in store.list(profile_id, SemanticGapCandidate)
            }
            result = []
            for candidate in detected:
                key = candidate.source_sequence_signature, candidate.validated_intent
                if key not in existing:
                    store.add(profile_id, candidate)
                    store.audit(profile_id, "semantic_gap_detected", None, candidate, "pcl")
                    existing[key] = candidate
                result.append(existing[key])
        return tuple(result)

    def decide_gap(self, profile_id: UUID, gap_id: UUID, *, approve: bool, actor_role: HumanRole):
        if type(approve) is not bool:
            raise DomainInvariantError("Gap approval must be explicit")
        with self.units() as store:
            previous = store.get(profile_id, SemanticGapCandidate, gap_id)
            if previous.status == GapStatus.RESOLVED:
                raise DomainInvariantError("Resolved gaps cannot be reopened")
            if any(
                b.status == ProposalStatus.VALIDATED
                and b.canonical_intent == previous.validated_intent
                for b in store.list(profile_id, CommunicationBlock)
            ):
                raise DomainInvariantError("An active block already represents this meaning")
            action = ValidationAction.CONFIRM if approve else ValidationAction.REJECT
            if approve:
                current_evidence = self.gaps.detect(
                    profile_id,
                    store.list(profile_id, CommunicationSequence),
                    store.list(profile_id, Interpretation),
                    store.list(profile_id, CommunicationBlock),
                )
                eligible = next(
                    (
                        g
                        for g in current_evidence
                        if g.source_sequence_signature == previous.source_sequence_signature
                        and g.validated_intent == previous.validated_intent
                    ),
                    None,
                )
                if eligible is None:
                    raise DomainInvariantError("This gap no longer has enough accepted evidence")
                previous_counts = eligible.occurrence_count, eligible.validated_count
            else:
                previous_counts = previous.occurrence_count, previous.validated_count
            event = ValidationEvent(
                profile_id=profile_id,
                target_type=TargetType.SEMANTIC_GAP_CANDIDATE,
                target_id=gap_id,
                action=action,
                actor_role=actor_role,
            )
            current = replace(
                previous,
                status=GapStatus.APPROVED if approve else GapStatus.REJECTED,
                occurrence_count=previous_counts[0],
                validated_count=previous_counts[1],
            )
            store.save(profile_id, current)
            store.feedback(event)
            store.audit(
                profile_id,
                f"semantic_gap_{current.status.value}",
                previous,
                current,
                f"human:{event.actor_role.value}",
            )
        return current

    def from_gap(self, profile_id: UUID, gap_id: UUID, label: str):
        with self.units() as store:
            gap = store.get(profile_id, SemanticGapCandidate, gap_id)
            if gap.status != GapStatus.APPROVED:
                raise DomainInvariantError("A gap requires human approval before block creation")
            eligible = self.gaps.detect(
                profile_id,
                store.list(profile_id, CommunicationSequence),
                store.list(profile_id, Interpretation),
                store.list(profile_id, CommunicationBlock),
            )
            if not any(
                g.source_sequence_signature == gap.source_sequence_signature
                and g.validated_intent == gap.validated_intent
                for g in eligible
            ):
                raise DomainInvariantError("Gap evidence is no longer eligible for a new block")
            if any(b.semantic_gap_id == gap_id for b in store.list(profile_id, CommunicationBlock)):
                raise DomainInvariantError("This gap already has a block candidate")
            block = CommunicationBlock(
                profile_id=profile_id,
                semantic_gap_id=gap.id,
                canonical_intent=gap.validated_intent,
                label=label,
                origin=BlockOrigin.PCL_SUGGESTION,
            )
            store.add(profile_id, block)
            store.audit(profile_id, "block_proposed", None, block, "pcl")
        return block

    def create(self, profile_id: UUID, concept_id: UUID, label: str):
        with self.units() as store:
            store.get(profile_id, Concept, concept_id)
            block = CommunicationBlock(profile_id=profile_id, concept_id=concept_id, label=label)
            store.add(profile_id, block)
            store.audit(profile_id, "block_proposed", None, block, "human")
        return block

    def validate(
        self,
        profile_id: UUID,
        block_id: UUID,
        *,
        action: ValidationAction,
        actor_role: HumanRole,
        label: str | None = None,
    ):
        action = ValidationAction(action)
        with self.units() as store:
            previous = store.get(profile_id, CommunicationBlock, block_id)
            event = ValidationEvent(
                profile_id=profile_id,
                target_type=TargetType.COMMUNICATION_BLOCK,
                target_id=block_id,
                action=action,
                actor_role=actor_role,
                corrected_value=label if action == ValidationAction.CORRECT else None,
            )
            gap = (
                store.get(profile_id, SemanticGapCandidate, previous.semantic_gap_id)
                if previous.semantic_gap_id
                else None
            )
            accepted = action != ValidationAction.REJECT
            if (
                accepted
                and previous.canonical_intent is not None
                and any(
                    b.id != block_id
                    and b.status == ProposalStatus.VALIDATED
                    and b.canonical_intent == previous.canonical_intent
                    for b in store.list(profile_id, CommunicationBlock)
                )
            ):
                raise DomainInvariantError("An active block already represents this meaning")
            if accepted and gap and gap.status not in (GapStatus.APPROVED, GapStatus.RESOLVED):
                raise DomainInvariantError("Gap approval was revoked")
            current = replace(
                previous,
                status=ProposalStatus.VALIDATED if accepted else ProposalStatus.REJECTED,
                label=label if action == ValidationAction.CORRECT else previous.label,
                updated_at=utc_now(),
            )
            store.save(profile_id, current)
            store.feedback(event)
            store.audit(
                profile_id,
                f"block_{action.value}",
                previous,
                current,
                f"human:{event.actor_role.value}",
            )
            if accepted and gap and gap.status != GapStatus.RESOLVED:
                resolved = replace(gap, status=GapStatus.RESOLVED, existing_block_match=True)
                store.save(profile_id, resolved)
                store.audit(profile_id, "semantic_gap_resolved", gap, resolved, "pcl")
        return current

    def replace_visual(self, profile_id: UUID, block_id: UUID, visual_reference: str | None):
        with self.units() as store:
            previous = store.get(profile_id, CommunicationBlock, block_id)
            if previous.stability == BlockStability.STABLE:
                raise DomainInvariantError("Stable blocks require explicit validation for changes")
            current = replace(previous, visual_reference=visual_reference, updated_at=utc_now())
            store.save(profile_id, current)
            store.audit(profile_id, "block_visual_changed", previous, current, "human")
        return current

    def attach_representation(
        self, profile_id: UUID, block_id: UUID, representation_id: UUID, *, actor_role: HumanRole
    ):
        event = ValidationEvent(
            profile_id=profile_id,
            target_type=TargetType.COMMUNICATION_BLOCK,
            target_id=block_id,
            action=ValidationAction.CONFIRM,
            actor_role=actor_role,
        )
        with self.units() as store:
            previous = store.get(profile_id, CommunicationBlock, block_id)
            representation = store.get(profile_id, Representation, representation_id)
            if (
                representation.status != ProposalStatus.VALIDATED
                or previous.concept_id is None
                or representation.concept_id != previous.concept_id
            ):
                raise DomainInvariantError(
                    "A selected representation must preserve validated concept meaning"
                )
            if previous.status != ProposalStatus.VALIDATED:
                raise DomainInvariantError("Validate the block before selecting its representation")
            current = replace(
                previous,
                representation_id=representation_id,
                visual_reference=representation.asset_reference,
                updated_at=utc_now(),
            )
            store.save(profile_id, current)
            store.feedback(event)
            store.audit(
                profile_id,
                "block_representation_changed",
                previous,
                current,
                f"human:{event.actor_role.value}",
            )
        return current

    def keyboard(self, profile_id: UUID):
        with self.units() as store:
            return project_keyboard(
                profile_id,
                store.list(profile_id, CommunicationBlock),
                store.list(profile_id, KeyboardPosition),
            )

    def place(
        self,
        profile_id: UUID,
        block_id: UUID,
        zone: KeyboardZone,
        position: int,
        *,
        actor_role: HumanRole,
    ):
        zone = KeyboardZone(zone)
        # All manual positioning/stability changes require an explicit human decision.
        event = ValidationEvent(
            profile_id=profile_id,
            target_type=TargetType.COMMUNICATION_BLOCK,
            target_id=block_id,
            action=ValidationAction.CONFIRM,
            actor_role=actor_role,
        )
        with self.units() as store:
            previous = store.get(profile_id, CommunicationBlock, block_id)
            if previous.status != ProposalStatus.VALIDATED:
                raise DomainInvariantError("Only validated blocks may be positioned")
            if previous.origin == BlockOrigin.PCL_SUGGESTION and zone == KeyboardZone.STABLE:
                raise DomainInvariantError("Stable promotion of new PCL suggestions is deferred")
            current = replace(
                previous,
                stability=BlockStability.STABLE
                if zone == KeyboardZone.STABLE
                else BlockStability.ADAPTIVE,
                updated_at=utc_now(),
            )
            placements = store.list(profile_id, KeyboardPosition)
            existing = next((p for p in placements if p.block_id == block_id), None)
            placement = KeyboardPosition(
                profile_id=profile_id,
                block_id=block_id,
                zone=zone,
                position=position,
                locked=zone == KeyboardZone.STABLE,
                **({"id": existing.id} if existing else {}),
            )
            store.save(profile_id, current)
            (store.save if existing else store.add)(profile_id, placement)
            store.feedback(event)
            store.audit(
                profile_id,
                "keyboard_stability_changed",
                previous,
                current,
                f"human:{event.actor_role.value}",
                previous_details=(
                    {
                        "zone": existing.zone.value,
                        "position": existing.position,
                        "locked": existing.locked,
                    }
                    if existing
                    else None
                ),
                new_details={
                    "zone": placement.zone.value,
                    "position": placement.position,
                    "locked": placement.locked,
                },
            )
        return placement


class RepresentationService:
    def __init__(self, units: PCLUnits):
        self.units = units

    def create(self, representation: Representation):
        if representation.status != ProposalStatus.PROPOSED:
            raise DomainInvariantError("New representations must be proposals")
        with self.units() as store:
            store.get(representation.profile_id, Concept, representation.concept_id)
            store.add(representation.profile_id, representation)
            store.audit(
                representation.profile_id, "representation_proposed", None, representation, "human"
            )
        return representation

    def update(self, profile_id: UUID, representation_id: UUID, **changes):
        allowed = {
            "label",
            "asset_reference",
            "source_reference",
            "license",
            "attribution",
            "commercial_use_allowed",
        }
        if not changes or not set(changes) <= allowed:
            raise DomainInvariantError(
                "Representation updates must preserve concept identity and source"
            )
        with self.units() as store:
            previous = store.get(profile_id, Representation, representation_id)
            current = replace(previous, **changes, updated_at=utc_now())
            store.save(profile_id, current)
            store.audit(profile_id, "representation_updated", previous, current, "human")
        return current

    def archive(self, profile_id: UUID, representation_id: UUID):
        with self.units() as store:
            previous = store.get(profile_id, Representation, representation_id)
            current = replace(previous, status=ProposalStatus.ARCHIVED, updated_at=utc_now())
            store.save(profile_id, current)
            store.audit(profile_id, "representation_archived", previous, current, "human")
        return current

    def validate(
        self,
        profile_id: UUID,
        representation_id: UUID,
        *,
        action: ValidationAction,
        actor_role: HumanRole,
        label: str | None = None,
    ):
        action = ValidationAction(action)
        event = ValidationEvent(
            profile_id=profile_id,
            target_type=TargetType.REPRESENTATION,
            target_id=representation_id,
            action=action,
            actor_role=actor_role,
            corrected_value=label if action == ValidationAction.CORRECT else None,
        )
        with self.units() as store:
            previous = store.get(profile_id, Representation, representation_id)
            if previous.status == ProposalStatus.ARCHIVED:
                raise DomainInvariantError("Archived representations cannot be activated")
            current = replace(
                previous,
                status=ProposalStatus.REJECTED
                if action == ValidationAction.REJECT
                else ProposalStatus.VALIDATED,
                label=label if action == ValidationAction.CORRECT else previous.label,
                updated_at=utc_now(),
            )
            store.save(profile_id, current)
            store.feedback(event)
            store.audit(
                profile_id,
                f"representation_{action.value}",
                previous,
                current,
                f"human:{event.actor_role.value}",
            )
        return current
