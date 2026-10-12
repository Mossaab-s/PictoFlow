# Redis transient storage

CACHE-016 provides an optional async Redis adapter under
`backend/app/infrastructure/redis`. The application port is
`app/application/transient.py`; the PCL domain does not import Redis, the
application port or configuration.

PostgreSQL remains authoritative for validated relations, confirmed blocks,
personal validated memory and audit. Redis holds disposable values or cached
projections, never the only copy of persistent PCL knowledge. The Redis adapter
has no reference to a persistent repository and cannot promote proposals.

## Key scope and supported operations

| Kind | Key | Use |
| --- | --- | --- |
| `SESSION` | `pcl:session:{profile_id}:{reference}` | Current session state |
| `CONTEXT` | `pcl:context:{profile_id}:{reference}` | Temporary declared context |
| `PROVIDER_RESULT` | `pcl:provider-result:{profile_id}:{reference}` | Transient unvalidated provider output |
| `SEMANTIC_CACHE` | `pcl:cache:semantic:{profile_id}:{reference}` | Disposable lookup projection |
| Provider health | `pcl:provider-health:{provider_id}` | Technical health metadata only |
| Rate limit | `pcl:rate-limit:{profile_id}:{bucket}` | Temporary per-profile counter |

`get`, `put` and `delete` always require a UUID profile and one of the allowed
personal kinds. References contain 1-128 ASCII letters, digits, dots, underscores
or hyphens; separators and Redis glob patterns are rejected. Semantic-cache
references may be query hashes, but a hash never replaces the profile namespace.

Provider-health keys are global because they describe a provider, not a person.
Do not place prompts, user context, communication content or personal results in
these values. Personal provider responses use `PROVIDER_RESULT` instead.

## TTLs and payloads

Every write requires an explicit positive integer `ttl_seconds`. The adapter uses
one Redis `SET ... EX` operation so a successful JSON write always has an expiry.
The caller chooses the TTL according to the use case; this foundation does not
decide memory-retention policy.

Payloads are JSON objects, including nested lists/objects. Non-string object
keys, non-finite numeric values and invalid/corrupted JSON are rejected with a
`TransientPayloadError`. Invalid payloads do not become cache hits.

`increment_rate_limit` uses one Lua operation to increment and attach a TTL
atomically. Subsequent increments keep the original expiry rather than extending
the window. A counter with a missing TTL is repaired. This supplies a counter,
not an HTTP rate-limit policy; no endpoints are rate-limited yet.

## Failure policy and lifecycle

| Situation | Result |
| --- | --- |
| `PICTOFLOW_REDIS_URL` unset | Disabled adapter; `health()` returns `disabled` |
| Redis responds to ping | `health()` returns `available` |
| Connection, timeout, authentication or server failure | `health()` returns `unavailable` |
| Missing/expired key on available Redis | `get()` returns `None` |
| Operation while disabled | Raises `TransientStoreDisabled` |
| Failed Redis operation | Raises `TransientStoreUnavailable` |
| Invalid local or stored JSON | Raises `TransientPayloadError` |

An outage is distinct from a cache miss. Application services may recompute an
optional cached projection from PostgreSQL after a transient-store error, but
must not claim a failed session/context write succeeded. There is no implicit
in-memory fallback and no silent promotion of temporary data to persistent state.
This issue implements the port and adapter; business workflows will handle its
typed errors when introduced by their own issues.

Valid Redis configuration creates a client without connecting at backend startup.
The FastAPI lifespan closes its client/pool at shutdown. The `/health` endpoint
reports process liveness independently of Redis availability. Invalid URL syntax
is an explicit configuration error rather than a disabled backend.

Connect and command timeouts are configurable (default 0.5 seconds); automatic
retries are disabled. URLs support `redis://` and `rediss://`, without query
options that could override timeout/response configuration. Redis URLs use
`SecretStr`; operational errors expose a static message without raw payloads or
connection details. The adapter does not log communication content.

## Verification

Tests cover real TTL expiry, all personal key kinds, cross-profile reads/deletes,
provider health TTL, concurrent atomic counters, explicit disabled/unavailable
behavior, application startup, connection cleanup and corrupted payloads. A
PostgreSQL/Redis integration test stores a deliberately incorrect semantic cache
projection, removes it, and reloads the authoritative validated relation from
PostgreSQL unchanged. The domain boundary test still imports every PCL module
with site packages disabled.

Local test helpers start disposable servers and stop them afterward. Integration
tests never call `FLUSHDB` or `FLUSHALL`; they touch only their random test keys.
See [backend/README.md](../backend/README.md) for test environment variables and
commands. The CI job provisions PostgreSQL and Redis; it has no deployment step.
