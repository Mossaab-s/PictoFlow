"""Isolated browser-CI adapter; never imported by the application or server image."""

import asyncio
import os
from hashlib import sha256
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
app.state.fixture_calls = 0
app.state.automatic_requests = []


class AutomaticFixture(FakeProvider):
    async def interpret(self, request):
        app.state.fixture_calls += 1
        app.state.automatic_requests.append(request.model_dump(mode="json"))
        if app.state.fixture_calls == 1:
            await asyncio.sleep(2.5)
        text = " ".join(block.label for block in request.blocks) + "."
        provider = FakeProvider(
            {
                "interpretations": [
                    {
                        "request": request.model_dump(mode="json"),
                        "response": {
                            "status": "proposal",
                            "candidates": [{"intent": "other", "text": text, "confidence": 0.92}],
                        },
                    }
                ]
            }
        )
        return await provider.interpret(request)


@app.post("/_synthetic/automatic")
async def automatic_fixture():
    previous = app.state.ai_provider
    app.state.fixture_calls = 0
    app.state.automatic_requests = []
    app.state.ai_provider = ProviderManager(
        AutomaticFixture(), cache_revision="automatic-browser-v1"
    )
    await previous.aclose()
    return {"provider": "fake"}


@app.get("/_synthetic/automatic")
def automatic_requests():
    return {"requests": app.state.automatic_requests}


class CountingFakeProvider(FakeProvider):
    async def interpret(self, request):
        app.state.fixture_calls += 1
        return await super().interpret(request)


@app.get("/_synthetic/calls")
def fixture_calls():
    return {"calls": app.state.fixture_calls}


class FixtureSelection(BaseModel):
    profile_id: UUID
    sequence_id: UUID
    mode: Literal[
        "proposal",
        "alternatives",
        "disabled",
        "refusal",
        "unfaithful",
        "low",
        "invalid",
        "unavailable",
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
        candidates = [
            {
                "intent": "request",
                "text": "Je voudrais un livre."
                if body.mode == "unfaithful"
                else "Je veux boire de l’eau.",
                "confidence": 0.1 if body.mode == "low" else 0.92,
            }
        ]
        if body.mode == "alternatives":
            candidates.extend(
                [
                    {"intent": "statement", "text": "Je bois de l’eau.", "confidence": 0.86},
                    {"intent": "question", "text": "Boire de l’eau ?", "confidence": 0.8},
                ]
            )
        provider = CountingFakeProvider(
            {
                "interpretations": [
                    {
                        "request": request.model_dump(mode="json"),
                        "response": {
                            "status": "not_understood" if body.mode == "refusal" else "proposal",
                            "candidates": [] if body.mode == "refusal" else candidates,
                        },
                    }
                ]
            }
        )
    app.state.fixture_calls = 0
    app.state.ai_provider = ProviderManager(
        provider,
        cache_revision=sha256((body.mode + request.model_dump_json()).encode()).hexdigest(),
    )
    await previous.aclose()
    return {
        "provider": provider.provider_id,
        "synthetic_fixture_count": 1
        if body.mode in ("proposal", "alternatives", "refusal", "unfaithful", "low")
        else 0,
    }
