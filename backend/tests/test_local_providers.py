import asyncio
import inspect
import json
import socket
import traceback
from importlib.resources import files
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.ai.contracts import InterpretationProposal, InterpretationRequest, ProviderMetadata
from app.ai.errors import (
    ProviderConfigurationError,
    ProviderDisabledError,
    ProviderFixtureNotFound,
    ProviderPayloadError,
)
from app.ai.manager import ProviderManager, create_provider
from app.ai.protocol import AIProvider
from app.ai.providers.disabled import DisabledProvider
from app.ai.providers.fake import FakeFixtures, FakeProvider
from app.api.application import create_app
from app.config import Settings


@pytest.fixture
def fixtures():
    return FakeFixtures.model_validate_json(
        files("app.ai.fixtures").joinpath("local.json").read_text(encoding="utf-8")
    )


@pytest.mark.parametrize(
    "operation,collection",
    [
        ("interpret", "interpretations"),
        ("simplify", "simplifications"),
        ("suggest_representation", "representations"),
    ],
)
def test_fake_responses_are_deterministic_and_detached(fixtures, operation, collection):
    fixture = getattr(fixtures, collection)[0]
    provider = FakeProvider(fixtures)

    async def scenario():
        first = await getattr(provider, operation)(fixture.request)
        second = await getattr(provider, operation)(fixture.request)
        assert first == second == fixture.response
        assert first is not second
        assert first.status == "proposal"

    asyncio.run(scenario())


def test_fixture_lookup_ignores_json_object_key_order(fixtures):
    request = fixtures.interpretations[0].request
    reordered = dict(reversed(list(request.model_dump(mode="json").items())))
    response = asyncio.run(FakeProvider(fixtures).interpret(reordered))
    assert response == fixtures.interpretations[0].response


@pytest.mark.parametrize("change", ["order", "context", "language", "block_identity", "hints"])
def test_fixture_lookup_includes_all_request_context(fixtures, change):
    payload = fixtures.interpretations[0].request.model_dump(mode="json")
    if change == "order":
        payload["blocks"].reverse()
    elif change == "context":
        payload["declared_context"] = ["Autre contexte"]
    elif change == "language":
        payload["language"] = "en"
    elif change == "block_identity":
        payload["blocks"][0]["block_id"] = str(uuid4())
    else:
        payload["semantic_hints"] = [
            {
                "source_meaning": "NOISE",
                "target_meaning": "LEAVE",
                "relation_type": "associated_with",
                "confidence": 0.9,
            }
        ]
    with pytest.raises(ProviderFixtureNotFound):
        asyncio.run(FakeProvider(fixtures).interpret(InterpretationRequest.model_validate(payload)))


def test_unknown_request_has_no_inferred_fallback_or_payload_in_error(fixtures):
    request = fixtures.interpretations[0].request.model_dump(mode="json")
    request["blocks"][0]["meaning"] = "private-communication"
    with pytest.raises(ProviderFixtureNotFound) as failure:
        asyncio.run(FakeProvider(fixtures).interpret(InterpretationRequest.model_validate(request)))
    assert "private-communication" not in "".join(traceback.format_exception(failure.value))


def test_fixture_can_produce_explicit_refusal(fixtures):
    response = asyncio.run(FakeProvider(fixtures).interpret(fixtures.interpretations[1].request))
    assert response.status == "not_understood" and not response.candidates


def test_duplicate_requests_fail_instead_of_overwriting(fixtures):
    payload = fixtures.model_dump(mode="json")
    payload["interpretations"].append(payload["interpretations"][0])
    with pytest.raises(ProviderConfigurationError, match="Duplicate"):
        FakeProvider(payload)


def test_fixture_cannot_create_validated_state(fixtures):
    payload = fixtures.model_dump(mode="json")
    payload["interpretations"][0]["response"]["status"] = "validated"
    with pytest.raises(ProviderConfigurationError):
        FakeProvider(payload)


