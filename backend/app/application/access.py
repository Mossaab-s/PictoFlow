"""Account policy is separate from semantic roles and from the personal PCL."""

import hashlib
import hmac
import re
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

type ProfileRole = Literal["communicator", "editor"]
type ProfileCapability = Literal[
    "communicate",
    "review_meanings",
    "prepare_keyboard",
    "manage_meanings",
    "view_history",
    "export_profile",
]
CAPABILITIES = frozenset(
    (
        "communicate",
        "review_meanings",
        "prepare_keyboard",
        "manage_meanings",
        "view_history",
        "export_profile",
    )
)
PRESETS = {
    "communicator": ("communicate", "review_meanings"),
    "editor": tuple(sorted(CAPABILITIES)),
}


def normalized_capabilities(values) -> tuple[ProfileCapability, ...]:
    if (
        not isinstance(values, (tuple, list))
        or not values
        or len(values) > len(CAPABILITIES)
        or any(not isinstance(value, str) or value not in CAPABILITIES for value in values)
        or len(set(values)) != len(values)
    ):
        raise ValueError("Choose distinct supported profile capabilities")
    return tuple(sorted(values))


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
    profile_capabilities: dict[str, tuple[ProfileCapability, ...]] = field(default_factory=dict)
    assisted_profile_id: UUID | None = None


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
        "/profiles/{profile_id}/sequences/{sequence_id}/rhythm",
        "/profiles/{profile_id}/interpretations",
        "/profiles/{profile_id}/interpretations/{interpretation_id}",
        "/profiles/{profile_id}/interpretations/{interpretation_id}/ai-context",
        "/profiles/{profile_id}/memory",
        "/profiles/{profile_id}/memory-suggestions",
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
        ("POST", "/profiles/{profile_id}/sequences/{sequence_id}/memory-proposals"),
        ("POST", "/profiles/{profile_id}/interpretations/{interpretation_id}/feedback"),
        ("POST", "/profiles/{profile_id}/offline-drafts"),
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


CORE_READS = frozenset(
    {
        "/profiles/{profile_id}/concepts",
        "/profiles/{profile_id}/representations",
        "/profiles/{profile_id}/blocks",
        "/profiles/{profile_id}/keyboard",
        "/profiles/{profile_id}/keyboard-groups",
        "/profiles/{profile_id}/representations/{representation_id}/photo",
    }
)
MEANING_WRITES = frozenset(
    {
        ("POST", "/profiles/{profile_id}/concepts"),
        ("PATCH", "/profiles/{profile_id}/concepts/{concept_id}"),
        ("POST", "/profiles/{profile_id}/relations"),
        ("PATCH", "/profiles/{profile_id}/relations/{relation_id}/confidence"),
        ("POST", "/profiles/{profile_id}/relations/{relation_id}/feedback"),
        ("POST", "/profiles/{profile_id}/relations/{relation_id}/correction"),
        ("POST", "/profiles/{profile_id}/suggestions/{gap_id}/decision"),
    }
)


def permits(
    account: AccountView,
    role: str | None,
    method: str,
    route: str,
    *,
    capabilities: tuple[ProfileCapability, ...] | None = None,
) -> bool:
    """Evaluate exact operations. The HTTP boundary always supplies persisted capabilities.

    The role-only form remains a preset-policy compatibility helper, not an HTTP
    fallback when an explicit grant is missing.
    """
    if account.is_admin:
        return True
    if account.assisted_profile_id is not None and (
        route
        in {
            "/profiles/{profile_id}/communication-snapshot",
            "/profiles/{profile_id}/offline-drafts",
        }
    ):
        return False
    granted = set(PRESETS.get(role, ()) if capabilities is None else capabilities)
    if not granted or not granted <= CAPABILITIES:
        return False
    if method == "GET":
        if route == "/profiles/{profile_id}":
            return True
        if route == "/profiles/{profile_id}/backup":
            return "export_profile" in granted
        if route in CORE_READS:
            return bool(granted - {"export_profile"})
        if route in COMMUNICATION_READS:
            return bool(
                granted & {"communicate", "review_meanings", "prepare_keyboard", "view_history"}
            )
        if route == "/profiles/{profile_id}/relations":
            return bool(granted & {"manage_meanings", "view_history"})
        if route == "/profiles/{profile_id}/suggestions":
            return bool(granted & {"manage_meanings", "prepare_keyboard", "view_history"})
        return route == "/profiles/{profile_id}/audit" and "view_history" in granted
    operation = method, route
    if operation == ("POST", "/profiles/{profile_id}/interpretations/{interpretation_id}/feedback"):
        return "review_meanings" in granted
    if operation in COMMUNICATION_WRITES:
        return "communicate" in granted
    if operation in MEANING_WRITES:
        return "manage_meanings" in granted
    if operation == ("POST", "/profiles/{profile_id}/suggestions/detect"):
        return bool(granted & {"prepare_keyboard", "manage_meanings"})
    return operation in PREPARATION_WRITES and "prepare_keyboard" in granted
