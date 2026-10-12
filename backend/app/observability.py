"""Explicit OpenTelemetry signals with an allowlist and no payload/exception capture."""

import json
import logging
from contextlib import contextmanager
from time import perf_counter
from uuid import uuid4

from opentelemetry import trace
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.trace import Status, StatusCode

logger = logging.getLogger("pictoflow.technical")
ALLOWED = {
    "operation",
    "provider",
    "result_state",
    "error_class",
    "http_method",
    "http_route",
    "http_status",
    "duration_seconds",
    "availability",
    "trace_id",
}


class Telemetry:
    def __init__(self, enabled: bool = False, *, span_exporter=None, metric_reader=None):
        self.enabled = enabled
        self.traces = (
            TracerProvider(resource=Resource.create({"service.name": "pictoflow"}))
            if enabled
            else trace.NoOpTracerProvider()
        )
        if enabled and span_exporter is not None:
            self.traces.add_span_processor(SimpleSpanProcessor(span_exporter))
        self.tracer = self.traces.get_tracer("pictoflow")
        self.meters = (
            MeterProvider(metric_readers=[metric_reader] if metric_reader else [])
            if enabled
            else None
        )
        meter = self.meters.get_meter("pictoflow") if self.meters else None
        self.duration = (
            meter.create_histogram("pictoflow.operation.duration", unit="s") if meter else None
        )
        self.events = meter.create_counter("pictoflow.events") if meter else None

    def signal(self, event: str, **fields):
        if not self.enabled:
            return
        if not set(fields) <= ALLOWED:
            raise ValueError("Telemetry field is not approved")
        trace_id = trace.get_current_span().get_span_context().trace_id
        if trace_id:
            fields["trace_id"] = f"{trace_id:032x}"
        logger.info(json.dumps({"event": event, **fields}, allow_nan=False))
        attributes = {
            "event": event,
            **{k: v for k, v in fields.items() if k not in ("trace_id", "duration_seconds")},
        }
        self.events.add(1, attributes=attributes)
        if "duration_seconds" in fields:
            self.duration.record(fields["duration_seconds"], attributes=attributes)

    @contextmanager
    def operation(self, operation: str, provider: str):
        started = perf_counter()
        result = {}
        with self.tracer.start_as_current_span(
            "provider.operation", record_exception=False, set_status_on_exception=False
        ) as span:
            span.set_attribute("provider.id", provider)
            span.set_attribute("provider.operation", operation)
            try:
                yield result
            except Exception as error:
                span.set_status(Status(StatusCode.ERROR))
                span.set_attribute("error.type", type(error).__name__)
                self.signal(
                    "provider.failure",
                    operation=operation,
                    provider=provider,
                    error_class=type(error).__name__,
                    duration_seconds=perf_counter() - started,
                )
                raise
            else:
                state = result.get("state", "success")
                span.set_attribute("result.state", state)
                self.signal(
                    "provider.success",
                    operation=operation,
                    provider=provider,
                    result_state=state,
                    duration_seconds=perf_counter() - started,
                )

    def close(self):
        if self.enabled:
            self.traces.shutdown()
            self.meters.shutdown()


class HTTPInstrumentation:
    def __init__(self, app, telemetry: Telemetry):
        self.app = app
        self.telemetry = telemetry

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = perf_counter()
        method = (
            scope["method"]
            if scope["method"] in {"GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"}
            else "OTHER"
        )
        status = 500
        with self.telemetry.tracer.start_as_current_span(
            "HTTP request", record_exception=False, set_status_on_exception=False
        ) as span:
            trace_id = span.get_span_context().trace_id
            reference = f"{trace_id:032x}" if trace_id else uuid4().hex

            async def respond(message):
                nonlocal status
                if message["type"] == "http.response.start":
                    status = message["status"]
                    message["headers"] = [
                        *message.get("headers", []),
                        (b"x-trace-id", reference.encode()),
                    ]
                await send(message)

            try:
                await self.app(scope, receive, respond)
            finally:
                route = getattr(scope.get("route"), "path", "unmatched")
                span.set_attribute("http.route", route)
                span.set_attribute("http.request.method", method)
                span.set_attribute("http.response.status_code", status)
                if status >= 500:
                    span.set_status(Status(StatusCode.ERROR))
                self.telemetry.signal(
                    "http.request",
                    http_method=method,
                    http_route=route,
                    http_status=status,
                    duration_seconds=perf_counter() - started,
                )