def test_response_and_configuration_metadata_cannot_change_future_calls(fixtures):
    payload = fixtures.model_dump(mode="json")
    payload["interpretations"][0]["response"]["metadata"] = {
        "extensions": {"fixture": {"value": "original"}}
    }
    configuration = FakeFixtures.model_validate(payload)
    provider = FakeProvider(configuration)
    configuration.interpretations[0].response.metadata.extensions["fixture"]["value"] = "changed"
    first = asyncio.run(provider.interpret(configuration.interpretations[0].request))
    first.metadata.extensions["fixture"]["value"] = "changed-again"
    second = asyncio.run(provider.interpret(configuration.interpretations[0].request))
    assert second.metadata.extensions["fixture"]["value"] == "original"


@pytest.mark.parametrize(
    "operation,collection",
    [
        ("interpret", "interpretations"),
        ("simplify", "simplifications"),
        ("suggest_representation", "representations"),
    ],
)
def test_disabled_provider_returns_explicit_operation_failure(fixtures, operation, collection):
    request = getattr(fixtures, collection)[0].request
    with pytest.raises(ProviderDisabledError):
        asyncio.run(getattr(DisabledProvider(), operation)(request))


def test_local_providers_implement_async_protocol_and_health(fixtures):
    fake, disabled = FakeProvider(fixtures), DisabledProvider()
    for provider in (fake, disabled):
        assert isinstance(provider, AIProvider)
        assert all(
            inspect.iscoroutinefunction(getattr(provider, operation))
            for operation in (
                "interpret",
                "simplify",
                "suggest_representation",
                "health",
            )
        )
    assert asyncio.run(fake.health()).capabilities == (
        "interpret",
        "simplify",
        "suggest_representation",
    )
    assert asyncio.run(disabled.health()).status == "disabled"
    assert not asyncio.run(disabled.health()).capabilities


def test_empty_fake_provider_does_not_advertise_configured_fixtures():
    assert not asyncio.run(FakeProvider().health()).capabilities


def test_operations_perform_no_network_io(fixtures, monkeypatch):
    def unexpected_network(*args, **kwargs):
        raise AssertionError("Local providers must not perform network IO")

    async def scenario():
        # Patch after event-loop startup; Windows may use socketpair for the loop itself.
        with monkeypatch.context() as patch:
            patch.setattr(socket.socket, "connect", unexpected_network)
            patch.setattr(socket.socket, "connect_ex", unexpected_network)
            patch.setattr(socket, "create_connection", unexpected_network)
            provider = ProviderManager(FakeProvider(fixtures))
            assert (await provider.health()).status == "available"
            await provider.interpret(fixtures.interpretations[0].request)
            await provider.simplify(fixtures.simplifications[0].request)
            await provider.suggest_representation(fixtures.representations[0].request)
            assert (await DisabledProvider().health()).status == "disabled"
            with pytest.raises(ProviderDisabledError):
                await DisabledProvider().interpret(fixtures.interpretations[0].request)

    asyncio.run(scenario())


def test_configuration_defaults_to_disabled():
    manager = create_provider(Settings(ai_provider="disabled", _env_file=None))
    assert manager.provider_id == "disabled"
    assert asyncio.run(manager.health()).status == "disabled"


def test_custom_fixture_file_is_loaded(fixtures, tmp_path):
    path = tmp_path / "fixtures.json"
    payload = fixtures.model_dump(mode="json")
    payload["interpretations"][0]["response"]["candidates"][0]["text"] = "Custom fixture"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    provider = create_provider(
        Settings(ai_provider="fake", fake_provider_fixtures=path, _env_file=None)
    )
    response = asyncio.run(provider.interpret(fixtures.interpretations[0].request))
    assert response.candidates[0].text == "Custom fixture"


