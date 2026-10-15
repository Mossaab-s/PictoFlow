"""Revocable accounts, sessions and grants. Never read or infer personal meaning."""

import re
import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy import delete, func, select, text

from app.application.access import (
    PASSWORDS,
    AccountView,
    matches_password,
    password_hash,
    token_hash,
    username,
)
from app.domain.pcl.entities import utc_now
from app.infrastructure.postgres.models import (
    AccessEventRow,
    AccountRow,
    AuthSessionRow,
    LoginWindowRow,
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
        grants = dict(
            session.execute(
                select(ProfileAccessRow.profile_id, ProfileAccessRow.role).where(
                    ProfileAccessRow.account_id == row.id
                )
            ).all()
        )
        return AccountView(
            row.id,
            row.username,
            row.display_name,
            row.is_admin,
            row.active,
            {str(key): value for key, value in grants.items()},
        )

    def create(self, login: str, display_name: str, password: str, *, admin=False, actor_id=None):
        login = username(login)
        if not 1 <= len(display_name.strip()) <= 80:
            raise ValueError("A display name is required")
        encoded = password_hash(password)
        with self.factory.begin() as session:
            self.lock(session)
            if session.scalar(select(AccountRow.id).where(AccountRow.username == login)):
                raise AccessConflict("Account already exists")
            row = AccountRow(
                username=login,
                display_name=display_name.strip(),
                password_hash=encoded,
                is_admin=admin,
                active=True,
            )
            session.add(row)
            session.flush()
            self.event(session, "account_created", actor_id, row.id)
            return self.view(session, row)

    def current(self, token: str | None):
        if not token or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
            return None
        with self.factory.begin() as session:
            row = session.scalar(
                select(AccountRow)
                .join(AuthSessionRow, AuthSessionRow.account_id == AccountRow.id)
                .where(
                    AuthSessionRow.token_hash == token_hash(token),
                    AuthSessionRow.expires_at > utc_now(),
                    AccountRow.active.is_(True),
                )
            )
            return self.view(session, row) if row else None

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
            if token:
                session.execute(
                    delete(AuthSessionRow).where(AuthSessionRow.token_hash == token_hash(token))
                )
            if actor_id is not None:
                self.event(session, "logout", actor_id, actor_id)

    def users(self):
        with self.factory.begin() as session:
            return tuple(
                self.view(session, row)
                for row in session.scalars(select(AccountRow).order_by(AccountRow.username))
            )

    def change(
        self, target_id: UUID, *, actor_id, active=None, expected_active=None, password=None
    ):
        encoded = password_hash(password) if password is not None else None
        with self.factory.begin() as session:
            self.lock(session)
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
        with self.factory.begin() as session:
            self.lock(session)
            target = session.get(AccountRow, target_id)
            if target is None or target.is_admin or session.get(ProfileRow, profile_id) is None:
                raise AccessConflict("Choose a non-administrator account and an existing profile")
            row = session.get(ProfileAccessRow, (target_id, profile_id))
            if (row.role if row else None) != expected_role:
                raise AccessConflict("Profile access changed; reload before saving")
            if role is None:
                if row:
                    session.delete(row)
            elif row:
                row.role = role
            else:
                session.add(
                    ProfileAccessRow(account_id=target_id, profile_id=profile_id, role=role)
                )
            self.event(
                session,
                "profile_access_changed",
                actor_id,
                profile_id,
                f"{target_id}:{role or 'revoked'}",
            )


# Computed once per worker, with no user data or configuration read at import time.
DUMMY_HASH = PASSWORDS.hash("pictoflow non-account verification only")
