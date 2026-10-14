"""A validated presentation snapshot and explicit, atomic draft import."""

import base64
import hashlib
import json
from dataclasses import asdict, dataclass
from uuid import UUID

from app.application.keyboard_groups import ordered_groups
from app.application.pcl_repository import PCLUnits
from app.application.photos import PHOTO_SOURCE, PhotoAsset
from app.application.semantic_space import SemanticNotFoundError
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    HumanRole,
    Representation,
    SequenceStatus,
    utc_now,
)
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.keyboard import KeyboardGroup, KeyboardPosition, project_keyboard

MAX_OFFLINE_MEDIA_BYTES = 20 * 1024 * 1024


class OfflineConflict(ValueError):
    """Changed keyboard or request identity; never reinterpret a local draft."""


class OfflineSnapshotTooLarge(ValueError):
    pass


@dataclass(frozen=True)
class CommunicationSnapshot:
    profile_id: UUID
    revision: str
    captured_at: str
    blocks: tuple[CommunicationBlock, ...]
    positions: tuple[KeyboardPosition, ...]
    representations: tuple[Representation, ...]
    groups: tuple[KeyboardGroup, ...]
    photos: dict[str, str]


def digest(value):
    return hashlib.sha256(
        json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


class OfflineCommunication:
    def __init__(self, units: PCLUnits):
        self.units = units

    @staticmethod
    def snapshot_in(store, profile_id, *, include_media=True):
        all_blocks = store.list(profile_id, CommunicationBlock)
        blocks = tuple(b for b in all_blocks if b.status == "validated")
        groups = ordered_groups(store.list(profile_id, KeyboardGroup))
        page_ids = {g.id for g in groups}
        positions = tuple(
            p
            for p in project_keyboard(
                profile_id, all_blocks, store.list(profile_id, KeyboardPosition)
            )
            if p.group_id is None or p.group_id in page_ids
        )
        visible = {p.block_id for p in positions}
        blocks = tuple(b for b in blocks if b.id in visible)
        visual_ids = {b.representation_id for b in blocks}
        visuals = tuple(
            v
            for v in store.list(profile_id, Representation)
            if v.id in visual_ids and v.status == "validated"
        )
        photos = {}
        photo_digests = {}
        total = 0
        for v in visuals:
            if v.source == PHOTO_SOURCE and v.type == "photo":
                photo = store.get(profile_id, PhotoAsset, v.id)
                if include_media:
                    total += len(photo.content)
                    if total > MAX_OFFLINE_MEDIA_BYTES:
                        raise OfflineSnapshotTooLarge("Snapshot exceeds local media limit")
                    photos[str(v.id)] = (
                        "data:image/jpeg;base64," + base64.b64encode(photo.content).decode()
                    )
                photo_digests[str(v.id)] = hashlib.sha256(photo.content).hexdigest()
        revision = digest(
            {
                "profile_id": profile_id,
                "blocks": [asdict(b) for b in blocks],
                "positions": [asdict(p) for p in positions],
                "representations": [asdict(v) for v in visuals],
                "groups": [asdict(g) for g in groups],
                "concepts": [
                    asdict(c)
                    for c in store.list(profile_id, Concept)
                    if c.id in {b.concept_id for b in blocks}
                ],
                "photos": photo_digests,
            }
        )
        return CommunicationSnapshot(
            profile_id, revision, utc_now().isoformat(), blocks, positions, visuals, groups, photos
        )

    def snapshot(self, profile_id):
        with self.units() as store:
            return self.snapshot_in(store, profile_id)

    def import_draft(
        self,
        profile_id: UUID,
        request_id: UUID,
        expected_revision: str,
        block_ids: tuple[UUID, ...],
        actor_role: HumanRole,
    ):
        block_ids = tuple(block_ids)
        if not 1 <= len(block_ids) <= 32:
            raise DomainInvariantError("Offline sequences require one to 32 touches")
        fingerprint = digest(
            {
                "profile_id": profile_id,
                "request_id": request_id,
                "expected_revision": expected_revision,
                "block_ids": block_ids,
                "actor_role": actor_role.value,
            }
        )
        with self.units() as store:
            try:
                existing = store.get(profile_id, CommunicationSequence, request_id)
            except SemanticNotFoundError:
                existing = None
            if existing is not None:
                events = store.audit_history(
                    profile_id,
                    target_type="communication_sequence",
                    target_id=request_id,
                    limit=100,
                )
                matching = [e for e in events if e.event_type == "sequence_imported_offline"]
                if (
                    existing.status != SequenceStatus.COMPLETED
                    or existing.block_ids != block_ids
                    or not any(
                        json.loads(e.new_state or "{}")
                        .get("presentation", {})
                        .get("offline_request_hash")
                        == fingerprint
                        for e in matching
                    )
                ):
                    raise OfflineConflict("Offline request was already used")
                return existing
            snapshot = self.snapshot_in(store, profile_id, include_media=False)
            if snapshot.revision != expected_revision:
                raise OfflineConflict("Keyboard changed; keep draft and review a fresh snapshot")
            available = {b.id for b in snapshot.blocks}
            if any(block_id not in available for block_id in block_ids):
                raise OfflineConflict("Touch no longer available")
            now = utc_now()
            sequence = CommunicationSequence(
                id=request_id,
                profile_id=profile_id,
                session_id=request_id,
                block_ids=block_ids,
                status=SequenceStatus.COMPLETED,
                created_at=now,
                completed_at=now,
            )
            store.add(profile_id, sequence)
            store.audit(
                profile_id,
                "sequence_imported_offline",
                None,
                sequence,
                f"human:{actor_role.value}",
                new_details={"offline_request_hash": fingerprint},
            )
            return store.get(profile_id, CommunicationSequence, request_id)
