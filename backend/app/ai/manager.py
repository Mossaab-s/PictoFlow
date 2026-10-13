"""One configured local provider, with request/response validation at its boundary."""

import inspect
from contextlib import nullcontext
from importlib.resources import files

from pydantic import TypeAdapter, ValidationError

from app.ai.contracts import (
    InterpretationProposal,
    InterpretationRequest,
    Key,
    ProviderHealth,
    RepresentationProposal,
    RepresentationRequest,
    SimplificationProposal,
    SimplificationRequest,
)
from app.ai.errors import ProviderConfigurationError, ProviderPayloadError
from app.ai.protocol import AIProvider
from app.ai.providers.disabled import DisabledProvider
from app.ai.providers.fake import FakeFixtures, FakeProvider
from app.ai.providers.openai_compatible import OpenAICompatibleProvider
from app.ai.providers.prism import PRISMProvider
from app.config import Settings


class ProviderManager:
    """Validate one provider; never receive or mutate persistent PCL repositories."""

    def __init__(self, provider: AIProvider, telemetry=None):
        operations = ("interpret", "simplify", "suggest_representation", "health")
        if not isinstance(provider, AIProvider) or not all(
            inspect.iscoroutinefunction(getattr(provider, operation)) for operation in operations
        ):
            raise ProviderConfigurationError(
                "Provider must implement the asynchronous AIProvider protocol"
            )
        try:
            self._provider_id = TypeAdapter(Key).validate_python(provider.provider_id)
        except ValidationError:
            raise ProviderConfigurationError("Provider ID is invalid") from None
        self._provider = provider
        self.telemetry = telemetry

    @property
    def provider_id(self) -> str:
        return self._provider_id

    async def _call(self, operation: str, request, request_type, response_type):
        context = (
            self.telemetry.operation(operation, self.provider_id)
            if self.telemetry
            else nullcontext({})
        )
        with context as result:
            proposal = await self._validated_call(operation, request, request_type, response_type)
            result["state"] = proposal.status
            return proposal

    async def _validated_call(self, operation: str, request, request_type, response_type):
        try:
            validated_request = request_type.model_validate(request)
        except ValidationError:
            raise ProviderPayloadError("Provider request failed schema validation") from None
        try:
            response = await getattr(self._provider, operation)(validated_request)
            proposal = response_type.model_validate(response)
        except ValidationError:
            raise ProviderPayloadError("Provider response failed schema validation") from None
        if proposal.metadata and proposal.metadata.provider_id not in (None, self.provider_id):
            raise ProviderPayloadError(
                "Provider response provenance does not match the configured provider"
            )
        return proposal

    async def interpret(self, request: InterpretationRequest) -> InterpretationProposal:
        return await self._call("interpret", request, InterpretationRequest, InterpretationProposal)

    async def simplify(self, request: SimplificationRequest) -> SimplificationProposal:
        return await self._call("simplify", request, SimplificationRequest, SimplificationProposal)

    async def suggest_representation(
        self, request: RepresentationRequest
    ) -> RepresentationProposal:
        return await self._call(
            "suggest_representation", request, RepresentationRequest, RepresentationProposal
        )

    async def health(self) -> ProviderHealth:
        try:
            response = await self._provider.health()
            health = ProviderHealth.model_validate(response)
        except ValidationError:
            raise ProviderPayloadError("Provider health failed schema validation") from None
        if health.provider_id != self.provider_id or (
            health.metadata and health.metadata.provider_id not in (None, self.provider_id)
        ):
            raise ProviderPayloadError(
                "Provider health provenance does not match the configured provider"
            )
        return health

    async def aclose(self):
        close = getattr(self._provider, "aclose", None)
        if close is not None:
            await close()


def create_provider(settings: Settings, telemetry=None) -> ProviderManager:
    if settings.ai_provider == "disabled":
        return ProviderManager(DisabledProvider(), telemetry)
    if settings.ai_provider in ("openai-compatible", "prism"):
        if settings.provider_base_url is None:
            raise ProviderConfigurationError("An external provider URL is required")
        options = dict(
            api_key=settings.provider_api_key, timeout_seconds=settings.provider_timeout_seconds
        )
        if settings.ai_provider == "openai-compatible":
            provider = OpenAICompatibleProvider(
                settings.provider_base_url,
                settings.provider_model,
                response_format=settings.provider_response_format,
                **options,
            )
        else:
            provider = PRISMProvider(
                settings.provider_base_url, capabilities=settings.prism_capabilities, **options
            )
        return ProviderManager(provider, telemetry)
    if settings.ai_provider != "fake":
        raise ProviderConfigurationError("Unknown local provider mode")
    if (
        settings.fake_provider_fixtures is not None
        and not settings.fake_provider_fixtures.is_absolute()
    ):
        raise ProviderConfigurationError("Fake provider fixture path must be absolute")
    try:
        content = (
            settings.fake_provider_fixtures.read_text(encoding="utf-8")
            if settings.fake_provider_fixtures is not None
            else files("app.ai.fixtures").joinpath("local.json").read_text(encoding="utf-8")
        )
        fixtures = FakeFixtures.model_validate_json(content)
    except (OSError, UnicodeError, ValidationError):
        raise ProviderConfigurationError("Cannot load valid fake provider fixtures") from None
    return ProviderManager(FakeProvider(fixtures), telemetry)
