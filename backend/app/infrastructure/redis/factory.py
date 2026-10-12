"""Create an optional client without connecting; credentials stay server-side."""

from urllib.parse import urlsplit

from redis.asyncio import Redis
from redis.asyncio.retry import Retry
from redis.backoff import NoBackoff

from app.application.transient import TransientStore
from app.config import Settings
from app.infrastructure.redis.disabled import DisabledTransientStore
from app.infrastructure.redis.store import RedisTransientStore


def create_transient_store(settings: Settings) -> TransientStore:
    if settings.redis_url is None:
        return DisabledTransientStore()
    url = settings.redis_url.get_secret_value()
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("redis", "rediss") or not parsed.hostname:
            raise ValueError
        if parsed.query or parsed.fragment:
            raise ValueError
        client = Redis.from_url(
            url,
            decode_responses=True,
            socket_timeout=settings.redis_timeout_seconds,
            socket_connect_timeout=settings.redis_timeout_seconds,
            retry=Retry(NoBackoff(), 0),
            protocol=2,
        )
    except ValueError:
        raise ValueError(
            "Use a redis:// or rediss:// URL without query options or fragment"
        ) from None
    return RedisTransientStore(client)
