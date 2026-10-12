"""Optional transient-storage port, separate from persistent PCL repositories."""

from enum import StrEnum
from typing import Protocol
from uuid import UUID

type JsonValue = None | bool | int | float | str | list[JsonValue] | dict[str, JsonValue]
type JsonObject = dict[str, JsonValue]


class TransientKind(StrEnum):
    SESSION = "session"
    CONTEXT = "context"
    PROVIDER_RESULT = "provider-result"
    SEMANTIC_CACHE = "cache:semantic"


class TransientHealth(StrEnum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"
    DISABLED = "disabled"


class TransientStoreUnavailable(RuntimeError):
    """The operation failed; transient state must not be reported as saved."""


class TransientStoreDisabled(TransientStoreUnavailable):
    """No transient-storage backend is configured."""


class TransientPayloadError(ValueError):
    """The supplied or stored value is not a valid JSON object."""


class TransientStore(Protocol):
    async def get(
        self, profile_id: UUID, kind: TransientKind, reference: str
    ) -> JsonObject | None: ...

    async def put(
        self,
        profile_id: UUID,
        kind: TransientKind,
        reference: str,
        value: JsonObject,
        *,
        ttl_seconds: int,
    ) -> None: ...

    async def delete(self, profile_id: UUID, kind: TransientKind, reference: str) -> bool: ...

    async def delete_profile(self, profile_id: UUID) -> int: ...

    async def get_provider_health(self, provider_id: str) -> JsonObject | None: ...

    async def put_provider_health(
        self,
        provider_id: str,
        value: JsonObject,
        *,
        ttl_seconds: int,
    ) -> None: ...

    async def increment_rate_limit(
        self,
        profile_id: UUID,
        bucket: str,
        *,
        ttl_seconds: int,
    ) -> int: ...

    async def health(self) -> TransientHealth: ...

    async def aclose(self) -> None: ...
