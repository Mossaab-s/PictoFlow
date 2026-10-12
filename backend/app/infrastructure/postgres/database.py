"""Explicit engine creation and transaction ownership; no import-time connections."""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings


def create_database_engine(settings: Settings) -> Engine:
    if settings.database_url is None:
        raise ValueError("PICTOFLOW_DATABASE_URL is required for persistence operations")
    url = make_url(settings.database_url.get_secret_value())
    if url.drivername != "postgresql+psycopg":
        raise ValueError("Use a postgresql+psycopg database URL")
    return create_engine(url, pool_pre_ping=True, hide_parameters=True)


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


@contextmanager
def transaction(factory: sessionmaker[Session]) -> Iterator[Session]:
    """Commit all changes together; exceptions roll back and always close the session."""
    with factory.begin() as session:
        yield session
