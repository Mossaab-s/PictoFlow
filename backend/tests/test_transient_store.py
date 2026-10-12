import asyncio
import traceback
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from redis.exceptions import ConnectionError

from app.application.transient import (
    TransientHealth,
    TransientKind,
    TransientPayloadError,
    TransientStoreDisabled,
    TransientStoreUnavailable,
)
from app.config import Settings
from app.infrastructure.redis.disabled import DisabledTransientStore
from app.infrastructure.redis.factory import create_transient_store
from app.infrastructure.redis.keys import transient_key, validate_ttl
from app.infrastructure.redis.store import RedisTransientStore, decode, encode


@pytest.mark.parametrize("kind", list(TransientKind))
def test_personal_keys_require_profile_scope(kind):
    a, b = uuid4(), uuid4()
    assert str(a) in transient_key(a, kind, "same-reference")
    assert transient_key(a, kind, "same-reference") != transient_key(b, kind, "same-reference")


@pytest.mark.parametrize("reference", ["", "a:b", "*", "[ab]", "a/b", "x" * 129])
def test_references_cannot_inject_another_namespace(reference):
    with pytest.raises(ValueError):
        transient_key(uuid4(), TransientKind.SESSION, reference)


def test_profile_scope_cannot_be_omitted():
    with pytest.raises(ValueError):
        transient_key(None, TransientKind.SESSION, "session")


@pytest.mark.parametrize("ttl", [0, -1, 1.5, True, None])
def test_ttl_is_mandatory_and_positive(ttl):
    with pytest.raises(ValueError):
        validate_ttl(ttl)


@pytest.mark.parametrize(
    "payload", [[], {"score": float("nan")}, {1: "value"}, {"nested": {1: 2}}, {"nested": (1, 2)}]
)
def test_invalid_json_objects_are_rejected(payload):
    with pytest.raises(TransientPayloadError):
        encode(payload)


@pytest.mark.parametrize("payload", ["not-json", "[]", '{"score": NaN}', '{"score": 1e400}'])
def test_corrupt_values_are_not_returned_as_cache_hits(payload):
    with pytest.raises(TransientPayloadError):
        decode(payload)


def test_unicode_json_round_trip():
    value = {"label": "Le bruit me gêne", "blocks": ["NOISE", "STOP"]}
    assert decode(encode(value)) == value


def test_no_redis_mode_reports_disabled_and_does_not_fake_writes():
    store = create_transient_store(Settings(redis_url=None, _env_file=None))
    assert isinstance(store, DisabledTransientStore)
    assert asyncio.run(store.health()) == TransientHealth.DISABLED
    with pytest.raises(TransientStoreDisabled):
        asyncio.run(store.put(uuid4(), TransientKind.SESSION, "session", {}, ttl_seconds=30))


@pytest.mark.parametrize(
    "url", ["https://localhost", "redis://", "redis://localhost?socket_timeout=99"]
)
def test_invalid_redis_configuration_fails_without_exposing_credentials(url):
    with pytest.raises(ValueError, match="redis://"):
        create_transient_store(Settings(redis_url=url, _env_file=None))


def test_redis_credentials_are_masked_in_settings():
    settings = Settings(redis_url="redis://:sensitive@localhost/0", _env_file=None)
    assert "sensitive" not in repr(settings)
    assert "sensitive" not in settings.model_dump_json()


def test_network_failure_is_typed_and_contains_no_payload_or_credentials():
    client = AsyncMock()
    client.get.side_effect = ConnectionError("sensitive-connection-details")
    store = RedisTransientStore(client)
    with pytest.raises(TransientStoreUnavailable) as result:
        asyncio.run(store.get(uuid4(), TransientKind.SESSION, "session"))
    assert "sensitive" not in "".join(traceback.format_exception(result.value))


def test_failed_write_is_not_reported_as_success():
    client = AsyncMock()
    client.set.side_effect = ConnectionError("offline")
    with pytest.raises(TransientStoreUnavailable):
        asyncio.run(
            RedisTransientStore(client).put(
                uuid4(),
                TransientKind.SESSION,
                "session",
                {},
                ttl_seconds=30,
            )
        )


def test_health_reports_unavailable_without_raising():
    client = AsyncMock()
    client.ping.side_effect = ConnectionError("offline")
    assert asyncio.run(RedisTransientStore(client).health()) == TransientHealth.UNAVAILABLE


def test_shutdown_closes_client_connections():
    client = AsyncMock()
    asyncio.run(RedisTransientStore(client).aclose())
    client.aclose.assert_awaited_once()
