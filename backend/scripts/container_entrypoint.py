"""Build credential-safe container URLs, then execute the requested dev command."""

import os
import sys
from collections.abc import Mapping

from sqlalchemy.engine import URL


def container_environment(source: Mapping[str, str]) -> dict[str, str]:
    env = dict(source)
    if not env.get("PICTOFLOW_DATABASE_URL"):
        if not env.get("POSTGRES_PASSWORD"):
            raise ValueError("POSTGRES_PASSWORD is required for the local container stack")
        env["PICTOFLOW_DATABASE_URL"] = URL.create(
            "postgresql+psycopg",
            username=env.get("POSTGRES_USER", "pictoflow"),
            password=env["POSTGRES_PASSWORD"],
            host=env.get("POSTGRES_HOST", "postgres"),
            port=5432,
            database=env.get("POSTGRES_DB", "pictoflow"),
        ).render_as_string(hide_password=False)
    # Tests use random schemas/keys on these local services and never flush/drop shared data.
    env.setdefault("PICTOFLOW_TEST_DATABASE_URL", env["PICTOFLOW_DATABASE_URL"])
    if env.get("PICTOFLOW_REDIS_URL"):
        env.setdefault("PICTOFLOW_TEST_REDIS_URL", env["PICTOFLOW_REDIS_URL"])
    return env


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("A container command is required")
    try:
        env = container_environment(os.environ)
    except ValueError as failure:
        raise SystemExit(str(failure)) from None
    # Credentials are passed through the environment, never added to command-line arguments.
    os.execvpe(sys.argv[1], sys.argv[1:], env)
