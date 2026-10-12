"""Key construction cannot omit or inject a personal profile namespace."""

import re
from uuid import UUID

from app.application.transient import TransientKind

_REFERENCE = re.compile(r"[A-Za-z0-9_.-]{1,128}\Z")


def reference(value: str) -> str:
    if not isinstance(value, str) or not _REFERENCE.fullmatch(value):
        raise ValueError(
            "Reference must contain 1-128 letters, digits, dots, underscores or hyphens"
        )
    return value


def profile_scope(profile_id: UUID) -> str:
    if not isinstance(profile_id, UUID):
        raise ValueError("Profile scope must be a UUID")
    return str(profile_id)


def transient_key(profile_id: UUID, kind: TransientKind, token: str) -> str:
    return f"pcl:{TransientKind(kind).value}:{profile_scope(profile_id)}:{reference(token)}"


def provider_health_key(provider_id: str) -> str:
    # This global key may contain only technical provider health, never personal context.
    return f"pcl:provider-health:{reference(provider_id)}"


def rate_limit_key(profile_id: UUID, bucket: str) -> str:
    return f"pcl:rate-limit:{profile_scope(profile_id)}:{reference(bucket)}"


def validate_ttl(ttl_seconds: int) -> None:
    if type(ttl_seconds) is not int or ttl_seconds <= 0:
        raise ValueError("Transient data requires a positive integer TTL in seconds")
