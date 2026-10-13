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


def test_strict_compatible_response_format_is_explicit(monkeypatch):
    monkeypatch.delenv("PICTOFLOW_PROVIDER_RESPONSE_FORMAT", raising=False)
    assert Settings(_env_file=None).provider_response_format == "json_object"
    monkeypatch.setenv("PICTOFLOW_PROVIDER_RESPONSE_FORMAT", "json_schema")
    assert Settings(_env_file=None).provider_response_format == "json_schema"
    with pytest.raises(ValidationError):
        Settings(provider_response_format="text", _env_file=None)


def test_temperature_is_bounded_and_can_be_omitted(monkeypatch):
    monkeypatch.delenv("PICTOFLOW_PROVIDER_TEMPERATURE", raising=False)
    assert Settings(_env_file=None).provider_temperature == 0.2
    monkeypatch.setenv("PICTOFLOW_PROVIDER_TEMPERATURE", "")
    assert Settings(_env_file=None).provider_temperature is None
    for value in (-0.01, 2.01, float("nan"), float("inf")):
        with pytest.raises(ValidationError):
            Settings(provider_temperature=value, _env_file=None)
