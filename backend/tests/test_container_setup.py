import importlib.util
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from scripts.container_entrypoint import container_environment


def env_initializer():
    path = Path(__file__).resolve().parents[2] / "deploy" / "init_env.py"
    spec = importlib.util.spec_from_file_location("pictoflow_init_env", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.create_env


def test_container_urls_escape_password_and_keep_credentials_out_of_arguments():
    source = {
        "POSTGRES_USER": "developer",
        "POSTGRES_DB": "pictoflow",
        "POSTGRES_PASSWORD": "local:p@ss/word%",
        "PICTOFLOW_REDIS_URL": "redis://redis:6379/0",
    }
    env = container_environment(source)
    parsed = make_url(env["PICTOFLOW_DATABASE_URL"])
    assert parsed.password == source["POSTGRES_PASSWORD"]
    assert parsed.username == "developer" and parsed.host == "postgres"
    assert parsed.drivername == "postgresql+psycopg"
    assert env["PICTOFLOW_TEST_DATABASE_URL"] == env["PICTOFLOW_DATABASE_URL"]
    assert env["PICTOFLOW_TEST_REDIS_URL"] == source["PICTOFLOW_REDIS_URL"]
    assert "PICTOFLOW_DATABASE_URL" not in source


def test_explicit_native_and_test_urls_are_preserved():
    source = {
        "PICTOFLOW_DATABASE_URL": "postgresql+psycopg://localhost/dev",
        "PICTOFLOW_TEST_DATABASE_URL": "postgresql+psycopg://localhost/test",
        "PICTOFLOW_TEST_REDIS_URL": "redis://localhost/1",
    }
    assert container_environment(source) == source


def test_container_fails_clearly_when_database_credentials_are_missing():
    with pytest.raises(ValueError, match="POSTGRES_PASSWORD"):
        container_environment({})


def test_environment_initializer_generates_password_without_overwriting(tmp_path):
    (tmp_path / ".env.example").write_text("POSTGRES_PASSWORD=\nPICTOFLOW_AI_PROVIDER=disabled\n")
    initialize = env_initializer()
    initialize(tmp_path)
    content = (tmp_path / ".env").read_text()
    password = content.splitlines()[0].split("=", 1)[1]
    assert len(password) == 48 and all(character in "0123456789abcdef" for character in password)
    assert "PICTOFLOW_AI_PROVIDER=disabled" in content
    with pytest.raises(FileExistsError):
        initialize(tmp_path)
    assert (tmp_path / ".env").read_text() == content


def test_missing_password_placeholder_does_not_create_broken_environment(tmp_path):
    (tmp_path / ".env.example").write_text("PICTOFLOW_AI_PROVIDER=disabled\n")
    with pytest.raises(ValueError):
        env_initializer()(tmp_path)
    assert not (tmp_path / ".env").exists()
