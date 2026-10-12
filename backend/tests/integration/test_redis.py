import asyncio
import os
from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
import sqlalchemy as sa
from redis.asyncio import Redis

from app.application.transient import (
    TransientHealth,
    TransientKind,
    TransientPayloadError,
    TransientStoreUnavailable,
)
from app.config import Settings
from app.domain.pcl.entities import Concept, UserCommunicationProfile
from app.infrastructure.postgres.models import RelationRow
from app.infrastructure.postgres.repositories import (
    PostgresConceptRepository,
    PostgresProfileRepository,
)
from app.infrastructure.redis.factory import create_transient_store
from app.infrastructure.redis.keys import provider_health_key, rate_limit_key, transient_key

pytestmark = pytest.mark.redis


@pytest.fixture
def redis_url():
    url = os.environ.get("PICTOFLOW_TEST_REDIS_URL")
    if not url:
        pytest.skip("Set PICTOFLOW_TEST_REDIS_URL to run Redis integration tests")
    return url


@asynccontextmanager
async def stores(url):
    store = create_transient_store(Settings(redis_url=url, _env_file=None))
    raw = Redis.from_url(url, decode_responses=True, protocol=2)
    try:
        yield store, raw
    finally:
        await store.aclose()
        await raw.aclose()


@pytest.mark.parametrize("kind", list(TransientKind))
def test_transient_data_is_profile_scoped_and_expires(redis_url, kind):
    async def scenario():
        async with stores(redis_url) as (store, raw):
            a, b = uuid4(), uuid4()
            key = transient_key(a, kind, "same-reference")
            await store.put(a, kind, "same-reference", {"label": "Bruit"}, ttl_seconds=1)
            assert await store.health() is TransientHealth.AVAILABLE
            assert await store.get(a, kind, "same-reference") == {"label": "Bruit"}
            assert 0 <= await raw.ttl(key) <= 1
            assert await store.get(b, kind, "same-reference") is None
            assert await store.delete(b, kind, "same-reference") is False
            await asyncio.sleep(1.1)
            assert await store.get(a, kind, "same-reference") is None

    asyncio.run(scenario())


def test_provider_health_cache_has_ttl(redis_url):
    async def scenario():
        async with stores(redis_url) as (store, raw):
            provider = uuid4().hex
            try:
                await store.put_provider_health(provider, {"status": "available"}, ttl_seconds=30)
                assert await store.get_provider_health(provider) == {"status": "available"}
                assert 0 < await raw.ttl(provider_health_key(provider)) <= 30
            finally:
                await raw.delete(provider_health_key(provider))

    asyncio.run(scenario())


@pytest.mark.parametrize("payload", ["not-json", '{"score": 1e400}'])
def test_corrupt_cached_payload_is_explicit_failure(redis_url, payload):
    async def scenario():
        async with stores(redis_url) as (store, raw):
            profile_id = uuid4()
            key = transient_key(profile_id, TransientKind.SESSION, "session")
            try:
                await raw.set(key, payload, ex=30)
                with pytest.raises(TransientPayloadError):
                    await store.get(profile_id, TransientKind.SESSION, "session")
            finally:
                await raw.delete(key)

    asyncio.run(scenario())


def test_rate_limit_counter_is_atomic_scoped_and_does_not_extend_window(redis_url):
    async def scenario():
        async with stores(redis_url) as (store, raw):
            a, b = uuid4(), uuid4()
            key = rate_limit_key(a, "requests")
            try:
                counts = await asyncio.gather(
                    *(store.increment_rate_limit(a, "requests", ttl_seconds=30) for _ in range(20))
                )
                assert sorted(counts) == list(range(1, 21))
                assert await store.increment_rate_limit(b, "requests", ttl_seconds=30) == 1
                await raw.expire(key, 5)
                assert await store.increment_rate_limit(a, "requests", ttl_seconds=30) == 21
                assert 0 < await raw.ttl(key) <= 5
            finally:
                await raw.delete(key, rate_limit_key(b, "requests"))

    asyncio.run(scenario())


@pytest.mark.postgres
def test_redis_loss_does_not_change_validated_postgres_relations(session, redis_url):
    profile = UserCommunicationProfile()
    PostgresProfileRepository(session).add(profile)
    concepts = PostgresConceptRepository(session)
    noise = Concept(profile_id=profile.id, canonical_key="NOISE", label="Bruit")
    leave = Concept(profile_id=profile.id, canonical_key="LEAVE", label="Partir")
    concepts.add(profile.id, noise)
    concepts.add(profile.id, leave)
    relation = RelationRow(
        profile_id=profile.id,
        source_concept_id=noise.id,
        target_concept_id=leave.id,
        relation_type="associated_with",
        confidence=0.91,
        validation_count=1,
        status="validated",
    )
    session.add(relation)
    session.commit()

    async def evict_projection():
        async with stores(redis_url) as (store, raw):
            key = transient_key(profile.id, TransientKind.SEMANTIC_CACHE, "noise")
            # This deliberately incorrect projection cannot become authoritative.
            await store.put(
                profile.id,
                TransientKind.SEMANTIC_CACHE,
                "noise",
                {"target": "INCORRECT", "confidence": 0.01},
                ttl_seconds=30,
            )
            assert concepts.get_by_id(profile.id, leave.id) == leave
            await raw.delete(key)
            assert await store.get(profile.id, TransientKind.SEMANTIC_CACHE, "noise") is None

    asyncio.run(evict_projection())

    async def unavailable_cache():
        store = create_transient_store(
            Settings(
                redis_url="redis://127.0.0.1:1/0",
                redis_timeout_seconds=0.05,
                _env_file=None,
            )
        )
        try:
            with pytest.raises(TransientStoreUnavailable):
                await store.get(profile.id, TransientKind.SEMANTIC_CACHE, "noise")
        finally:
            await store.aclose()

    asyncio.run(unavailable_cache())
    session.expunge_all()
    persisted = session.scalar(
        sa.select(RelationRow).where(
            RelationRow.profile_id == profile.id,
            RelationRow.id == relation.id,
        )
    )
    assert persisted.status == "validated" and persisted.confidence == 0.91
    assert concepts.get_by_id(profile.id, leave.id) == leave
