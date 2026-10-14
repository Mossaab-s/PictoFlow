"""Explicit personal keyboard navigation, independent of semantic categories."""

from dataclasses import replace
from uuid import UUID

from app.application.pcl_repository import PCLUnits
from app.domain.pcl.entities import HumanRole, utc_now
from app.domain.pcl.keyboard import KeyboardGroup, KeyboardGroupStatus


class KeyboardOrganizationConflict(ValueError):
    pass


def ordered_groups(groups):
    return tuple(
        sorted(
            (g for g in groups if g.status == KeyboardGroupStatus.ACTIVE),
            key=lambda g: (g.sort_order, g.created_at, g.id),
        )
    )


class KeyboardGroupService:
    def __init__(self, units: PCLUnits):
        self.units = units

    def create(self, profile_id: UUID, label: str, actor_role: HumanRole):
        role = HumanRole(actor_role)
        with self.units() as store:
            pages = ordered_groups(store.list(profile_id, KeyboardGroup))
            group = KeyboardGroup(
                profile_id=profile_id,
                label=label.strip(),
                sort_order=max((g.sort_order for g in pages), default=-1) + 1,
            )
            store.add(profile_id, group)
            store.audit(profile_id, "keyboard_group_created", None, group, f"human:{role.value}")
        return group

    def rename(
        self,
        profile_id: UUID,
        group_id: UUID,
        label: str,
        actor_role: HumanRole,
        *,
        expected_label: str | None = None,
    ):
        role = HumanRole(actor_role)
        with self.units() as store:
            previous = store.get(profile_id, KeyboardGroup, group_id)
            if previous.status != KeyboardGroupStatus.ACTIVE:
                raise KeyboardOrganizationConflict("Page is no longer active")
            if label.strip() == previous.label:
                return previous
            if expected_label is not None and previous.label != expected_label:
                raise KeyboardOrganizationConflict("Page name changed")
            current = replace(previous, label=label.strip(), updated_at=utc_now())
            store.save(profile_id, current)
            store.audit(
                profile_id, "keyboard_group_renamed", previous, current, f"human:{role.value}"
            )
        return current

    def list(self, profile_id: UUID):
        with self.units() as store:
            return ordered_groups(store.list(profile_id, KeyboardGroup))

    def reorder(
        self,
        profile_id: UUID,
        group_ids: tuple[UUID, ...],
        expected_group_ids: tuple[UUID, ...],
        actor_role: HumanRole,
    ):
        role = HumanRole(actor_role)
        with self.units() as store:
            previous = ordered_groups(store.list(profile_id, KeyboardGroup))
            current_ids = tuple(g.id for g in previous)
            if len(set(group_ids)) != len(group_ids):
                raise KeyboardOrganizationConflict("Duplicate page identity")
            # Establish ownership before reporting a stale full-list choice.
            for identity in group_ids:
                store.get(profile_id, KeyboardGroup, identity)
            if set(group_ids) != set(current_ids):
                raise KeyboardOrganizationConflict("Page list changed")
            if group_ids == current_ids:
                return previous
            if expected_group_ids != current_ids:
                raise KeyboardOrganizationConflict("Page order changed")
            by_id = {g.id: g for g in previous}
            result = []
            for index, identity in enumerate(group_ids):
                before = by_id[identity]
                after = replace(before, sort_order=index, updated_at=utc_now())
                if before.sort_order != index:
                    store.save(profile_id, after)
                    store.audit(
                        profile_id, "keyboard_group_reordered", before, after, f"human:{role.value}"
                    )
                else:
                    after = before
                result.append(after)
            return tuple(result)
