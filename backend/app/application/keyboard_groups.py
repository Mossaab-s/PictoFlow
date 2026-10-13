"""Explicit personal keyboard navigation, independent of semantic categories."""

from dataclasses import replace
from uuid import UUID

from app.application.pcl_repository import PCLUnits
from app.domain.pcl.entities import HumanRole, utc_now
from app.domain.pcl.keyboard import KeyboardGroup


class KeyboardGroupService:
    def __init__(self, units: PCLUnits):
        self.units = units

    def create(self, profile_id: UUID, label: str, actor_role: HumanRole):
        role = HumanRole(actor_role)
        group = KeyboardGroup(profile_id=profile_id, label=label.strip())
        with self.units() as store:
            store.add(profile_id, group)
            store.audit(profile_id, "keyboard_group_created", None, group, f"human:{role.value}")
        return group

    def rename(self, profile_id: UUID, group_id: UUID, label: str, actor_role: HumanRole):
        role = HumanRole(actor_role)
        with self.units() as store:
            previous = store.get(profile_id, KeyboardGroup, group_id)
            current = replace(previous, label=label.strip(), updated_at=utc_now())
            store.save(profile_id, current)
            store.audit(
                profile_id, "keyboard_group_renamed", previous, current, f"human:{role.value}"
            )
        return current
