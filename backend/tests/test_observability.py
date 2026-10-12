import logging
from importlib.resources import files

from fastapi.testclient import TestClient
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app.ai.manager import ProviderManager
from app.ai.providers.fake import FakeFixtures, FakeProvider
from app.api.application import create_app
from app.config import Settings
from app.observability import Telemetry


def test_provider_spans_correlate_with_http_without_payloads(caplog):
    caplog.set_level(logging.INFO, logger="pictoflow.technical")
    app = create_app(
        Settings(
            observability_enabled=True,
            database_url=None,
            redis_url=None,
            _env_file=None,
        )
    )
    exporter = InMemorySpanExporter()
    app.state.telemetry.traces.add_span_processor(SimpleSpanProcessor(exporter))
    fixtures = FakeFixtures.model_validate_json(
        files("app.ai.fixtures").joinpath("local.json").read_text()
    )
    selected = fixtures.interpretations[0]
    manager = ProviderManager(FakeProvider(fixtures), app.state.telemetry)

    @app.get("/test-provider")
    async def provider_call():
        return await manager.interpret(selected.request)

    with TestClient(app) as client:
        response = client.get("/test-provider")
        assert response.status_code == 200
        assert len(response.headers["x-trace-id"]) == 32
        malformed = client.post(
            "/api/v1/profiles/not-a-uuid/concepts",
            json={
                "canonical_key": "private-secret-communication" * 1000,
                "label": "private-label",
            },
        )
        assert malformed.status_code == 422
        assert "private-label" not in malformed.text
        readiness = client.get("/api/v1/readiness")
        assert readiness.json()["redis"] == "disabled"
    spans = exporter.get_finished_spans()
    http = next(s for s in spans if s.attributes.get("http.route") == "/test-provider")
    provider = next(s for s in spans if s.name == "provider.operation")
    assert http.context.trace_id == provider.context.trace_id
    assert provider.parent.span_id == http.context.span_id
    assert not provider.events
    captured = caplog.text + repr([(dict(s.attributes), s.events) for s in spans])
    assert "private-secret-communication" not in captured and "private-label" not in captured
    assert selected.response.candidates[0].text not in captured
    assert "redis.availability" in caplog.text and "provider.success" in caplog.text


def test_metrics_and_disabled_mode_have_no_payload_or_external_exporter(caplog):
    reader = InMemoryMetricReader()
    telemetry = Telemetry(True, metric_reader=reader)
    telemetry.signal("application.health", availability="healthy")
    data = reader.get_metrics_data()
    assert data.resource_metrics[0].scope_metrics[0].metrics[0].name == "pictoflow.events"
    telemetry.close()
    app = create_app(
        Settings(
            observability_enabled=False,
            database_url=None,
            redis_url=None,
            _env_file=None,
        )
    )
    with TestClient(app) as client:
        assert len(client.get("/health").headers["x-trace-id"]) == 32
    assert "pictoflow.technical" not in caplog.text
