# Local Docker Compose development stack

DEPLOY-022 provides a local stack containing PostgreSQL 18, Redis 8 and the
PictoFlow FastAPI backend. This is a development environment with reload and
test tools. The Next.js admin (#17) runs locally against the backend
API; no admin container is required at this stage.

## Prerequisites and initial configuration

Use Docker Engine with Linux containers and a modern Docker Compose plugin
supporting `up --wait`. On Windows, Docker Desktop must be installed and running
in Linux-container mode. Python is used once to generate the ignored local `.env`.

From the repository root:

```powershell
python deploy/init_env.py
docker compose --env-file .env -f deploy/docker-compose.yml config --quiet
docker compose --env-file .env -f deploy/docker-compose.yml up --build --wait --wait-timeout 180
```

`init_env.py` copies `.env.example`, generates a random development database
password and never prints it. It uses exclusive file creation and preserves an
existing `.env`. If one already exists, set its `POSTGRES_PASSWORD` locally
instead of overwriting your native development configuration. The example
contains no password value; Compose fails explicitly when this value is absent.

The `.env` and portable test tools are ignored by Git and excluded from the
Docker build context. `config --quiet` validates configuration without displaying
its resolved credentials.

## Running services

| Service | Access | State |
| --- | --- | --- |
| Backend | `http://127.0.0.1:8000` by default | Source bind mount; reload watches `app/` |
| PostgreSQL | `postgres:5432` inside the Compose network | Named `postgres_data` volume |
| Redis | `redis:6379` inside the Compose network | No disk persistence; disposable values |

The backend is bound only to localhost. PostgreSQL and Redis ports are not
published to the host. The backend waits for their health checks on initial
stack startup; its `/health` endpoint still reports process liveness rather than
continuous dependency readiness.

Verify the API at `/health`, `/api/v1/health` and `/docs`. Change
`PICTOFLOW_BACKEND_PORT` in `.env` if port 8000 is already in use.

The image runs the backend as an unprivileged user, contains editable application
and dev dependencies, and uses a root build-context allowlist. Source, migration
and test changes are available through the backend bind mount. Rebuild after
changing dependencies, Dockerfile or deployment helpers.

The development image includes bundled fake fixtures. `PICTOFLOW_AI_PROVIDER`
defaults to `disabled`; set it to `fake` in `.env` and recreate the backend to
switch modes:

```powershell
docker compose --env-file .env -f deploy/docker-compose.yml up -d --force-recreate backend
```

Neither mode requires an external AI endpoint or PRISM. A custom fake fixture
path must be a container-visible absolute path, such as
`/workspace/backend/app/ai/fixtures/local.json`, supplied with `run -e` when
needed. A native Windows fixture path is not automatically passed into the
container. See [LOCAL_PROVIDERS.md](LOCAL_PROVIDERS.md).

## Configuration inside containers

Compose passes the PostgreSQL host/user/database/password as individual server
environment variables. The Python entrypoint builds a correctly escaped
`postgresql+psycopg` URL, including passwords with reserved URL characters, then
executes the requested command. Credentials are not appended to command lines.

`PICTOFLOW_DATABASE_URL` and `PICTOFLOW_REDIS_URL` in a native `.env` do not
redirect Compose to host services. Compose explicitly uses its own service DNS
names. Tests receive separate `PICTOFLOW_TEST_*` variables targeting these local
services; PostgreSQL tests roll back random schemas and Redis tests use only
their random keys.

Use `compose run` for migration/test commands so they pass through the image's
entrypoint. A plain `compose exec ... python -m alembic` does not inherit URLs
computed by the original entrypoint; if using exec, invoke the entrypoint helper
explicitly.

## Migrations and tests

From the repository root after the services are up:

```powershell
docker compose --env-file .env -f deploy/docker-compose.yml run --rm backend python -m alembic upgrade head
docker compose --env-file .env -f deploy/docker-compose.yml run --rm backend python -m alembic current
docker compose --env-file .env -f deploy/docker-compose.yml run --rm backend python -m alembic check
docker compose --env-file .env -f deploy/docker-compose.yml run --rm -e PICTOFLOW_ENVIRONMENT=test backend python -m pytest
```

Migrations are explicit and are not automatically applied on backend startup.
The complete pytest command includes PostgreSQL and Redis integration tests and
does not require an LLM. To run with fake AI configuration:

```powershell
docker compose --env-file .env -f deploy/docker-compose.yml run --rm -e PICTOFLOW_ENVIRONMENT=test -e PICTOFLOW_AI_PROVIDER=fake backend python -m pytest
```

Lint and formatting checks:

```powershell
docker compose --env-file .env -f deploy/docker-compose.yml run --rm backend python -m ruff check .
docker compose --env-file .env -f deploy/docker-compose.yml run --rm backend python -m ruff format --check .
```

Inspect the local services through Compose:

```powershell
docker compose --env-file .env -f deploy/docker-compose.yml ps
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail 50 backend
docker compose --env-file .env -f deploy/docker-compose.yml exec postgres psql -U pictoflow -d pictoflow
docker compose --env-file .env -f deploy/docker-compose.yml exec redis redis-cli ping
```

If you change `POSTGRES_USER` or `POSTGRES_DB`, adapt the psql arguments. Keep the
generated `.env` across restarts: changing its password does not update the role
inside an already initialized PostgreSQL volume.

## Shutdown and data

```powershell
docker compose --env-file .env -f deploy/docker-compose.yml down
```

This stops the stack while preserving PostgreSQL's named volume. Redis memory
is disposable. To deliberately reset all local database data, use
`down --volumes`; that operation removes the PostgreSQL development volume and
requires re-running migrations afterward.

The volume is mounted at `/var/lib/postgresql`, the parent of PostgreSQL 18's
version-specific data directory, as required by the
[official PostgreSQL image](https://hub.docker.com/_/postgres).

## Real stack smoke test and CI

```powershell
python deploy/smoke_test.py
```

This starts a separate, randomly named Compose project with a generated test
password and an automatically allocated localhost port. It checks stack health,
the HTTP endpoint, Alembic upgrade/schema consistency and the full suite in
disabled/fake modes. It then removes only that smoke project's containers and
volumes. The normal `pictoflow-dev` stack and its data are not reset.

The `Local Compose stack` workflow executes this check on an Ubuntu runner with
Docker. The existing backend workflow separately runs native tests with
PostgreSQL/Redis services.

For this implementation, the official Compose CLI validates the manifest and
the backend suite runs locally against native PostgreSQL/Redis. The development
machine has no Docker engine, so image build/container startup and the new CI
smoke job have not yet been executed here. Full DEPLOY-022 runtime acceptance
remains to be confirmed by that smoke test on a Docker-equipped host.

The native disposable demo and current implementation status are documented in
[DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md). Administration setup is in
[admin/README.md](../admin/README.md).
