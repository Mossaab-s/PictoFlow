"""Profile-locked previews of presentation changes; never infer or revalidate meaning."""

import hashlib
import json
from dataclasses import asdict, dataclass, replace
from uuid import UUID

from app.application.keyboard_groups import KeyboardOrganizationConflict
from app.application.pcl_repository import PCLUnits
from app.domain.pcl.entities import CommunicationBlock, HumanRole, Representation, utc_now
from app.domain.pcl.keyboard import (
    KeyboardGroup,
    KeyboardGroupStatus,
    KeyboardPosition,
    KeyboardZone,
    project_keyboard,
)


@dataclass(frozen=True)
class TouchMove:
    block: CommunicationBlock
    before: KeyboardPosition
    after: KeyboardPosition


@dataclass(frozen=True)
class KeyboardChangePreview:
    profile_id: UUID
    preview_token: str
    source_page: KeyboardGroup | None
    destination_page: KeyboardGroup | None
    moves: tuple[TouchMove, ...]


class KeyboardOrganization:
    def __init__(self, units: PCLUnits):
        self.units = units

    @staticmethod
    def page(store, profile_id, group_id):
        if group_id is None:
            return None
        group = store.get(profile_id, KeyboardGroup, group_id)
        if group.status != KeyboardGroupStatus.ACTIVE:
            raise KeyboardOrganizationConflict("Page is no longer active")
        return group

    @staticmethod
    def layout(store, profile_id):
        blocks = store.list(profile_id, CommunicationBlock)
        positions = store.list(profile_id, KeyboardPosition)
        projected = project_keyboard(profile_id, blocks, positions)
        return blocks, positions, projected

    @staticmethod
    def token(store, profile_id, operation, blocks, positions, projected):
        value = {
            "profile_id": str(profile_id),
            "operation": operation,
            "blocks": sorted((asdict(v) for v in blocks), key=lambda v: str(v["id"])),
            "positions": sorted((asdict(v) for v in positions), key=lambda v: str(v["id"])),
            "projected": sorted((asdict(v) for v in projected), key=lambda v: str(v["block_id"])),
            "groups": [asdict(v) for v in store.list(profile_id, KeyboardGroup)],
            "visuals": [asdict(v) for v in store.list(profile_id, Representation)],
        }
        return hashlib.sha256(
            json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    def moving(self, store, profile_id, block_id, destination_group_id, position):
        destination = self.page(store, profile_id, destination_group_id)
        block = store.get(profile_id, CommunicationBlock, block_id)
        blocks, positions, projected = self.layout(store, profile_id)
        previous = next((p for p in (*positions, *projected) if p.block_id == block_id), None)
        if previous is None or previous.locked or block.stability == "stable":
            raise KeyboardOrganizationConflict("Stable anchors cannot be moved by this operation")
        if any(
            p.block_id != block_id
            and (p.group_id, p.zone, p.position) == (destination_group_id, previous.zone, position)
            for p in (*positions, *projected)
        ):
            raise KeyboardOrganizationConflict("Destination place is occupied")
        after = replace(previous, group_id=destination_group_id, position=position)
        operation = {
            "kind": "move",
            "block_id": str(block_id),
            "destination_group_id": str(destination_group_id) if destination_group_id else None,
            "position": position,
        }
        token = self.token(store, profile_id, operation, blocks, positions, projected)
        return KeyboardChangePreview(
            profile_id,
            token,
            self.page(store, profile_id, previous.group_id),
            destination,
            (TouchMove(block, previous, after),),
        )

    def removing(self, store, profile_id, group_id, destination_group_id):
        source = self.page(store, profile_id, group_id)
        if group_id == destination_group_id:
            raise KeyboardOrganizationConflict("A page cannot transfer touches to itself")
        destination = self.page(store, profile_id, destination_group_id)
        blocks, positions, projected = self.layout(store, profile_id)
        known = {b.id: b for b in blocks}
        occupied = {
            (p.zone, p.position)
            for p in (*positions, *projected)
            if p.group_id == destination_group_id
        }
        next_slot = {
            zone: max((slot for z, slot in occupied if z == zone), default=-1) + 1
            for zone in (KeyboardZone.PERSONAL, KeyboardZone.ADAPTIVE)
        }
        moves = []
        for before in sorted(
            (p for p in positions if p.group_id == group_id),
            key=lambda p: (p.zone, p.position, p.id),
        ):
            if before.locked or before.zone == KeyboardZone.STABLE:
                raise KeyboardOrganizationConflict("Stable anchors must remain global")
            if next_slot[before.zone] > 2_147_483_647:
                raise KeyboardOrganizationConflict("Destination has no representable free place")
            after = replace(before, group_id=destination_group_id, position=next_slot[before.zone])
            next_slot[before.zone] += 1
            moves.append(TouchMove(known[before.block_id], before, after))
        operation = {
            "kind": "remove",
            "group_id": str(group_id),
            "destination_group_id": str(destination_group_id) if destination_group_id else None,
        }
        token = self.token(store, profile_id, operation, blocks, positions, projected)
        return KeyboardChangePreview(profile_id, token, source, destination, tuple(moves))

    def preview_move(self, profile_id, block_id, destination_group_id, position):
        with self.units() as store:
            return self.moving(store, profile_id, block_id, destination_group_id, position)

    def preview_removal(self, profile_id, group_id, destination_group_id):
        with self.units() as store:
            return self.removing(store, profile_id, group_id, destination_group_id)

    @staticmethod
    def check(preview, expected_token):
        if preview.preview_token != expected_token:
            raise KeyboardOrganizationConflict("Keyboard changed since preview")

    @staticmethod
    def apply_moves(store, profile_id, preview, role):
        positions = store.list(profile_id, KeyboardPosition)
        existing = {p.block_id for p in positions}
        changed = {m.block.id for m in preview.moves if m.before != m.after}
        if not changed:
            return
        blocks = store.list(profile_id, CommunicationBlock)
        known = {b.id: b for b in blocks}
        # Freeze unplaced touches before freeing an Accueil slot, so derived defaults
        # cannot jump into the gap created by a moved touch.
        for placement in project_keyboard(profile_id, blocks, positions):
            if placement.block_id not in existing and placement.block_id not in changed:
                store.add(profile_id, placement)
                block = known[placement.block_id]
                store.audit(
                    profile_id,
                    "keyboard_place_retained",
                    block,
                    block,
                    f"human:{role.value}",
                    new_details=json.loads(json.dumps(asdict(placement), default=str)),
                )
        for move in preview.moves:
            if move.before == move.after:
                continue
            (store.save if move.block.id in existing else store.add)(profile_id, move.after)
            store.audit(
                profile_id,
                "keyboard_touch_moved",
                move.block,
                move.block,
                f"human:{role.value}",
                previous_details=json.loads(json.dumps(asdict(move.before), default=str)),
                new_details=json.loads(json.dumps(asdict(move.after), default=str)),
            )

    def move(self, profile_id, block_id, destination_group_id, position, preview_token, actor_role):
        role = HumanRole(actor_role)
        with self.units() as store:
            preview = self.moving(store, profile_id, block_id, destination_group_id, position)
            self.check(preview, preview_token)
            self.apply_moves(store, profile_id, preview, role)
            return preview.moves[0].after

    def remove(
        self, profile_id, group_id, destination_group_id, preview_token, actor_role, confirm
    ):
        if confirm is not True:
            raise KeyboardOrganizationConflict("Explicit page removal confirmation required")
        role = HumanRole(actor_role)
        with self.units() as store:
            preview = self.removing(store, profile_id, group_id, destination_group_id)
            self.check(preview, preview_token)
            self.apply_moves(store, profile_id, preview, role)
            archived = replace(
                preview.source_page, status=KeyboardGroupStatus.ARCHIVED, updated_at=utc_now()
            )
            store.save(profile_id, archived)
            store.audit(
                profile_id,
                "keyboard_group_archived",
                preview.source_page,
                archived,
                f"human:{role.value}",
            )
            return archived
