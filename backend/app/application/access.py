"""Account policy is separate from semantic roles and from the personal PCL."""

import hashlib
import hmac
import re
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

type ProfileRole = Literal["communicator", "editor"]
PASSWORDS = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)


def username(value: str) -> str:
    value = value.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,79}", value):
        raise ValueError("Use 3 to 80 letters, numbers, periods, underscores or hyphens")
    return value


def password_hash(value: str) -> str:
    if not 15 <= len(value) <= 256 or not value.strip():
        raise ValueError("Use a passphrase of 15 to 256 characters")
    return PASSWORDS.hash(value)


def matches_password(encoded: str, value: str) -> bool:
    try:
        return PASSWORDS.verify(encoded, value)
    except (VerificationError, InvalidHashError, UnicodeError):
        return False


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def csrf_token(token: str) -> str:
    return hmac.new(token.encode(), b"pictoflow:csrf:v1", hashlib.sha256).hexdigest()


@dataclass(frozen=True)
class AccountView:
    id: UUID
    username: str
    display_name: str
    is_admin: bool
    active: bool
    profile_access: dict[str, ProfileRole]


# Exact route templates. New endpoints must be explicitly classified before use.
COMMUNICATION_READS = frozenset(
    {
        "/profiles/{profile_id}",
        "/profiles/{profile_id}/concepts",
        "/profiles/{profile_id}/representations",
        "/profiles/{profile_id}/blocks",
        "/profiles/{profile_id}/keyboard",
        "/profiles/{profile_id}/keyboard-groups",
        "/profiles/{profile_id}/communication-snapshot",
        "/profiles/{profile_id}/sequences",
        "/profiles/{profile_id}/sequences/{sequence_id}",
        "/profiles/{profile_id}/interpretations",
        "/profiles/{profile_id}/interpretations/{interpretation_id}",
        "/profiles/{profile_id}/memory",
        "/profiles/{profile_id}/phrases/{interpretation_id}",
        "/profiles/{profile_id}/representations/{representation_id}/photo",
        "/profiles/{profile_id}/feedback",
    }
)
COMMUNICATION_WRITES = frozenset(
    {
        ("POST", "/profiles/{profile_id}/sequences"),
        ("POST", "/profiles/{profile_id}/sequences/{sequence_id}/selection"),
        ("POST", "/profiles/{profile_id}/sequences/{sequence_id}/interpret"),
        ("POST", "/profiles/{profile_id}/interpretations/{interpretation_id}/feedback"),
        ("POST", "/profiles/{profile_id}/offline-drafts"),
    }
)

PREPARATION_READS = COMMUNICATION_READS | frozenset(
    {
        "/profiles/{profile_id}/relations",
        "/profiles/{profile_id}/suggestions",
        "/profiles/{profile_id}/audit",
        "/profiles/{profile_id}/ai-quality",
        "/profiles/{profile_id}/backup",
    }
)
PREPARATION_WRITES = COMMUNICATION_WRITES | frozenset(
    {
        ("PATCH", "/profiles/{profile_id}"),
        ("POST", "/profiles/{profile_id}/concepts"),
        ("PATCH", "/profiles/{profile_id}/concepts/{concept_id}"),
        ("POST", "/profiles/{profile_id}/relations"),
        ("PATCH", "/profiles/{profile_id}/relations/{relation_id}/confidence"),
        ("POST", "/profiles/{profile_id}/relations/{relation_id}/feedback"),
        ("POST", "/profiles/{profile_id}/relations/{relation_id}/correction"),
        ("POST", "/profiles/{profile_id}/representations"),
        ("PATCH", "/profiles/{profile_id}/representations/{representation_id}"),
        ("POST", "/profiles/{profile_id}/representations/{representation_id}/archive"),
        ("POST", "/profiles/{profile_id}/representations/{representation_id}/feedback"),
        ("POST", "/profiles/{profile_id}/blocks"),
        ("POST", "/profiles/{profile_id}/blocks/{block_id}/representation"),
        ("POST", "/profiles/{profile_id}/blocks/personal"),
        ("POST", "/profiles/{profile_id}/blocks/{block_id}/feedback"),
        ("PUT", "/profiles/{profile_id}/blocks/{block_id}/pictogram"),
        ("PATCH", "/profiles/{profile_id}/phrases/{interpretation_id}/shortcut"),
        ("DELETE", "/profiles/{profile_id}/memory"),
        ("POST", "/profiles/{profile_id}/suggestions/detect"),
        ("POST", "/profiles/{profile_id}/suggestions/{gap_id}/decision"),
        ("POST", "/profiles/{profile_id}/suggestions/{gap_id}/block"),
        ("POST", "/profiles/{profile_id}/keyboard-groups"),
        ("PUT", "/profiles/{profile_id}/keyboard-groups/order"),
        ("PATCH", "/profiles/{profile_id}/keyboard-groups/{group_id}"),
        ("POST", "/profiles/{profile_id}/keyboard-groups/{group_id}/removal-preview"),
        ("POST", "/profiles/{profile_id}/keyboard-groups/{group_id}/remove"),
        ("POST", "/profiles/{profile_id}/keyboard/{block_id}/move-preview"),
        ("POST", "/profiles/{profile_id}/keyboard/{block_id}/move"),
        ("PUT", "/profiles/{profile_id}/keyboard/{block_id}"),
        ("POST", "/profiles/{profile_id}/blocks/photo"),
        ("PUT", "/profiles/{profile_id}/blocks/{block_id}/photo"),
        ("DELETE", "/profiles/{profile_id}/representations/{representation_id}/photo"),
    }
)


def permits(account: AccountView, role: str | None, method: str, route: str) -> bool:
    if account.is_admin:
        return True
    if role == "editor":
        return (method == "GET" and route in PREPARATION_READS) or (
            method,
            route,
        ) in PREPARATION_WRITES
    return role == "communicator" and (
        (method == "GET" and route in COMMUNICATION_READS)
        or (method, route) in COMMUNICATION_WRITES
    )
