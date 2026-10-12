"""Test API instances with explicit settings, independent from local .env files."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.api.application import create_app
from app.config import Settings


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app(Settings(environment="test", _env_file=None))) as test_client:
        yield test_client
