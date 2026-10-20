import asyncio
import json
from types import SimpleNamespace

import httpx2 as httpx
import pytest
from pydantic import SecretStr, ValidationError

from app.ai.configuration import (
    ConfigurationChange,
    ConfigurationConflict,
    ProviderOptions,
    probe_provider,
    resolve_change,
)
from app.ai.manager import ProviderManager
from app.ai.providers.openai_compatible import OpenAICompatibleProvider
from app.config import Settings


def change(**updates):
    return ConfigurationChange(
        **{
            **dict(
                provider="openai-compatible",
                base_url="https://api.test/v1",
                model="test-model",
                expected_version=0,
            ),
            **updates,
        }
    )


@pytest.mark.parametrize(
    "url",
    [
        "file:///tmp/key",
        "https://user:secret@api.test/v1",
        "https://api.test?key=secret",
        "https://api.test/#secret",
        "http://api.test:0",
        "http://api.test:bad",
        "https://api.test/\nx",
    ],
)
def test_credentials_and_invalid_urls_are_not_configuration(url):
    with pytest.raises(ValidationError):
        change(base_url=url)


def test_key_is_write_only_and_cannot_follow_an_endpoint_change():
    current = ProviderOptions(
        provider="openai-compatible", base_url="https://api.test/v1", model="a"
    )
    key = SecretStr("synthetic-private-key")
    same = change(base_url="https://API.test:443/v1/", model="b")
    assert resolve_change(same, current, key, 0)[1] is key
    for updates in ({"base_url": "https://another.test/v1"}, {"provider": "prism"}):
        with pytest.raises(ValueError):
            resolve_change(change(**updates), current, key, 0)
    replacement = change(
        base_url="https://another.test/v1", key_action="replace", api_key="synthetic-new-key"
    )
    options, replaced = resolve_change(replacement, current, key, 0)
    assert options.base_url == "https://another.test/v1"
    assert replaced.get_secret_value() == "synthetic-new-key"
    assert "synthetic-new-key" not in replacement.model_dump_json()
    assert "synthetic-new-key" not in repr(replacement)
    assert resolve_change(change(key_action="clear"), current, key, 0)[1] is None
    with pytest.raises(ConfigurationConflict):
        resolve_change(change(), current, key, 1)


@pytest.mark.parametrize(
    "values",
    [
        {"key_action": "replace"},
        {"api_key": "hidden"},
        {"key_action": "clear", "api_key": "hidden"},
        {"key_action": "replace", "api_key": "hidden\nheader"},
        {"timeout_seconds": float("inf")},
        {"temperature": float("nan")},
        {"model": " "},
    ],
)
def test_invalid_or_ambiguous_key_and_generation_settings_are_rejected(values):
    with pytest.raises(ValidationError):
        change(**values)


def configured(transport):
    def factory(settings):
        return ProviderManager(
            OpenAICompatibleProvider(
                settings.provider_base_url,
                settings.provider_model,
                api_key=settings.provider_api_key,
                response_format=settings.provider_response_format,
                temperature=settings.provider_temperature,
                transport=transport,
            )
        )

    return factory


@pytest.mark.parametrize(
    "response_kind", ["proposal", "invalid", "refusal", "quota", "auth", "transport"]
)
def test_probe_sends_only_three_fictitious_touches_and_redacts_failures(response_kind):
    requests = []
    secret = "synthetic-secret-never-in-result"

    def transport(request):
        requests.append(request)
        assert request.headers["authorization"] == "Bearer " + secret
        if request.method == "GET":
            return httpx.Response(200, json={"data": []})
        payload = json.loads(request.content)
        content = payload["messages"][1]["content"]
        assert all(word in content for word in ("Moi", "Boire", "Eau"))
        assert secret not in content
        assert payload["model"] == "test-model"
        if response_kind in ("quota", "auth"):
            return httpx.Response(429 if response_kind == "quota" else 401, json={"error": secret})
        if response_kind == "transport":
            raise httpx.ConnectError(secret, request=request)
        proposal = {
            "status": "proposal",
            "candidates": [
                {"intent": "DRINK", "text": "Je veux boire de l’eau.", "confidence": 0.7}
            ],
        }
        if response_kind == "refusal":
            proposal = {"status": "not_understood", "candidates": []}
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": "not JSON " + secret
                            if response_kind == "invalid"
                            else json.dumps(proposal)
                        },
                    }
                ]
            },
        )

    settings = Settings(
        _env_file=None,
        ai_provider="openai-compatible",
        provider_base_url="https://api.test/v1",
        provider_model="test-model",
        provider_api_key=secret,
    )
    result = asyncio.run(
        probe_provider(settings, factory=configured(httpx.MockTransport(transport)))
    )
    assert len(requests) == 2
    assert secret not in result.model_dump_json()
    expected = {
        "proposal": "proposal",
        "invalid": "invalid_payload",
        "refusal": "model_refusal",
    }.get(response_kind, "unavailable")
    assert result.generation == expected
    assert result.candidates == (
        ("Je veux boire de l’eau.",) if response_kind == "proposal" else ()
    )


def test_request_snapshots_survive_activation_and_close_independently(monkeypatch):
    from app.api import provider_configuration as route

    current = Settings(_env_file=None, ai_provider="disabled")
    closed = []
    created = []

    def create(settings, telemetry):
        result = SimpleNamespace(provider_id=settings.ai_provider)

        async def close():
            closed.append(result)

        result.aclose = close
        created.append(result)
        return result

    monkeypatch.setattr(
        route, "repository", lambda request: SimpleNamespace(override=lambda: current)
    )
    monkeypatch.setattr(route, "create_provider", create)
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(pcl_units=True, telemetry=None))
    )

    async def scenario():
        nonlocal current
        async with route.active_provider(request) as first:
            current = Settings(_env_file=None, ai_provider="fake")
            async with route.active_provider(request) as second:
                assert first.provider_id == "disabled" and second.provider_id == "fake"
                assert closed == []
            assert closed == [second]
        assert closed == [second, first]

    asyncio.run(scenario())
    assert len(created) == 2
