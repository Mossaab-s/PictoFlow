"""Isolated browser-CI adapter; never imported by the application or server image."""

import os
from uuid import UUID

from pydantic import BaseModel

from app.ai.manager import ProviderManager
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


@app.post("/_synthetic/fixture")
async def configure_fixture(body: FixtureSelection):
    request = InterpretationService(app.state.pcl_units, None, None).request(
        body.profile_id, body.sequence_id
    )
    previous = app.state.ai_provider
    app.state.ai_provider = ProviderManager(
        FakeProvider(
            {
                "interpretations": [
                    {
                        "request": request.model_dump(mode="json"),
                        "response": {
                            "candidates": [
                                {
                                    "intent": "request",
                                    "text": "Je veux boire de l’eau.",
                                    "confidence": 0.92,
                                }
                            ]
                        },
                    }
                ]
            }
        )
    )
    await previous.aclose()
    return {"provider": "fake", "synthetic_fixture_count": 1}
