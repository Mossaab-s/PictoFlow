"""Exact fixture matching without network calls, inference or repository access."""

import json
from typing import Annotated

from pydantic import Field, ValidationError

from app.ai.contracts import (
    Contract,
    InterpretationProposal,
    InterpretationRequest,
    ProviderHealth,
    RepresentationProposal,
    RepresentationRequest,
    SimplificationProposal,
    SimplificationRequest,
)
from app.ai.errors import ProviderConfigurationError, ProviderFixtureNotFound, ProviderPayloadError


class InterpretationFixture(Contract):
    request: InterpretationRequest
    response: InterpretationProposal


class SimplificationFixture(Contract):
    request: SimplificationRequest
    response: SimplificationProposal


class RepresentationFixture(Contract):
    request: RepresentationRequest
    response: RepresentationProposal


class FakeFixtures(Contract):
    interpretations: Annotated[tuple[InterpretationFixture, ...], Field(max_length=128)] = ()
    simplifications: Annotated[tuple[SimplificationFixture, ...], Field(max_length=128)] = ()
    representations: Annotated[tuple[RepresentationFixture, ...], Field(max_length=128)] = ()


def request_key(request: Contract) -> str:
    """Canonical JSON includes ordered blocks, IDs, context, hints and language."""
    return json.dumps(
        request.model_dump(mode="json"),
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    )


class FakeProvider:
    def __init__(self, fixtures: FakeFixtures | dict | None = None):
        try:
            configuration = FakeFixtures.model_validate(fixtures if fixtures is not None else {})
        except ValidationError:
            raise ProviderConfigurationError("Fake provider fixtures are invalid") from None
        self._responses: dict[str, dict[str, str]] = {}
        for operation, entries in (
            ("interpret", configuration.interpretations),
            ("simplify", configuration.simplifications),
            ("suggest_representation", configuration.representations),
        ):
            responses = {}
            for entry in entries:
                key = request_key(entry.request)
                if key in responses:
                    raise ProviderConfigurationError("Duplicate request in fake provider fixtures")
                # Snapshots prevent later mutation of fixture metadata or caller responses.
                responses[key] = entry.response.model_dump_json()
            self._responses[operation] = responses

    @property
    def provider_id(self) -> str:
        return "fake"

    def _respond(self, operation: str, request, request_type, response_type):
        try:
            validated = request_type.model_validate(request)
        except ValidationError:
            raise ProviderPayloadError("Provider request failed schema validation") from None
        payload = self._responses[operation].get(request_key(validated))
        if payload is None:
            raise ProviderFixtureNotFound("No fake provider fixture matches this request")
        return response_type.model_validate_json(payload)

    async def interpret(self, request: InterpretationRequest) -> InterpretationProposal:
        return self._respond("interpret", request, InterpretationRequest, InterpretationProposal)

    async def simplify(self, request: SimplificationRequest) -> SimplificationProposal:
        return self._respond("simplify", request, SimplificationRequest, SimplificationProposal)

    async def suggest_representation(
        self, request: RepresentationRequest
    ) -> RepresentationProposal:
        return self._respond(
            "suggest_representation", request, RepresentationRequest, RepresentationProposal
        )

    async def health(self) -> ProviderHealth:
        return ProviderHealth(
            provider_id=self.provider_id,
            status="available",
            capabilities=tuple(
                operation for operation, entries in self._responses.items() if entries
            ),
        )
