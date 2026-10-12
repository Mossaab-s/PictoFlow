"""Explicit no-Redis mode; do not pretend transient state was written."""

from uuid import UUID

from app.application.transient import (
    JsonObject,
    TransientHealth,
    TransientKind,
    TransientStoreDisabled,
)


class DisabledTransientStore:
    async def delete_profile(self, profile_id: UUID) -> int:
        if not isinstance(profile_id, UUID):
            raise ValueError("Profile scope must be a UUID")
        return 0

    async def get(self, profile_id: UUID, kind: TransientKind, reference: str) -> JsonObject | None:
        raise TransientStoreDisabled("Transient storage is disabled")

    async def put(
        self,
        profile_id: UUID,
        kind: TransientKind,
        reference: str,
        value: JsonObject,
        *,
        ttl_seconds: int,
    ) -> None:
        raise TransientStoreDisabled("Transient storage is disabled")

    async def delete(self, profile_id: UUID, kind: TransientKind, reference: str) -> bool:
        raise TransientStoreDisabled("Transient storage is disabled")

    async def get_provider_health(self, provider_id: str) -> JsonObject | None:
        raise TransientStoreDisabled("Transient storage is disabled")

    async def put_provider_health(
        self,
        provider_id: str,
        value: JsonObject,
        *,
        ttl_seconds: int,
    ) -> None:
        raise TransientStoreDisabled("Transient storage is disabled")

    async def increment_rate_limit(
        self,
        profile_id: UUID,
        bucket: str,
        *,
        ttl_seconds: int,
    ) -> int:
        raise TransientStoreDisabled("Transient storage is disabled")

    async def health(self) -> TransientHealth:
        return TransientHealth.DISABLED

    async def aclose(self) -> None:
        pass
