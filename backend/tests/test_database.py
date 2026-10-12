import pytest

from app.config import Settings
from app.infrastructure.postgres.database import create_database_engine


def test_missing_database_configuration_is_explicit():
    with pytest.raises(ValueError, match="PICTOFLOW_DATABASE_URL"):
        create_database_engine(Settings(database_url=None, _env_file=None))


def test_other_database_drivers_are_rejected():
    with pytest.raises(ValueError, match="postgresql\\+psycopg"):
        create_database_engine(Settings(database_url="sqlite://", _env_file=None))


def test_settings_hide_database_credentials():
    settings = Settings(
        database_url="postgresql+psycopg://user:sensitive@localhost/pcl", _env_file=None
    )
    assert "sensitive" not in repr(settings)
    assert "sensitive" not in settings.model_dump_json()
