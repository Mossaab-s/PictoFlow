import asyncio
import json
from importlib.resources import files

import httpx2 as httpx
import pytest
from pydantic import SecretStr

from app.ai.errors import (
    ProviderConfigurationError,
    ProviderPayloadError,
    ProviderUnavailableError,
    ProviderUnsupportedCapability,
)
from app.ai.manager import ProviderManager, create_provider
from app.ai.providers.fake import FakeFixtures
from app.ai.providers.openai_compatible import OpenAICompatibleProvider
from app.ai.providers.prism import PRISMProvider
from app.config import Settings


@pytest.fixture
def fixtures():
    return FakeFixtures.model_validate_json(
        files("app.ai.fixtures").joinpath("local.json").read_text()
    )


@pytest.mark.parametrize(
    "operation,collection",
    [
        ("interpret", "interpretations"),
        ("simplify", "simplifications"),
        ("suggest_representation", "representations"),
    ],
)
@pytest.mark.parametrize("kind", ["compatible", "prism"])
def test_all_operations_map_mocked_http_into_unvalidated_contracts(
    fixtures, operation, collection, kind
):
    fixture = getattr(fixtures, collection)[0]
    observed = []

    def respond(request):
        observed.append(request)
        body = json.loads(request.content)
        if kind == "compatible":
            assert request.url.path == "/v1/chat/completions"
            assert request.headers["Authorization"] == "Bearer server-secret"
            assert body["model"] == "configured-model"
            assert body["response_format"] == {"type": "json_object"}
            # Some compatible endpoints reject requests without an actual user turn.
            users = [message for message in body["messages"] if message["role"] == "user"]
            if not users:
                return httpx.Response(400, json={"error": "No user query found in messages"})
            assert json.loads(users[0]["content"])["request"] == fixture.request.model_dump(
                mode="json"
            )
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {"content": fixture.response.model_dump_json()},
                        }
                    ],
                    "usage": {"prompt_tokens": 12, "completion_tokens": 8},
                },
            )
        assert request.url.path == "/api/v1/routing/query"
        assert request.headers["X-API-Key"] == "server-secret"
        assert len(body["query"]) <= 4000 and "user_id" not in body
        assert body["bypass_to_cloud"] is False
        return httpx.Response(
            200,
            json={
                "model_response": fixture.response.model_dump_json(),
                "execution_status": "ACCEPTED",
                "trace_id": "test-trace",
                "selected_model_name": "routed-model",
                "selected_engine": "local-engine",
                "classification_confidence": 0.99,
                "classified_domain": "communication",
                "performance": {"total_latency_ms": 12},
            },
        )

    async def scenario():
        args = dict(api_key=SecretStr("server-secret"), transport=httpx.MockTransport(respond))
        provider = (
            OpenAICompatibleProvider("http://example.test/v1", "configured-model", **args)
            if kind == "compatible"
            else PRISMProvider(
                "http://example.test",
                capabilities=("interpret", "simplify", "suggest_representation"),
                **args,
            )
        )
        manager = ProviderManager(provider)
        try:
            output = await getattr(manager, operation)(fixture.request)
            assert output.status in ("proposal", "not_understood")
            assert output.metadata.provider_id == manager.provider_id
            if kind == "prism":
                assert output.metadata.routing_confidence == 0.99
                assert output.metadata.trace_id == "test-trace"
                assert output.metadata.extensions["classified_domain"] == "communication"
            else:
                assert output.metadata.input_tokens == 12
        finally:
            await manager.aclose()

    asyncio.run(scenario())
    assert len(observed) == 1


@pytest.mark.parametrize(
    "envelope",
    [
        {"choices": []},
        {"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]},
        {"choices": [{"finish_reason": "stop", "message": {"content": "free form personal text"}}]},
        {"choices": [{"finish_reason": "stop", "message": {"content": '{"status":"validated"}'}}]},
    ],
)
def test_invalid_compatible_output_is_typed_and_redacted(fixtures, envelope):
    async def scenario():
        provider = OpenAICompatibleProvider(
            "http://example.test/v1",
            "local-model",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=envelope)),
        )
        try:
            with pytest.raises(ProviderPayloadError) as error:
                await provider.interpret(fixtures.interpretations[0].request)
            assert "personal text" not in str(error.value)
        finally:
            await provider.aclose()

    asyncio.run(scenario())


def test_prism_refusal_unsupported_operation_and_unavailability(fixtures):
    async def scenario():
        provider = PRISMProvider(
            "http://example.test",
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    200, json={"execution_status": "REFUSED", "classification_confidence": 0.98}
                )
            ),
        )
        try:
            refusal = await provider.interpret(fixtures.interpretations[0].request)
            assert refusal.status == "not_understood" and refusal.candidates == ()
            with pytest.raises(ProviderUnsupportedCapability):
                await provider.suggest_representation(fixtures.representations[0].request)
        finally:
            await provider.aclose()
        for kind in (OpenAICompatibleProvider, PRISMProvider):
            extra = {"model": "local-model"} if kind is OpenAICompatibleProvider else {}
            unavailable = kind(
                "http://example.test",
                **extra,
                transport=httpx.MockTransport(
                    lambda _: httpx.Response(503, text="sensitive raw response")
                ),
            )
            try:
                assert (await unavailable.health()).status == "unavailable"
                with pytest.raises(ProviderUnavailableError) as error:
                    await unavailable.interpret(fixtures.interpretations[0].request)
                assert "sensitive" not in str(error.value)
            finally:
                await unavailable.aclose()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "url", ["ftp://example.test", "https://secret@example.test", "http://example.test?key=secret"]
)
def test_provider_configuration_does_not_embed_secrets_in_urls(url):
    with pytest.raises(ProviderConfigurationError):
        OpenAICompatibleProvider(url, "model")


def test_external_factory_requires_configuration_without_requiring_network():
    for mode in ("prism", "openai-compatible"):
        with pytest.raises(ProviderConfigurationError):
            create_provider(Settings(ai_provider=mode, _env_file=None))

    async def scenario():
        for mode in ("prism", "openai-compatible"):
            manager = create_provider(
                Settings(
                    ai_provider=mode,
                    provider_base_url="http://example.test/v1",
                    provider_model="model",
                    provider_api_key="secret",
                    _env_file=None,
                )
            )
            await manager.aclose()

    asyncio.run(scenario())
