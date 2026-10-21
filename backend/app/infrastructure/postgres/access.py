"""Revocable accounts, sessions and grants. Never read or infer personal meaning."""

import re
import secrets
from dataclasses import replace
from datetime import timedelta
from uuid import UUID

from sqlalchemy import delete, func, select, text

from app.application.access import (
    MANAGED_TYPES,
    PASSWORDS,
    PRESETS,
    AccountView,
    matches_password,
    normalized_capabilities,
    password_hash,
    token_hash,
    username,
)
from app.domain.pcl.entities import utc_now
from app.infrastructure.postgres.account_scope import (
    AccessDenied,
    authorize_credentials,
    manager,
    profile_grants,
    targets,
)
from app.infrastructure.postgres.models import (
    AccessEventRow,
    AccountManagementRow,
    AccountRow,
    AuthSessionRow,
    LoginWindowRow,
    PatientProfileRow,
    ProfileAccessRow,
    ProfileRow,
)


class AccessConflict(ValueError):
    pass


class Accounts:
    def __init__(self, factory):
        self.factory = factory

    @staticmethod
    def lock(session):
        session.execute(text("SELECT pg_advisory_xact_lock(96633921)"))

    @staticmethod
    def event(session, event_type, actor_id=None, target_id=None, detail=None):
        session.add(
            AccessEventRow(
                event_type=event_type, actor_id=actor_id, target_id=target_id, detail=detail
            )
        )

    @staticmethod
    def view(session, row):
        grants = profile_grants(session, row)
        patient = session.get(PatientProfileRow, row.id)
        return AccountView(
            row.id,
            row.username,
            row.display_name,
            row.is_admin,
            row.active,
            {
                key: "communicator" if set(caps) <= set(PRESETS["communicator"]) else "editor"
                for key, caps in grants.items()
            },
            grants,
            account_type=row.account_type,
            managed_account_ids=targets(session, row),
            patient_profile_id=patient.profile_id if patient else None,
        )

    def create(
        self,
        login: str,
        display_name: str,
        password: str,
        *,
        admin=False,
        actor_id=None,
        account_type=None,
        profile_id=None,
    ):
        login = username(login)
        if not 1 <= len(display_name.strip()) <= 80:
            raise ValueError("A display name is required")
        encoded = password_hash(password)
        with self.factory.begin() as session:
            self.lock(session)
            actor = manager(session, actor_id) if actor_id is not None else None
            kind = "administrator" if admin else account_type
            if kind not in {None, "administrator", "practitioner", "parent", "patient"} or (
                kind == "administrator" and not admin
            ):
                raise ValueError("Choose a supported account type")
            if actor and not actor.is_admin and kind not in MANAGED_TYPES[actor.account_type]:
                raise AccessDenied("Account type exceeds your permissions")
            if profile_id is not None and (kind != "patient" or (actor and not actor.is_admin)):
                raise AccessDenied("Only an administrator can bind an existing patient profile")
            if session.scalar(select(AccountRow.id).where(AccountRow.username == login)):
                raise AccessConflict("Account already exists")
            row = AccountRow(
                username=login,
                display_name=display_name.strip(),
                password_hash=encoded,
                is_admin=admin,
                active=True,
                account_type=kind,
            )
            session.add(row)
            session.flush()
            if kind == "patient":
                if profile_id is None:
                    profile = ProfileRow(display_name=display_name.strip())
                    session.add(profile)
                    session.flush()
                    profile_id = profile.id
                elif session.get(ProfileRow, profile_id) is None or session.scalar(
                    select(PatientProfileRow.account_id).where(
                        PatientProfileRow.profile_id == profile_id
                    )
                ):
                    raise AccessConflict("Choose an existing profile without a patient account")
                session.add(PatientProfileRow(account_id=row.id, profile_id=profile_id))
            if actor and not actor.is_admin:
                session.add(
                    AccountManagementRow(
                        manager_id=actor.id,
                        dependent_id=row.id,
                        capabilities=list(PRESETS["editor"]) if kind == "patient" else None,
                    )
                )
                self.event(session, "account_link_changed", actor.id, row.id, str(actor.id))
            session.flush()
            self.event(session, "account_created", actor_id, row.id)
            return self.view(session, row)

    def current(self, token: str | None):
        if not token or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return None
        with self.factory.begin() as session:
            result = session.execute(
                select(AccountRow, AuthSessionRow)
                .join(AuthSessionRow, AuthSessionRow.account_id == AccountRow.id)
                .where(
                    AuthSessionRow.token_hash == token_hash(token),
                    AuthSessionRow.expires_at > utc_now(),
                    AccountRow.active.is_(True),
                )
            ).one_or_none()
            if result is None:
                return None
            row, browser = result
            account = self.view(session, row)
            if browser.assisted_profile_id is None:
                return account
            profile = str(browser.assisted_profile_id)
            live = set(
                PRESETS["communicator"]
                if account.is_admin
                else account.profile_capabilities.get(profile, ())
            )
            allowed = {"communicate"}
            if browser.assisted_review_allowed:
                allowed.add("review_meanings")
            capabilities = tuple(sorted(live & allowed)) if "communicate" in live else ()
            return replace(
                account,
                is_admin=False,
                profile_access={profile: "communicator"} if capabilities else {},
                profile_capabilities={profile: capabilities} if capabilities else {},
                assisted_profile_id=browser.assisted_profile_id,
            )

    def accompany(self, token: str, profile_id: UUID):
        """Atomically replace this browser's token; never keep a resumable adult cookie."""
        now = utc_now()
        with self.factory.begin() as session:
            # Also serializes grant edits, password changes and account suspension.
            self.lock(session)
            browser = session.get(AuthSessionRow, token_hash(token))
            if browser is None or browser.expires_at <= now or browser.assisted_profile_id:
                raise AccessConflict("Browser session changed")
            row = session.get(AccountRow, browser.account_id)
            if row is None or not row.active or session.get(ProfileRow, profile_id) is None:
                raise AccessConflict("Account or profile changed")
            account = self.view(session, row)
            granted = set(
                PRESETS["communicator"]
                if account.is_admin
                else account.profile_capabilities.get(str(profile_id), ())
            )
            if "communicate" not in granted:
                raise AccessConflict("Communication access changed")
            replacement = secrets.token_urlsafe(32)
            expiry = min(browser.expires_at, now + timedelta(hours=1))
            session.add(
                AuthSessionRow(
                    token_hash=token_hash(replacement),
                    account_id=row.id,
                    expires_at=expiry,
                    assisted_profile_id=profile_id,
                    assisted_review_allowed="review_meanings" in granted,
                )
            )
            session.delete(browser)
            self.event(
                session,
                "accompanied_started",
                row.id,
                profile_id,
                "communication; review=" + str("review_meanings" in granted).lower(),
            )
            return replacement, max(1, int((expiry - now).total_seconds()))

    @staticmethod
    def attempt(session, key, limit, now):
        key = token_hash(key)
        row = session.get(LoginWindowRow, key)
        if row is None:
            row = LoginWindowRow(key=key, started_at=now, attempts=0)
            session.add(row)
        elif now - row.started_at >= timedelta(minutes=15):
            row.started_at, row.attempts = now, 0
        if row.attempts >= limit:
            return False
        row.attempts += 1
        return True

    def login(self, login, password, hours):
        now = utc_now()
        login = username(login)
        with self.factory.begin() as session:
            self.lock(session)
            session.execute(
                delete(LoginWindowRow).where(
                    LoginWindowRow.started_at < now - timedelta(minutes=15)
                )
            )
            session.execute(delete(AuthSessionRow).where(AuthSessionRow.expires_at <= now))
            if not self.attempt(session, "global", 100, now) or not self.attempt(
                session, "account:" + login, 5, now
            ):
                return None, "limited"
            row = session.scalar(select(AccountRow).where(AccountRow.username == login))
            # A fixed, valid Argon2 hash makes unknown/inactive accounts perform a verification too.
            encoded = row.password_hash if row and row.active else DUMMY_HASH
            valid = matches_password(encoded, password)
            if not valid or row is None or not row.active:
                self.event(session, "login_failed")
                return None, "invalid"
            if PASSWORDS.check_needs_rehash(row.password_hash):
                row.password_hash = password_hash(password)
            session.get(LoginWindowRow, token_hash("account:" + login)).attempts = 0
            token = secrets.token_urlsafe(32)
            session.add(
                AuthSessionRow(
                    token_hash=token_hash(token),
                    account_id=row.id,
                    expires_at=now + timedelta(hours=hours),
                )
            )
            self.event(session, "login_succeeded", row.id, row.id)
            return token, "ok"

    def logout(self, token, actor_id=None):
        with self.factory.begin() as session:
            self.lock(session)
            if token:
                session.execute(
                    delete(AuthSessionRow).where(AuthSessionRow.token_hash == token_hash(token))
                )
            if actor_id is not None:
                self.event(session, "logout", actor_id, actor_id)

    def users(self, *, actor_id=None):
        with self.factory.begin() as session:
            query = select(AccountRow).order_by(AccountRow.username)
            actor = manager(session, actor_id) if actor_id is not None else None
            if actor and not actor.is_admin:
                query = query.where(AccountRow.id.in_(targets(session, actor)))
            result = tuple(self.view(session, row) for row in session.scalars(query))
            if actor:
                credential_permissions = {}
                for row in result:
                    try:
                        authorize_credentials(session, actor.id, row.id)
                        credential_permissions[row.id] = True
                    except AccessDenied:
                        credential_permissions[row.id] = False
                result = tuple(
                    replace(row, can_manage_credentials=credential_permissions[row.id])
                    for row in result
                )
            if actor and not actor.is_admin:
                visible = set(targets(session, actor))
                profiles = profile_grants(session, actor)
                result = tuple(
                    replace(
                        row,
                        managed_account_ids=tuple(
                            key for key in row.managed_account_ids if key in visible
                        ),
                        profile_access={
                            key: value
                            for key, value in row.profile_access.items()
                            if key in profiles
                        },
                        profile_capabilities={
                            key: value
                            for key, value in row.profile_capabilities.items()
                            if key in profiles
                        },
                    )
                    for row in result
                )
            return result

    def change(
        self, target_id: UUID, *, actor_id, active=None, expected_active=None, password=None
    ):
        encoded = password_hash(password) if password is not None else None
        with self.factory.begin() as session:
            self.lock(session)
            if actor_id is not None:
                authorize_credentials(session, actor_id, target_id)
            row = session.get(AccountRow, target_id)
            if row is None:
                raise AccessConflict("Account not found")
            if expected_active is not None and row.active != expected_active:
                raise AccessConflict("Account state changed; reload before saving")
            if active is False and row.is_admin:
                count = session.scalar(
                    select(func.count())
                    .select_from(AccountRow)
                    .where(AccountRow.active.is_(True), AccountRow.is_admin.is_(True))
                )
                if count <= 1 or row.id == actor_id:
                    raise AccessConflict("Keep an active administrator")
            if active is not None:
                row.active = active
            if encoded is not None:
                row.password_hash = encoded
            if encoded is not None or active is True:
                session.execute(
                    delete(LoginWindowRow).where(
                        LoginWindowRow.key == token_hash("account:" + row.username)
                    )
                )
            session.execute(delete(AuthSessionRow).where(AuthSessionRow.account_id == target_id))
            self.event(
                session,
                "account_password_reset" if encoded else "account_state_changed",
                actor_id,
                target_id,
            )
            return self.view(session, row)

    def grant(self, target_id, profile_id, role, expected_role, *, actor_id):
        if role is not None and role not in PRESETS:
            raise ValueError("Unknown profile access preset")
        with self.factory.begin() as session:
            self.lock(session)
            if not manager(session, actor_id).is_admin:
                raise AccessDenied("Administrator required for legacy profile grants")
            target = session.get(AccountRow, target_id)
            if (
                target is None
                or target.account_type is not None
                or target.is_admin
                or session.get(ProfileRow, profile_id) is None
            ):
                raise AccessConflict("Choose a non-administrator account and an existing profile")
            row = session.get(ProfileAccessRow, (target_id, profile_id))
            if (row.role if row else None) != expected_role:
                raise AccessConflict("Profile access changed; reload before saving")
            if row and normalized_capabilities(row.capabilities) != PRESETS[row.role]:
                raise AccessConflict("Capabilities changed; use explicit permissions before saving")
            if role is None:
                if row:
                    session.delete(row)
            elif row:
                row.role = role
                row.capabilities = list(PRESETS[role])
            else:
                session.add(
                    ProfileAccessRow(
                        account_id=target_id,
                        profile_id=profile_id,
                        role=role,
                        capabilities=list(PRESETS[role]),
                    )
                )
            self.event(
                session,
                "profile_access_changed",
                actor_id,
                profile_id,
                f"{target_id}:{role or 'revoked'}",
            )

    def grant_capabilities(
        self, target_id, profile_id, capabilities, expected_capabilities, *, actor_id
    ):
        desired = normalized_capabilities(capabilities) if capabilities is not None else None
        expected = (
            normalized_capabilities(expected_capabilities)
            if expected_capabilities is not None
            else None
        )
        with self.factory.begin() as session:
            self.lock(session)
            if not manager(session, actor_id).is_admin:
                raise AccessDenied("Administrator required for legacy profile grants")
            target = session.get(AccountRow, target_id)
            if (
                target is None
                or target.account_type is not None
                or target.is_admin
                or session.get(ProfileRow, profile_id) is None
            ):
                raise AccessConflict("Choose a non-administrator account and an existing profile")
            row = session.get(ProfileAccessRow, (target_id, profile_id))
            current = normalized_capabilities(row.capabilities) if row else None
            if current != expected:
                raise AccessConflict("Profile capabilities changed; reload before saving")
            if desired is None:
                if row:
                    session.delete(row)
            else:
                role = "communicator" if set(desired) <= set(PRESETS["communicator"]) else "editor"
                if row:
                    row.role, row.capabilities = role, list(desired)
                else:
                    session.add(
                        ProfileAccessRow(
                            account_id=target_id,
                            profile_id=profile_id,
                            role=role,
                            capabilities=list(desired),
                        )
                    )
            self.event(
                session,
                "profile_capabilities_changed",
                actor_id,
                profile_id,
                f"{target_id}:{','.join(desired) if desired else 'revoked'}",
            )

    def links(self, *, actor_id):
        with self.factory.begin() as session:
            actor = manager(session, actor_id)
            query = select(AccountManagementRow).order_by(
                AccountManagementRow.manager_id, AccountManagementRow.dependent_id
            )
            if not actor.is_admin:
                visible = targets(session, actor)
                query = query.where(
                    AccountManagementRow.manager_id.in_((actor.id, *visible)),
                    AccountManagementRow.dependent_id.in_(visible),
                )
            return tuple(
                {
                    "manager_id": row.manager_id,
                    "dependent_id": row.dependent_id,
                    "capabilities": normalized_capabilities(row.capabilities)
                    if row.capabilities
                    else None,
                }
                for row in session.scalars(query)
            )

    def link(
        self,
        manager_id,
        dependent_id,
        linked,
        expected_linked,
        capabilities,
        expected_capabilities,
        *,
        actor_id,
    ):
        desired = normalized_capabilities(capabilities) if capabilities is not None else None
        expected = (
            normalized_capabilities(expected_capabilities)
            if expected_capabilities is not None
            else None
        )
        with self.factory.begin() as session:
            self.lock(session)
            actor = manager(session, actor_id)
            visible = targets(session, actor)
            if not actor.is_admin and (
                dependent_id not in visible
                or (
                    manager_id != actor.id
                    and not (actor.account_type == "practitioner" and manager_id in visible)
                )
            ):
                raise AccessDenied("Account relationship is outside your scope")
            owner = session.get(AccountRow, manager_id)
            dependent = session.get(AccountRow, dependent_id)
            if (
                owner is None
                or dependent is None
                or dependent.account_type not in MANAGED_TYPES.get(owner.account_type, ())
            ):
                raise AccessDenied("Unsupported account relationship")
            if owner.is_admin:
                raise AccessDenied("Administrator access does not require relationships")
            row = session.get(AccountManagementRow, (manager_id, dependent_id))
            current = (
                normalized_capabilities(row.capabilities) if row and row.capabilities else None
            )
            if bool(row) != expected_linked or current != expected:
                raise AccessConflict("Account relationship changed; reload before saving")
            if linked and (dependent.account_type == "patient") != (desired is not None):
                raise ValueError(
                    "Patient relationships require explicit capabilities; parent links do not"
                )
            if not linked and desired is not None:
                raise ValueError("An unlinked account cannot receive capabilities")
            if not actor.is_admin:
                if owner.id != actor.id and owner.account_type != "parent":
                    raise AccessDenied("Cannot delegate adult management privileges")
                if dependent.account_type == "patient":
                    patient = session.get(PatientProfileRow, dependent.id)
                    own = (
                        set(profile_grants(session, actor).get(str(patient.profile_id), ()))
                        if patient
                        else set()
                    )
                    if not set(desired or ()) <= own or not set(current or ()) <= own:
                        raise AccessDenied("Delegated permissions exceed your profile rights")
            if not linked:
                if row:
                    session.delete(row)
            elif row:
                row.capabilities = list(desired) if desired else None
            else:
                session.add(
                    AccountManagementRow(
                        manager_id=manager_id,
                        dependent_id=dependent_id,
                        capabilities=list(desired) if desired else None,
                    )
                )
            detail = ",".join(desired) if desired else ("linked" if linked else "revoked")
            self.event(
                session, "account_link_changed", actor.id, dependent_id, f"{manager_id}:{detail}"
            )


# Computed once per worker, with no user data or configuration read at import time.
DUMMY_HASH = PASSWORDS.hash("pictoflow non-account verification only")
