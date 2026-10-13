"""Human-controlled gap approval, block activation and representation replacement."""

from dataclasses import replace
from typing import Literal
from uuid import UUID, uuid5

from app.application.pcl_repository import PCLUnits
from app.application.semantic_space import SemanticNotFoundError
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
    RepresentationType,
    TargetType,
    ValidationAction,
    ValidationEvent,
    utc_now,
)
from app.domain.pcl.gaps import GapPolicy, GapStatus, SemanticGapCandidate
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.keyboard import KeyboardGroup, KeyboardPosition, KeyboardZone, project_keyboard
from app.domain.pcl.pictograms import PICTOGRAM_SOURCE, PictogramKey, pictogram_reference


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

    def create(
        self,
        profile_id: UUID,
        concept_id: UUID,
        label: str,
        *,
        pictogram_key: PictogramKey | None = None,
    ):
        with self.units() as store:
            store.get(profile_id, Concept, concept_id)
            return self._create(store, profile_id, concept_id, label, pictogram_key=pictogram_key)

    def create_personal(
        self,
        profile_id: UUID,
        request_id: UUID,
        label: str,
        pictogram_key: PictogramKey,
        actor_role: HumanRole,
    ):
        """Create the meaning and proposed touch atomically; explicit retries share one ID."""
        label = label.strip()
        reference = pictogram_reference(pictogram_key)
        actor_role = HumanRole(actor_role)
        block_id = uuid5(profile_id, f"personal-touch:{request_id}")
        concept_id = uuid5(block_id, "concept")
        with self.units() as store:
            try:
                previous = store.get(profile_id, CommunicationBlock, block_id)
            except SemanticNotFoundError:
                previous = None
            if previous is not None:
                if previous.concept_id != concept_id or previous.label != label:
                    raise DomainInvariantError("This creation ID already has a different touch")
                visual = store.get(profile_id, Representation, previous.representation_id)
                if visual.source != PICTOGRAM_SOURCE or visual.asset_reference != reference:
                    raise DomainInvariantError("This creation ID already has a different drawing")
                return previous
            concept = Concept(
                id=concept_id,
                profile_id=profile_id,
                canonical_key=f"USER_{concept_id.hex}",
                label=label,
            )
            source = f"human:{actor_role.value}"
            store.add(profile_id, concept)
            store.audit(profile_id, "concept_created", None, concept, source)
            return self._create(
                store,
                profile_id,
                concept_id,
                label,
                pictogram_key=pictogram_key,
                block_id=block_id,
                origin=BlockOrigin(actor_role.value),
                source=source,
            )

    @staticmethod
    def _create(
        store,
        profile_id: UUID,
        concept_id: UUID,
        label: str,
        *,
        pictogram_key: PictogramKey | None,
        block_id: UUID | None = None,
        origin: BlockOrigin = BlockOrigin.USER,
        source: str = "human",
    ):
        visual = None
        if pictogram_key is not None:
            visual = Representation(
                profile_id=profile_id,
                concept_id=concept_id,
                type=RepresentationType.PICTOGRAM,
                source=PICTOGRAM_SOURCE,
                asset_reference=pictogram_reference(pictogram_key),
            )
            store.add(profile_id, visual)
            store.audit(profile_id, "representation_proposed", None, visual, source)
        block = CommunicationBlock(
            **({"id": block_id} if block_id is not None else {}),
            profile_id=profile_id,
            concept_id=concept_id,
            label=label,
            origin=origin,
            representation_id=visual.id if visual else None,
            visual_reference=visual.asset_reference if visual else None,
        )
        store.add(profile_id, block)
        store.audit(profile_id, "block_proposed", None, block, source)
        return block

    def validate(
        self,
        profile_id: UUID,
        block_id: UUID,
        *,
        action: ValidationAction,
        actor_role: HumanRole,
        label: str | None = None,
        confirm_representation: bool = False,
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
            if confirm_representation:
                if not accepted or previous.representation_id is None:
                    raise DomainInvariantError(
                        "Visual confirmation requires an accepted visual touch"
                    )
                visual = store.get(profile_id, Representation, previous.representation_id)
                if visual.concept_id != previous.concept_id or visual.status not in (
                    ProposalStatus.PROPOSED,
                    ProposalStatus.VALIDATED,
                ):
                    raise DomainInvariantError(
                        "This representation cannot be confirmed with the touch"
                    )
                self._confirm_visual(store, visual, actor_role)
            elif accepted and previous.representation_id is not None:
                visual = store.get(profile_id, Representation, previous.representation_id)
                if visual.status != ProposalStatus.VALIDATED:
                    raise DomainInvariantError(
                        "Explicitly confirm the drawing before activating the touch"
                    )
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

    @staticmethod
    def _confirm_visual(store, visual: Representation, actor_role: HumanRole):
        current = replace(visual, status=ProposalStatus.VALIDATED, updated_at=utc_now())
        event = ValidationEvent(
            profile_id=visual.profile_id,
            target_type=TargetType.REPRESENTATION,
            target_id=visual.id,
            action=ValidationAction.CONFIRM,
            actor_role=actor_role,
        )
        store.save(visual.profile_id, current)
        store.feedback(event)
        store.audit(
            visual.profile_id,
            "representation_confirm",
            visual,
            current,
            f"human:{event.actor_role.value}",
        )

    def select_pictogram(
        self, profile_id: UUID, block_id: UUID, key: PictogramKey, *, actor_role: HumanRole
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
            if previous.status != ProposalStatus.VALIDATED or previous.concept_id is None:
                raise DomainInvariantError("Select a drawing for a validated concept touch")
            reference = pictogram_reference(key)
            if previous.representation_id is not None:
                existing = store.get(profile_id, Representation, previous.representation_id)
                if (
                    existing.status == ProposalStatus.VALIDATED
                    and existing.source == PICTOGRAM_SOURCE
                    and existing.asset_reference == reference
                ):
                    return previous
            visual = Representation(
                profile_id=profile_id,
                concept_id=previous.concept_id,
                type=RepresentationType.PICTOGRAM,
                source=PICTOGRAM_SOURCE,
                asset_reference=reference,
            )
            store.add(profile_id, visual)
            store.audit(profile_id, "representation_proposed", None, visual, "human")
            self._confirm_visual(store, visual, actor_role)
            current = replace(
                previous,
                representation_id=visual.id,
                visual_reference=reference,
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
        group_id: UUID | None | Literal["unchanged"] = "unchanged",
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
            placements = store.list(profile_id, KeyboardPosition)
            existing = next((p for p in placements if p.block_id == block_id), None)
            if group_id == "unchanged":
                group_id = existing.group_id if existing and zone != KeyboardZone.STABLE else None
            if group_id is not None:
                store.get(profile_id, KeyboardGroup, group_id)
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
            placement = KeyboardPosition(
                profile_id=profile_id,
                block_id=block_id,
                zone=zone,
                position=position,
                locked=zone == KeyboardZone.STABLE,
                group_id=group_id,
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
                        "group_id": str(existing.group_id) if existing.group_id else None,
                    }
                    if existing
                    else None
                ),
                new_details={
                    "zone": placement.zone.value,
                    "position": placement.position,
                    "locked": placement.locked,
                    "group_id": str(group_id) if group_id else None,
                },
            )
        return placement


class RepresentationService:
    def __init__(self, units: PCLUnits):
        self.units = units

    def create(self, representation: Representation):
        if representation.status != ProposalStatus.PROPOSED:
            raise DomainInvariantError("New representations must be proposals")
        if representation.source == "personal-photo":
            raise DomainInvariantError("Personal photos require the managed upload workflow")
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
            if previous.source == "personal-photo" and "asset_reference" in changes:
                raise DomainInvariantError(
                    "Personal photo pixels are immutable; upload a replacement"
                )
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
