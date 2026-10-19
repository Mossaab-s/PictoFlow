"""Real HTTP/SQL memory decisions for synthetic everyday communication scenarios."""

import json
from uuid import uuid4

import httpx2 as httpx
import pytest

from app.ai.evaluation import SCENARIOS
from app.ai.manager import ProviderManager
from app.ai.providers.openai_compatible import OpenAICompatibleProvider
from tests.integration.test_business_api import api as api

pytestmark = pytest.mark.postgres
CASES = (
    ("personne_besoin", None),
    ("negation", None),
    ("emotion_choisie", "Je suis très content."),
    ("repetition", "Je veux boire encore."),
    ("deux_personnes", "Maman mange avec Papa."),
    ("demande_moi", None),
    ("ambiguite_relation", "Maman aime Papa."),
)
DRAWINGS = {
    "Maman": "mother",
    "Papa": "father",
    "Boire": "drink",
    "Eau": "water",
    "Non": "no",
    "Manger": "eat",
    "Content": "happy",
    "Aimer": "love",
}


def call(api, method, path, data=None):
    response = getattr(api, method)(
        "/api/v1/" + path, **({"json": data} if data is not None else {})
    )
    response.raise_for_status()
    return None if response.status_code == 204 else response.json()


def compose(api, base, blocks):
    sequence = call(api, "post", base + "/sequences", {"session_id": str(uuid4())})
    path = base + "/sequences/" + sequence["id"] + "/selection"
    for block in blocks:
        call(api, "post", path, {"action": "append", "block_id": block["id"]})
    return call(api, "post", path, {"action": "complete"})


@pytest.mark.parametrize("name,correction", CASES, ids=[case[0] for case in CASES])
def test_scenario_choice_retention_recall_withdrawal_and_profile_isolation(api, name, correction):
    scenario = next(item for item in SCENARIOS if item.name == name)
    profile = call(api, "post", "profiles")["id"]
    other = call(api, "post", "profiles")["id"]
    base, foreign = f"profiles/{profile}", f"profiles/{other}"
    blocks = {}
    for label in dict.fromkeys(scenario.labels):
        concept = call(
            api,
            "post",
            base + "/concepts",
            {
                "canonical_key": "POC_" + str(len(blocks)),
                "label": label,
            },
        )
        block = call(
            api,
            "post",
            base + "/blocks",
            {
                "concept_id": concept["id"],
                "label": label,
                **({"pictogram_key": DRAWINGS[label]} if label in DRAWINGS else {}),
            },
        )
        call(
            api,
            "post",
            base + "/blocks/" + block["id"] + "/feedback",
            {
                "action": "confirm",
                "actor_role": "user",
                "confirm_representation": label in DRAWINGS,
            },
        )
        blocks[label] = block
    selected = [blocks[label] for label in scenario.labels]
    sequence = compose(api, base, selected)
    requests = []
    output = {
        "status": "proposal",
        "candidates": [
            {
                "intent": "synthetic",
                "text": scenario.text,
                "confidence": 0.99,
            }
        ],
    }

    def respond(request):
        payload = json.loads(request.content)
        data = json.loads(payload["messages"][1]["content"])["request"]
        requests.append(data)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": json.dumps(output)},
                    }
                ]
            },
        )

    api.app.state.ai_provider = ProviderManager(
        OpenAICompatibleProvider(
            "https://synthetic.invalid/v1",
            "synthetic",
            response_format="json_schema",
            transport=httpx.MockTransport(respond),
        )
    )
    decision = call(api, "post", base + "/sequences/" + sequence["id"] + "/interpret", {})
    candidate = decision["candidates"][0]
    assert decision["state"] == "proposal"  # Even 0.99 does not mean accepted.
    assert candidate["source"] == "openai-compatible" and candidate["status"] == "proposed"
    assert [block["label"] for block in requests[0]["blocks"]] == list(scenario.labels)
    assert candidate["text"] == scenario.text
    assert call(api, "get", base + "/memory")["interpretations"] == []
    assert api.get("/api/v1/" + base + "/phrases/" + candidate["id"]).status_code == 409

    feedback = base + "/interpretations/" + candidate["id"] + "/feedback"
    accepted = call(
        api,
        "post",
        feedback,
        {
            "action": "correct" if correction else "confirm",
            "actor_role": "user",
            **({"corrected_value": correction} if correction else {}),
        },
    )
    expected = correction or scenario.text
    memory = call(api, "get", base + "/memory")
    assert [item["id"] for item in memory["interpretations"]] == [accepted["id"]]
    assert accepted["corrected_text"] == correction
    assert memory["sequences"][0]["block_ids"] == [block["id"] for block in selected]
    assert memory["relations"] == []  # A phrase choice does not invent semantic links.

    repeated = compose(api, base, selected)
    assert repeated["id"] != sequence["id"] and repeated["block_ids"] == sequence["block_ids"]
    before_read = call(api, "get", base + "/audit")
    phrase = call(api, "get", base + "/phrases/" + accepted["id"])
    retained = phrase["interpretation"]
    assert (retained["corrected_text"] or retained["text"]) == expected
    assert call(api, "get", base + "/audit") == before_read
    assert call(api, "get", base + "/memory") == memory
    assert len(requests) == 1  # Recall and a new composition do not call the provider.
    # A deliberately requested new proposal can use eligible human corrections,
    # but neither that example nor a high provider score accepts the new message.
    next_decision = call(api, "post", base + "/sequences/" + repeated["id"] + "/interpret", {})
    assert requests[1]["correction_examples"] == (
        [correction] if name in ("deux_personnes", "ambiguite_relation") else []
    )
    assert all(item["status"] == "proposed" for item in next_decision["candidates"])
    assert call(api, "get", base + "/memory") == memory
    assert call(api, "get", foreign + "/memory")["interpretations"] == []
    assert api.get("/api/v1/" + foreign + "/phrases/" + accepted["id"]).status_code == 404
    assert (
        api.post(
            "/api/v1/" + foreign + "/interpretations/" + accepted["id"] + "/feedback",
            json={"action": "confirm", "actor_role": "user"},
        ).status_code
        == 404
    )
    call(api, "post", feedback, {"action": "reject", "actor_role": "user"})
    assert call(api, "get", base + "/memory")["interpretations"] == []
    assert api.get("/api/v1/" + base + "/phrases/" + accepted["id"]).status_code == 409
    decisions = [
        event["event_type"]
        for event in call(api, "get", base + "/audit")
        if event["event_type"]
        in ("interpretation_confirm", "interpretation_correct", "interpretation_reject")
    ]
    assert decisions == [
        "interpretation_correct" if correction else "interpretation_confirm",
        "interpretation_reject",
    ]
