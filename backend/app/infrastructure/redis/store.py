"""Async Redis JSON adapter. No persistent repository or domain state is accessed."""

import json
import math
from uuid import UUID

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.application.transient import (
    JsonObject,
    TransientHealth,
    TransientKind,
    TransientPayloadError,
    TransientStoreUnavailable,
)
from app.infrastructure.redis.keys import (
    profile_scope,
    provider_health_key,
    rate_limit_key,
    transient_key,
    validate_ttl,
)

# The counter and its expiry are created atomically. Later increments do not
# extend the window. Repair a missing TTL too, so counters cannot become permanent.
_INCREMENT = """
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
"""


def validate_json(item) -> None:
    if isinstance(item, dict):
        if any(not isinstance(key, str) for key in item):
            raise ValueError
        for child in item.values():
            validate_json(child)
    elif isinstance(item, list):
        for child in item:
            validate_json(child)
    elif isinstance(item, float):
        if not math.isfinite(item):
            raise ValueError
    elif item is not None and not isinstance(item, (bool, int, str)):
        raise ValueError


def encode(value: JsonObject) -> str:

    try:
        if not isinstance(value, dict):
            raise ValueError
        validate_json(value)
        return json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        raise TransientPayloadError("Transient value must be a valid JSON object") from None


def decode(value: str) -> JsonObject:
    def reject_constant(token: str):
        raise ValueError

    try:
        result = json.loads(value, parse_constant=reject_constant)
        if not isinstance(result, dict):
            raise ValueError
        validate_json(result)
        return result
    except (TypeError, ValueError, RecursionError):
        raise TransientPayloadError("Stored transient value is not a valid JSON object") from None


class RedisTransientStore:
    def __init__(self, client: Redis):
        self._client = client

    async def delete_profile(self, profile_id: UUID) -> int:
        scope = profile_scope(profile_id)
        deleted = 0
        try:
            for prefix in [kind.value for kind in TransientKind] + ["rate-limit"]:
                async for key in self._client.scan_iter(match=f"pcl:{prefix}:{scope}:*", count=100):
                    deleted += await self._client.delete(key)
        except RedisError:
            raise TransientStoreUnavailable("Profile transient erasure failed") from None
        return deleted

    async def get(self, profile_id: UUID, kind: TransientKind, reference: str) -> JsonObject | None:
        return await self._get(transient_key(profile_id, kind, reference))

    async def put(
        self,
        profile_id: UUID,
        kind: TransientKind,
        reference: str,
        value: JsonObject,
        *,
        ttl_seconds: int,
    ) -> None:
        await self._put(transient_key(profile_id, kind, reference), value, ttl_seconds)

    async def delete(self, profile_id: UUID, kind: TransientKind, reference: str) -> bool:
        key = transient_key(profile_id, kind, reference)
        try:
            return bool(await self._client.delete(key))
        except RedisError:
            raise TransientStoreUnavailable("Redis transient store is unavailable") from None

    async def get_provider_health(self, provider_id: str) -> JsonObject | None:
        return await self._get(provider_health_key(provider_id))

    async def put_provider_health(
        self,
        provider_id: str,
        value: JsonObject,
        *,
        ttl_seconds: int,
    ) -> None:
        await self._put(provider_health_key(provider_id), value, ttl_seconds)

    async def increment_rate_limit(
        self,
        profile_id: UUID,
        bucket: str,
        *,
        ttl_seconds: int,
    ) -> int:
        key = rate_limit_key(profile_id, bucket)
        validate_ttl(ttl_seconds)
        try:
            return int(await self._client.eval(_INCREMENT, 1, key, ttl_seconds))
        except RedisError:
            raise TransientStoreUnavailable("Redis transient store is unavailable") from None

    async def health(self) -> TransientHealth:
        try:
            return (
                TransientHealth.AVAILABLE
                if await self._client.ping()
                else TransientHealth.UNAVAILABLE
            )
        except RedisError:
            return TransientHealth.UNAVAILABLE

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get(self, key: str) -> JsonObject | None:
        try:
            value = await self._client.get(key)
        except UnicodeDecodeError:
            raise TransientPayloadError("Stored transient value is not valid UTF-8") from None
        except RedisError:
            raise TransientStoreUnavailable("Redis transient store is unavailable") from None
        return None if value is None else decode(value)

    async def _put(self, key: str, value: JsonObject, ttl_seconds: int) -> None:
        validate_ttl(ttl_seconds)
        payload = encode(value)
        try:
            await self._client.set(key, payload, ex=ttl_seconds)
        except RedisError:
            raise TransientStoreUnavailable("Redis transient store is unavailable") from None
