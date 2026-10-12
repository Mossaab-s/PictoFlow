"""Shared business invariants, independent from transport and persistence."""

import math
from datetime import datetime
from uuid import UUID


class DomainInvariantError(ValueError):
    """A PCL object or state violates a business invariant."""


def identifier(value, name: str) -> None:
    if not isinstance(value, UUID):
        raise DomainInvariantError(f"{name} must be a UUID")


def text(value, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise DomainInvariantError(f"{name} must be nonempty text")


def timestamp(value, name: str) -> None:
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise DomainInvariantError(f"{name} must be a timezone-aware datetime")


def confidence(value) -> None:
    if type(value) not in (int, float) or not 0 <= value <= 1 or not math.isfinite(value):
        raise DomainInvariantError("Confidence must be a finite number between 0 and 1")


def count(value, name: str, *, minimum: int = 0) -> None:
    if type(value) is not int or value < minimum:
        raise DomainInvariantError(f"{name} must be an integer >= {minimum}")


def identity_and_dates(entity) -> None:
    identifier(entity.id, "id")
    if hasattr(entity, "profile_id"):
        identifier(entity.profile_id, "profile_id")
    timestamp(entity.created_at, "created_at")
    if hasattr(entity, "updated_at"):
        timestamp(entity.updated_at, "updated_at")
        if entity.updated_at < entity.created_at:
            raise DomainInvariantError("updated_at must not precede created_at")


def enum_field(entity, name: str, enum_type) -> None:
    try:
        object.__setattr__(entity, name, enum_type(getattr(entity, name)))
    except (ValueError, TypeError):
        raise DomainInvariantError(f"Invalid {name}") from None
