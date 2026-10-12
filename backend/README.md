# PictoFlow backend

TECH-014 provides the FastAPI bootstrap and DB-015 adds PostgreSQL persistence.
CACHE-016 adds optional Redis transient storage. Python 3.12 or newer is required.
AI-018 adds bounded Pydantic contracts and the async `AIProvider` protocol.
AI-019 implements deterministic FakeProvider and explicit DisabledProvider.
External AI integrations come in later issues.

## Local development

For the three-service Docker Compose setup, explicit migrations and container
test commands, see [docs/LOCAL_DEVELOPMENT.md](../docs/LOCAL_DEVELOPMENT.md).
The commands below run the backend directly on the host.

Run these commands from `backend/`:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m uvicorn app.main:app --reload
```

On Linux/macOS, use `.venv/bin/python` instead of `.venv\Scripts\python`.

The API listens on `http://127.0.0.1:8000`. Available endpoints:

- `GET /health`: process liveness, returning `{"status":"healthy"}`.
- `GET /api/v1/health`: the same endpoint through the versioned API router.
- `/docs`: Swagger UI.
- `/openapi.json`: generated API contract.

Health currently reports process liveness only; it does not assert database,
cache or provider readiness.

## Configuration

Optionally copy the repository root `.env.example` to `.env`. The backend loads
this file regardless of the working directory. Environment variables take
precedence over the file.

| Variable | Default | Values |
| --- | --- | --- |
| `PICTOFLOW_APP_NAME` | `PictoFlow` | Nonempty application title |
| `PICTOFLOW_ENVIRONMENT` | `development` | `development`, `test`, `production` |
| `PICTOFLOW_DEBUG` | `false` | Boolean; enable only for local debugging |
| `PICTOFLOW_DATABASE_URL` | Unset | `postgresql+psycopg://user:password@host:port/database` |
| `PICTOFLOW_REDIS_URL` | Unset | `redis://` or `rediss://` URL; unset means disabled |
| `PICTOFLOW_REDIS_TIMEOUT_SECONDS` | `0.5` | Connect/command timeout, greater than 0 and at most 10 seconds |
| `PICTOFLOW_AI_PROVIDER` | `disabled` | `disabled` or `fake`; both work without external AI |
| `PICTOFLOW_FAKE_PROVIDER_FIXTURES` | Unset | Absolute UTF-8 JSON fixture path; unset uses bundled samples |

The HTTP bootstrap still starts without PostgreSQL, Redis or AI credentials.
Persistence and migration commands require a configured PostgreSQL database.
Database credentials are masked in settings serialization; no URL is stored in
`alembic.ini`.

Redis clients are created in the FastAPI lifespan without a startup network call
and are closed at shutdown. `/health` remains a process liveness check. It is
healthy when Redis is disabled or unavailable; `app.state.transient_store.health()`
reports that dependency's separate `disabled`, `unavailable` or `available` state.

Transient operations raise `TransientStoreDisabled` or `TransientStoreUnavailable`
on failure, so a session write is never silently reported as saved. Future use
cases must handle these states explicitly. No in-memory fallback is enabled.
See [docs/TRANSIENT_STORAGE.md](../docs/TRANSIENT_STORAGE.md) for keys, TTLs and
failure behavior.

## Local AI providers

Disabled mode initializes normally and reports disabled provider health. Its
AI operations raise `ProviderDisabledError`. Fake mode uses exact request/response
fixtures for interpretation, simplification and representation proposals. A
missing fixture raises `ProviderFixtureNotFound`; no inferred fallback is used.

The backend exposes its selected validation manager at `app.state.ai_provider`.
It revalidates both requests and provider responses and never writes PCL state.
No public AI business endpoints are added at this stage. See
[docs/LOCAL_PROVIDERS.md](../docs/LOCAL_PROVIDERS.md) for the fixture format,
bundled examples, error types and provider boundary tests.

## PostgreSQL and migrations

Create an empty local development database using your PostgreSQL installation.
Set `PICTOFLOW_DATABASE_URL` in the repository's ignored `.env`, then run from
`backend/`:

```powershell
.venv\Scripts\python -m alembic upgrade head
.venv\Scripts\python -m alembic current
```

