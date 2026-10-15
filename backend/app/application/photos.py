"""Personal photo proposals; media and semantic records share one transaction."""

import base64
import binascii
from dataclasses import dataclass, replace
from datetime import datetime
from uuid import UUID, uuid5

from app.application.blocks import BlockService
from app.application.pcl_repository import PCLUnits
from app.application.semantic_space import SemanticNotFoundError
from app.domain.pcl.entities import (
    BlockOrigin,
    CommunicationBlock,
    Concept,
    HumanRole,
    ProposalStatus,
    Representation,
    RepresentationType,
    TargetType,
    ValidationAction,
    ValidationEvent,
    utc_now,
)
from app.domain.pcl.invariants import DomainInvariantError

PHOTO_SOURCE = "personal-photo"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_ENCODED_LENGTH = 4 * ((MAX_UPLOAD_BYTES + 2) // 3)
MAX_STORED_BYTES = 2 * 1024 * 1024


class PhotoPayloadError(ValueError):
    """Invalid, oversized, animated or unsupported image; never include input."""


@dataclass(frozen=True)
class NormalizedPhoto:
    content: bytes
    digest: str
    width: int
    height: int


@dataclass(frozen=True)
class PhotoAsset:
    # Application storage value, deliberately absent from the PCL domain and audit snapshots.
    id: UUID
    profile_id: UUID
    content: bytes
    digest: str
    width: int
    height: int
    created_at: datetime


def decode_photo(encoded: str) -> bytes:
    if not encoded or len(encoded) > MAX_ENCODED_LENGTH:
        raise PhotoPayloadError("Invalid photo size")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise PhotoPayloadError("Invalid photo encoding") from None
    if not content or len(content) > MAX_UPLOAD_BYTES:
        raise PhotoPayloadError("Invalid photo size")
    return content


class PhotoService:
    def __init__(self, units: PCLUnits):
        self.units = units

    @staticmethod
    def _visual(profile_id, concept_id, visual_id, label):
        return Representation(
            id=visual_id,
            profile_id=profile_id,
            concept_id=concept_id,
            type=RepresentationType.PHOTO,
            source=PHOTO_SOURCE,
            label=label,
            asset_reference=f"photo:{visual_id}",
        )

    @staticmethod
    def _store(store, visual, photo, actor_role):
        store.add(visual.profile_id, visual)
        store.add(
            visual.profile_id,
            PhotoAsset(
                id=visual.id,
                profile_id=visual.profile_id,
                content=photo.content,
                digest=photo.digest,
                width=photo.width,
                height=photo.height,
                created_at=utc_now(),
            ),
        )
        store.audit(
            visual.profile_id,
            "representation_proposed",
            None,
            visual,
            f"human:{actor_role.value}",
        )

    def create_touch(
        self,
        profile_id: UUID,
        request_id: UUID,
        label: str,
        photo: NormalizedPhoto,
        actor_role: HumanRole,
        concept_id: UUID | None = None,
        meaning: str | None = None,
    ):
        label = label.strip()
        meaning = label if meaning is None else meaning.strip()
        actor_role = HumanRole(actor_role)
        block_id = uuid5(profile_id, f"photo-touch:{request_id}")
        visual_id = uuid5(block_id, "photo")
        new_concept = concept_id is None
        concept_id = concept_id or uuid5(block_id, "concept")
        with self.units() as store:
            try:
                previous = store.get(profile_id, CommunicationBlock, block_id)
            except SemanticNotFoundError:
                previous = None
            if previous is not None:
                asset = store.get(profile_id, PhotoAsset, visual_id)
                if (
                    previous.label != label
                    or previous.concept_id != concept_id
                    or previous.representation_id != visual_id
                    or asset.digest != photo.digest
                    or (new_concept and store.get(profile_id, Concept, concept_id).label != meaning)
                ):
                    raise DomainInvariantError("Creation ID already used for another photo touch")
                return previous
            if new_concept:
                concept = Concept(
                    id=concept_id,
                    profile_id=profile_id,
                    canonical_key=f"USER_{concept_id.hex}",
                    label=meaning,
                )
                store.add(profile_id, concept)
                store.audit(
                    profile_id, "concept_created", None, concept, f"human:{actor_role.value}"
                )
            else:
                store.get(profile_id, Concept, concept_id)
            visual = self._visual(profile_id, concept_id, visual_id, label)
            self._store(store, visual, photo, actor_role)
            block = CommunicationBlock(
                id=block_id,
                profile_id=profile_id,
                concept_id=concept_id,
                label=label,
                origin=BlockOrigin(actor_role.value),
                representation_id=visual_id,
                visual_reference=visual.asset_reference,
            )
            store.add(profile_id, block)
            store.audit(profile_id, "block_proposed", None, block, f"human:{actor_role.value}")
        return block

    def replace_photo(
        self,
        profile_id: UUID,
        block_id: UUID,
        request_id: UUID,
        photo: NormalizedPhoto,
        actor_role: HumanRole,
    ):
        actor_role = HumanRole(actor_role)
        visual_id = uuid5(block_id, f"photo-replacement:{request_id}")
        with self.units() as store:
            previous = store.get(profile_id, CommunicationBlock, block_id)
            if previous.status != ProposalStatus.VALIDATED or previous.concept_id is None:
                raise DomainInvariantError("Photo replacement requires a validated concept touch")
            try:
                existing = store.get(profile_id, Representation, visual_id)
            except SemanticNotFoundError:
                existing = None
            if existing is not None:
                asset = store.get(profile_id, PhotoAsset, visual_id)
                if asset.digest != photo.digest or previous.representation_id != visual_id:
                    raise DomainInvariantError("Replacement ID already used")
                return previous
            visual = self._visual(profile_id, previous.concept_id, visual_id, previous.label)
            self._store(store, visual, photo, actor_role)
            # Both validations and the attachment are in this same transaction.
            BlockService._confirm_visual(store, visual, actor_role)
            current = replace(
                previous,
                representation_id=visual.id,
                visual_reference=visual.asset_reference,
                updated_at=utc_now(),
            )
            store.save(profile_id, current)
            store.feedback(
                ValidationEvent(
                    profile_id=profile_id,
                    target_type=TargetType.COMMUNICATION_BLOCK,
                    target_id=block_id,
                    action=ValidationAction.CONFIRM,
                    actor_role=actor_role,
                )
            )
            store.audit(
                profile_id,
                "block_representation_changed",
                previous,
                current,
                f"human:{actor_role.value}",
            )
        return current

    def read(self, profile_id: UUID, visual_id: UUID):
        with self.units() as store:
            visual = store.get(profile_id, Representation, visual_id)
            if (
                visual.source != PHOTO_SOURCE
                or visual.type != RepresentationType.PHOTO
                or visual.asset_reference != f"photo:{visual_id}"
                or visual.status not in (ProposalStatus.PROPOSED, ProposalStatus.VALIDATED)
            ):
                raise SemanticNotFoundError("Photo not available in this profile")
            return store.get(profile_id, PhotoAsset, visual_id)

    def remove(self, profile_id: UUID, visual_id: UUID, actor_role: HumanRole):
        actor_role = HumanRole(actor_role)
        with self.units() as store:
            visual = store.get(profile_id, Representation, visual_id)
            if visual.source != PHOTO_SOURCE or visual.type != RepresentationType.PHOTO:
                raise DomainInvariantError("Only managed personal photos can be removed")
            if any(
                block.representation_id == visual_id and block.status == ProposalStatus.VALIDATED
                for block in store.list(profile_id, CommunicationBlock)
            ):
                raise DomainInvariantError("Replace the photo of active touches before removing it")
            current = replace(visual, status=ProposalStatus.ARCHIVED, updated_at=utc_now())
            store.save(profile_id, current)
            store.remove_photo(profile_id, visual_id)
            store.audit(profile_id, "photo_removed", visual, current, f"human:{actor_role.value}")
