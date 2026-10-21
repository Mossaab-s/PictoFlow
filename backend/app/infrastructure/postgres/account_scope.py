"""Explicit account links, independent of semantic relationships and PCL validation."""

from sqlalchemy import select

from app.application.access import MANAGED_TYPES, PRESETS, normalized_capabilities
from app.infrastructure.postgres.models import (
    AccountManagementRow,
    AccountRow,
    PatientProfileRow,
    ProfileAccessRow,
)


class AccessDenied(PermissionError):
    pass


def targets(session, actor):
    allowed = MANAGED_TYPES.get(actor.account_type, ())
    if not actor.active or not allowed:
        return ()
    return tuple(
        session.scalars(
            select(AccountRow.id)
            .join(AccountManagementRow, AccountManagementRow.dependent_id == AccountRow.id)
            .where(
                AccountManagementRow.manager_id == actor.id, AccountRow.account_type.in_(allowed)
            )
            .order_by(AccountRow.id)
        )
    )


def profile_grants(session, account):
    if account.account_type is None or account.is_admin:
        return {
            str(grant.profile_id): normalized_capabilities(grant.capabilities)
            for grant in session.scalars(
                select(ProfileAccessRow).where(ProfileAccessRow.account_id == account.id)
            )
        }
    if account.account_type == "patient":
        profile = session.get(PatientProfileRow, account.id)
        return {str(profile.profile_id): PRESETS["communicator"]} if profile else {}
    # Never traverse parent links: a shared parent is not authority over every child.
    return {
        str(profile_id): normalized_capabilities(capabilities)
        for profile_id, capabilities in session.execute(
            select(PatientProfileRow.profile_id, AccountManagementRow.capabilities)
            .join(
                AccountManagementRow,
                AccountManagementRow.dependent_id == PatientProfileRow.account_id,
            )
            .join(AccountRow, AccountRow.id == PatientProfileRow.account_id)
            .where(
                AccountManagementRow.manager_id == account.id,
                AccountRow.account_type == "patient",
                AccountManagementRow.capabilities.is_not(None),
            )
        )
    }


def manager(session, actor_id):
    actor = session.get(AccountRow, actor_id)
    if (
        actor is None
        or not actor.active
        or not (actor.is_admin or actor.account_type in {"practitioner", "parent"})
    ):
        raise AccessDenied("Account management permission required")
    return actor


def managed_target(session, actor, target_id):
    if not actor.is_admin and target_id not in targets(session, actor):
        raise AccessDenied("Account management permission required")
    target = session.get(AccountRow, target_id)
    if target is None:
        raise AccessDenied("Account management permission required")
    return target


def authorize_credentials(session, actor_id, target_id):
    actor = manager(session, actor_id)
    target = managed_target(session, actor, target_id)
    if actor.is_admin:
        return
    own = profile_grants(session, actor)
    # Resetting a shared parent's password would otherwise reveal other families.
    # Account-wide actions require covering all of that account's live permissions.
    if any(
        not set(caps) <= set(own.get(profile, ()))
        for profile, caps in profile_grants(session, target).items()
    ):
        raise AccessDenied("Account has permissions outside your scope")
