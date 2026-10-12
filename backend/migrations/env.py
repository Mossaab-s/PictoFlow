"""Read database configuration without keeping credentials in alembic.ini."""

from alembic import context

from app.config import Settings
from app.infrastructure.postgres.database import create_database_engine
from app.infrastructure.postgres.models import Base

config = context.config
target_metadata = Base.metadata


def migrate(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    settings = Settings()
    if settings.database_url is None:
        raise ValueError("PICTOFLOW_DATABASE_URL is required for migrations")
    context.configure(
        url=settings.database_url.get_secret_value(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()
elif config.attributes.get("connection") is not None:
    migrate(config.attributes["connection"])
else:
    engine = create_database_engine(Settings())
    try:
        with engine.connect() as connection:
            migrate(connection)
    finally:
        engine.dispose()
