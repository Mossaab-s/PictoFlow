"""Structural interface for replaceable optional providers, outside the PCL domain."""

from typing import Protocol, runtime_checkable

from app.ai.contracts import (
    InterpretationProposal,
    InterpretationRequest,
    ProviderHealth,
    RepresentationProposal,
    RepresentationRequest,
    SimplificationProposal,
    SimplificationRequest,
)


@runtime_checkable
class AIProvider(Protocol):
    @property
    def provider_id(self) -> str:
        """Stable provider provenance, independent of personal semantic state."""
        ...

    async def interpret(self, request: InterpretationRequest) -> InterpretationProposal: ...

    async def simplify(self, request: SimplificationRequest) -> SimplificationProposal: ...

    async def suggest_representation(
        self, request: RepresentationRequest
    ) -> RepresentationProposal: ...

    async def health(self) -> ProviderHealth: ...
