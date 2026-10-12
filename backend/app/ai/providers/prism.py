"""Optional adapter for PRISM's native /api/v1/routing/query contract."""

from app.ai.contracts import InterpretationProposal, ProviderMetadata
from app.ai.errors import (
    ProviderPayloadError,
    ProviderUnavailableError,
    ProviderUnsupportedCapability,
)
from app.ai.providers.http import OPERATIONS, RESPONSES, HTTPProvider, instruction, parse


class PRISMProvider(HTTPProvider):
    health_path = "/health"

    def __init__(
        self, base_url: str, *, capabilities: tuple[str, ...] = ("interpret", "simplify"), **kwargs
    ):
        if not set(capabilities) <= set(OPERATIONS) or len(set(capabilities)) != len(capabilities):
            raise ProviderPayloadError("PRISM capabilities are invalid")
        self.capabilities = capabilities
        super().__init__(base_url, **kwargs)

    @property
    def provider_id(self):
        return "prism"

    def headers(self):
        return {"X-API-Key": self._api_key.get_secret_value()} if self._api_key else {}

    async def call(self, operation: str, request):
        if operation not in self.capabilities:
            raise ProviderUnsupportedCapability("PRISM operation is not configured as supported")
        query = instruction(operation, request, compact=True)
        if len(query) > 4000:
            raise ProviderPayloadError("Bounded PictoFlow request exceeds PRISM's query limit")
        result = await self.exchange(
            "POST",
            "/api/v1/routing/query",
            payload={
                "query": query,
                "level": 1,
                "include_trace": False,
                "bypass_to_cloud": False,
                "bypass_to_generalist": False,
            },
        )
        try:
            status = result.get("execution_status")
            performance = result.get("performance") or {}
            metadata = ProviderMetadata(
                provider_id=self.provider_id,
                trace_id=result.get("trace_id"),
                selected_model=result.get("selected_model_name"),
                selected_provider=result.get("selected_engine"),
                routing_confidence=result.get("classification_confidence"),
                latency_ms=performance.get("total_latency_ms"),
                input_tokens=result.get("input_tokens"),
                output_tokens=result.get("output_tokens"),
                cost=result.get("cost"),
                extensions={
                    key: result[key]
                    for key in (
                        "classified_domain",
                        "rq_score",
                        "confidence_index",
                        "execution_status",
                        "routing_method",
                        "routing_decision",
                    )
                    if result.get(key) is not None
                },
            )
            if status == "REFUSED" and operation == "interpret":
                return InterpretationProposal(status="not_understood", metadata=metadata)
            if status != "ACCEPTED":
                raise ProviderUnavailableError("PRISM could not provide this operation")
            proposal = parse(RESPONSES[operation], result.get("model_response"))
            return RESPONSES[operation].model_validate(
                {**proposal.model_dump(), "metadata": metadata}
            )
        except (TypeError, ValueError):
            raise ProviderPayloadError("PRISM response envelope is invalid") from None
