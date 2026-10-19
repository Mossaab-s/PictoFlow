"""Isolated browser-CI adapter; never imported by the application or server image."""

import os
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.ai.errors import ProviderPayloadError, ProviderUnavailableError
from app.ai.manager import ProviderManager
from app.ai.providers.disabled import DisabledProvider
from app.ai.providers.fake import FakeProvider
from app.api.application import create_app
from app.application.interpretation import InterpretationService
from app.config import Settings

if os.environ.get("PICTOFLOW_UX_TESTING") != "1":
    raise RuntimeError("This synthetic fixture adapter is for isolated browser CI only")

app = create_app(Settings(environment="test", auth_enabled=False, ai_provider="disabled"))


class FixtureSelection(BaseModel):
    profile_id: UUID
    sequence_id: UUID
    mode: Literal[
        "proposal", "disabled", "refusal", "unfaithful", "low", "invalid", "unavailable"
    ] = "proposal"


class FailureFixture(FakeProvider):
    def __init__(self, mode):
        super().__init__()
        self.mode = mode

    async def interpret(self, request):
        if self.mode == "invalid":
            raise ProviderPayloadError("Synthetic private malformed generation")
        raise ProviderUnavailableError("Synthetic private transport error")


@app.post("/_synthetic/fixture")
async def configure_fixture(body: FixtureSelection):
    request = InterpretationService(app.state.pcl_units, None, None).request(
        body.profile_id, body.sequence_id
    )
    previous = app.state.ai_provider
    if body.mode == "disabled":
        provider = DisabledProvider()
    elif body.mode in ("invalid", "unavailable"):
        provider = FailureFixture(body.mode)
    else:
        provider = FakeProvider(
            {
                "interpretations": [
                    {
                        "request": request.model_dump(mode="json"),
                        "response": {
                            "status": "not_understood" if body.mode == "refusal" else "proposal",
                            "candidates": []
                            if body.mode == "refusal"
                            else [
                                {
                                    "intent": "request",
                                    "text": "Je voudrais un livre."
                                    if body.mode == "unfaithful"
                                    else "Je veux boire de l’eau.",
                                    "confidence": 0.1 if body.mode == "low" else 0.92,
                                }
                            ],
                        },
                    }
                ]
            }
        )
    app.state.ai_provider = ProviderManager(provider)
    await previous.aclose()
    return {
        "provider": provider.provider_id,
        "synthetic_fixture_count": 1
        if body.mode in ("proposal", "refusal", "unfaithful", "low")
        else 0,
    }
