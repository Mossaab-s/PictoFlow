"""Explicit no-AI mode; the PCL remains independent of provider availability."""

from app.ai.contracts import (
    InterpretationProposal,
    InterpretationRequest,
    ProviderHealth,
    RepresentationProposal,
    RepresentationRequest,
    SimplificationProposal,
    SimplificationRequest,
)
from app.ai.errors import ProviderDisabledError


class DisabledProvider:
    @property
    def provider_id(self) -> str:
        return "disabled"

    async def interpret(self, request: InterpretationRequest) -> InterpretationProposal:
        raise ProviderDisabledError("AI provider is disabled")

    async def simplify(self, request: SimplificationRequest) -> SimplificationProposal:
        raise ProviderDisabledError("AI provider is disabled")

    async def suggest_representation(
        self, request: RepresentationRequest
    ) -> RepresentationProposal:
        raise ProviderDisabledError("AI provider is disabled")

    async def health(self) -> ProviderHealth:
        return ProviderHealth(provider_id=self.provider_id, status="disabled")
