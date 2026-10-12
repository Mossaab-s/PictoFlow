from fastapi.testclient import TestClient

from app.api.application import create_app
from app.application.transient import TransientHealth
from app.config import Settings


def test_backend_serves_health_without_external_services(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_versioned_router_is_available(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_openapi_documents_health_routes(client: TestClient) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert {"/health", "/api/v1/health"} <= response.json()["paths"].keys()


def test_application_instances_have_independent_configuration() -> None:
    first = create_app(Settings(app_name="First", environment="test", _env_file=None))
    second = create_app(Settings(app_name="Second", environment="test", _env_file=None))
    assert first.title == "First"
    assert second.title == "Second"
    assert first.state.settings is not second.state.settings


def test_health_starts_even_with_unavailable_database() -> None:
    settings = Settings(
        environment="test",
        _env_file=None,
        database_url="postgresql+psycopg://user@127.0.0.1:1/unavailable",
    )
    with TestClient(create_app(settings)) as client:
        assert client.get("/health").json() == {"status": "healthy"}


def test_backend_starts_with_redis_disabled():
    app = create_app(Settings(environment="test", redis_url=None, _env_file=None))
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.portal.call(app.state.transient_store.health) is TransientHealth.DISABLED


def test_backend_starts_when_configured_redis_is_unavailable():
    app = create_app(
        Settings(
            environment="test",
            redis_url="redis://127.0.0.1:1/0",
            redis_timeout_seconds=0.05,
            _env_file=None,
        )
    )
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.portal.call(app.state.transient_store.health) is TransientHealth.UNAVAILABLE