@pytest.mark.parametrize("content", [None, "not-json", '{"unknown": "private-communication"}'])
def test_unreadable_or_invalid_fixture_file_is_explicit_configuration_error(tmp_path, content):
    path = tmp_path / "fixtures.json"
    if content is not None:
        path.write_text(content, encoding="utf-8")
    with pytest.raises(ProviderConfigurationError) as failure:
        create_provider(Settings(ai_provider="fake", fake_provider_fixtures=path, _env_file=None))
    assert "private-communication" not in "".join(traceback.format_exception(failure.value))


def test_manager_revalidates_returned_local_proposals(fixtures):
    provider = FakeProvider(fixtures)
    provider.interpret = AsyncMock(
        return_value=InterpretationProposal.model_construct(status="validated")
    )
    manager = ProviderManager(provider)
    with pytest.raises(ProviderPayloadError):
        asyncio.run(manager.interpret(fixtures.interpretations[0].request))


def test_manager_checks_provider_provenance(fixtures):
    provider = FakeProvider(fixtures)
    response = fixtures.interpretations[0].response.model_copy(
        update={
            "metadata": ProviderMetadata(provider_id="another-provider"),
        }
    )
    provider.interpret = AsyncMock(return_value=response)
    with pytest.raises(ProviderPayloadError, match="provenance"):
        asyncio.run(ProviderManager(provider).interpret(fixtures.interpretations[0].request))


def test_fake_backend_provider_boundary_scenario(fixtures):
    app = create_app(
        Settings(environment="test", ai_provider="fake", redis_url=None, _env_file=None)
    )
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        provider = app.state.ai_provider
        assert client.portal.call(provider.health).status == "available"
        interpretation = client.portal.call(provider.interpret, fixtures.interpretations[0].request)
        simplified = client.portal.call(provider.simplify, fixtures.simplifications[0].request)
        visual = client.portal.call(
            provider.suggest_representation, fixtures.representations[0].request
        )
        assert interpretation.candidates[0].intent == "LEAVE_DUE_TO_NOISE"
        assert {interpretation.status, simplified.status, visual.status} == {"proposal"}
        assert (
            client.portal.call(provider.interpret, fixtures.interpretations[1].request).status
            == "not_understood"
        )


def test_disabled_backend_starts_without_external_services(fixtures):
    app = create_app(
        Settings(
            environment="test",
            ai_provider="disabled",
            redis_url=None,
            database_url=None,
            _env_file=None,
        )
    )
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.portal.call(app.state.ai_provider.health).status == "disabled"
        with pytest.raises(ProviderDisabledError):
            client.portal.call(app.state.ai_provider.interpret, fixtures.interpretations[0].request)


def test_disabled_mode_does_not_read_unused_fake_configuration(tmp_path):
    provider = create_provider(
        Settings(
            ai_provider="disabled", _env_file=None, fake_provider_fixtures=tmp_path / "missing.json"
        )
    )
    assert asyncio.run(provider.health()).status == "disabled"


def test_relative_fixture_path_is_an_explicit_configuration_error():
    with pytest.raises(ProviderConfigurationError, match="absolute"):
        create_provider(
            Settings(ai_provider="fake", fake_provider_fixtures="relative.json", _env_file=None)
        )


def test_manager_rejects_synchronous_implementation(fixtures):
    provider = FakeProvider(fixtures)
    provider.interpret = lambda request: fixtures.interpretations[0].response
    with pytest.raises(ProviderConfigurationError, match="asynchronous"):
        ProviderManager(provider)


def test_manager_rejects_malformed_request_before_calling_provider(fixtures):
    provider = FakeProvider(fixtures)
    provider.interpret = AsyncMock()
    with pytest.raises(ProviderPayloadError):
        asyncio.run(
            ProviderManager(provider).interpret(InterpretationRequest.model_construct(blocks=()))
        )
    provider.interpret.assert_not_awaited()


def test_manager_checks_health_provenance(fixtures):
    provider = FakeProvider(fixtures)
    provider.health = AsyncMock(
        return_value={"provider_id": "another-provider", "status": "available"}
    )
    with pytest.raises(ProviderPayloadError, match="provenance"):
        asyncio.run(ProviderManager(provider).health())
