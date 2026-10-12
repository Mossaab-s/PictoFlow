"""Each integration test gets a migrated schema inside a rolled-back transaction."""

import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.orm import Session

from app.config import Settings
from app.infrastructure.postgres.database import create_database_engine


def migration_config(connection) -> Config:
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    config.attributes["connection"] = connection
    return config


@pytest.fixture(scope="session")
def postgres_engine():
    url = os.environ.get("PICTOFLOW_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set PICTOFLOW_TEST_DATABASE_URL to run PostgreSQL integration tests")
    engine = create_database_engine(Settings(database_url=url, _env_file=None))
    yield engine
    engine.dispose()


@pytest.fixture
def postgres_connection(postgres_engine):
    with postgres_engine.connect() as connection:
        transaction = connection.begin()
        schema = "pcl_test_" + uuid4().hex
        try:
            connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
            connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
            command.upgrade(migration_config(connection), "head")
            yield connection
        finally:
            transaction.rollback()


@pytest.fixture
def session(postgres_connection):
    with Session(
        bind=postgres_connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    ) as session:
        yield session
