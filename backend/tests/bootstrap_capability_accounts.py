"""Synthetic account bootstrap for the separate authenticated browser-CI API."""

import os

from app.config import Settings
from app.infrastructure.postgres.access import Accounts
from app.infrastructure.postgres.database import create_database_engine, create_session_factory

settings = Settings(_env_file=None)
if settings.environment != "test" or os.environ.get("PICTOFLOW_CAPABILITY_TESTING") != "1":
    raise RuntimeError("Synthetic account bootstrap requires the isolated test environment")
engine = create_database_engine(settings)
try:
    Accounts(create_session_factory(engine)).create(
        "capability-ci-admin",
        "Administration fictive",
        "Synthetic capability CI passphrase",
        admin=True,
    )
finally:
    engine.dispose()
