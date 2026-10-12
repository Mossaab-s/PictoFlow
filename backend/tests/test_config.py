import pytest
from pydantic import ValidationError

from app.config import Settings


def test_environment_variables_override_dotenv(monkeypatch, tmp_path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("PICTOFLOW_APP_NAME=From file\n", encoding="utf-8")
    monkeypatch.setenv("PICTOFLOW_APP_NAME", "From environment")
    monkeypatch.setenv("PICTOFLOW_ENVIRONMENT", "test")
    monkeypatch.setenv("PICTOFLOW_DEBUG", "false")
    settings = Settings(_env_file=env_file)
    assert settings.app_name == "From environment"
    assert settings.environment == "test"
    assert settings.debug is False


def test_dotenv_configuration(monkeypatch, tmp_path) -> None:
    monkeypatch.delenv("PICTOFLOW_APP_NAME", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("PICTOFLOW_APP_NAME=From file\n", encoding="utf-8")
    assert Settings(_env_file=env_file).app_name == "From file"


def test_invalid_environment_fails_validation() -> None:
    with pytest.raises(ValidationError):
        Settings(environment="unknown", _env_file=None)
