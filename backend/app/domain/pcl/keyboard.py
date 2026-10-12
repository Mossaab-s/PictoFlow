"""Keyboard positions are presentation; selection returns a profile-scoped block UUID."""

from dataclasses import dataclass, field
from enum import StrEnum
from uuid import UUID, uuid4

from app.domain.pcl import invariants as check
from app.domain.pcl.entities import CommunicationBlock


class KeyboardZone(StrEnum):
    STABLE = "stable"
    PERSONAL = "personal"
    ADAPTIVE = "adaptive"


@dataclass(frozen=True, kw_only=True)
class KeyboardPosition:
    profile_id: UUID
    block_id: UUID
    zone: KeyboardZone
    position: int
    locked: bool
    id: UUID = field(default_factory=uuid4)

    def __post_init__(self):
        for name in ("id", "profile_id", "block_id"):
            check.identifier(getattr(self, name), name)
        check.enum_field(self, "zone", KeyboardZone)
        check.count(self.position, "position")
        if type(self.locked) is not bool or self.locked != (self.zone == KeyboardZone.STABLE):
            raise check.DomainInvariantError("Stable positions must be locked")


def project_keyboard(
    profile_id: UUID,
    blocks: tuple[CommunicationBlock, ...],
    positions: tuple[KeyboardPosition, ...],
) -> tuple[KeyboardPosition, ...]:
    check.identifier(profile_id, "profile_id")
    if any(item.profile_id != profile_id for item in (*blocks, *positions)):
        raise check.DomainInvariantError("Keyboard projection cannot span profiles")
    known = {block.id: block for block in blocks}
    if len(known) != len(blocks) or len({p.block_id for p in positions}) != len(positions):
        raise check.DomainInvariantError("Duplicate keyboard identity")
    if len({(p.zone, p.position) for p in positions}) != len(positions):
        raise check.DomainInvariantError("Duplicate keyboard position")
    result = []
    placed = set()
    for item in positions:
        block = known.get(item.block_id)
        if block is None:
            raise check.DomainInvariantError("Keyboard position refers to an absent block")
        if block.status == "validated":
            if (block.stability == "stable") != (item.zone == KeyboardZone.STABLE):
                raise check.DomainInvariantError("Keyboard position must respect block stability")
            result.append(item)
            placed.add(item.block_id)
    occupied = {(p.zone, p.position) for p in positions}
    for block in sorted(blocks, key=lambda item: str(item.id)):
        if block.status != "validated" or block.id in placed:
            continue
        if block.stability == "stable":
            raise check.DomainInvariantError("Stable blocks require explicit positions")
        zone = KeyboardZone.ADAPTIVE if block.origin == "pcl_suggestion" else KeyboardZone.PERSONAL
        position = 0
        while (zone, position) in occupied:
            position += 1
        occupied.add((zone, position))
        result.append(
            KeyboardPosition(
                profile_id=profile_id,
                block_id=block.id,
                zone=zone,
                position=position,
                locked=False,
                id=block.id,
            )
        )
    return tuple(sorted(result, key=lambda item: (item.zone.value, item.position)))