To undo the initial schema in a disposable development database:

```powershell
.venv\Scripts\python -m alembic downgrade base
```

Downgrading to `base` removes the PCL tables and their data. The integration suite
tests this operation inside isolated, temporary schemas.

The initial revision is a frozen schema and does not import current model
metadata. Future schema changes must use new Alembic revisions.

See [docs/PERSISTENCE.md](../docs/PERSISTENCE.md) for table scope, transaction
ownership, history protections and deletion behavior.

## Verification

From `backend/`:

```powershell
.venv\Scripts\python -m pytest
.venv\Scripts\python -m ruff check .
.venv\Scripts\python -m ruff format --check .
```

Tests use explicit settings without loading the developer's `.env`. The domain
boundary test runs a fresh isolated Python process with site packages disabled
and imports every domain module. This keeps infrastructure dependencies out of
the PCL even when those packages are installed in the development environment.

The plain pytest command skips PostgreSQL integration tests when
`PICTOFLOW_TEST_DATABASE_URL` is absent. To run them against an existing local
test database, set that environment variable to a `postgresql+psycopg` URL. The
account needs permission to create schemas. Each test creates a random schema,
runs the real Alembic migration, and rolls back the entire schema afterward.

Alternatively, with PostgreSQL binaries available, run the complete suite
against a temporary server without installing a Windows service:

```powershell
.venv\Scripts\python scripts/test_with_postgres.py --bin-dir PATH_TO_POSTGRES_BIN
```

The helper creates a cluster under the ignored `.local/` directory, listens only
on localhost with a random password and port, then stops and removes the cluster.
On Unix, run it as a normal non-root account. On this workspace, the portable
binaries are available at `../.local/pgsql/bin`.

Redis integration tests require `PICTOFLOW_TEST_REDIS_URL`. They use random
profile/provider identifiers and delete their own keys or let short TTLs expire;
they never flush a Redis database. Tests that cover both stores require both
test URLs.

To run the full suite with two disposable local servers, add the Redis binary:

```powershell
.venv\Scripts\python scripts/test_with_postgres.py --bin-dir PATH_TO_POSTGRES_BIN --redis-server PATH_TO_REDIS_SERVER
```

The Redis helper binds only to localhost, uses a random password and port,
disables disk persistence, and stops the server after verification. It requires
a Redis server binary already present on the machine; it does not install a
service. This workspace has a community Windows build at
`../.local/redis/Redis-8.10.2-Windows-x64-msys2/redis-server.exe`, downloaded from
[redis-windows releases](https://github.com/redis-windows/redis-windows/releases/tag/8.10.2)
and checked against the release's SHA-256 digest.

GitHub Actions runs all tests against PostgreSQL 18 and Redis 8 services on Python
3.12 and 3.13. Its database credentials are used only by the disposable CI service.

## Package boundaries

The pure PCL core and example are documented in [PCL_CORE.md](../docs/PCL_CORE.md).
The semantic service supports concepts, directed relations, explicit human
feedback, scoped queries and atomic history; see
[SEMANTIC_SPACE.md](../docs/SEMANTIC_SPACE.md) for usage and transaction semantics.
Apply `alembic upgrade head` to include the validation actor-role migration.

The AI boundary exposes `interpret`, `simplify`, `suggest_representation` and
`health`. Outputs remain proposals; Pydantic parsing is separate from human
semantic validation. See [docs/AI_CONTRACTS.md](../docs/AI_CONTRACTS.md) for limits,
statuses, optional metadata, example payloads and parsing rules.

- `app/domain/pcl`: pure Python semantic models and invariants (PCL-001).
- `app/application`: use cases and coordination through interfaces.
- `app/api`: HTTP routes and transport schemas.
- `app/infrastructure/postgres`: persistent state adapters (DB-015).
- `app/infrastructure/redis`: cache and transient-state adapters (CACHE-016).
- `app/ai`: optional provider contracts and implementations (AI-018 onward).

Dependencies point inward. The PCL must never import the API, configuration,
application orchestration, infrastructure or AI adapters. AI responses remain
unvalidated proposals; the PCL controls explicit human validation.
