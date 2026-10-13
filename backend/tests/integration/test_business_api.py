import json
from uuid import uuid4

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.api.application import create_app
from app.config import Settings
from app.infrastructure.postgres.pcl_repository import PostgresPCLUnits

pytestmark = pytest.mark.postgres


@pytest.fixture
def api(postgres_connection):
    factory = sessionmaker(
        bind=postgres_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    # This scenario exercises literal PCL interpretation, independently of the outer stack's mode.
    app = create_app(
        Settings(environment="test", ai_provider="disabled", database_url=None, _env_file=None)
    )
    with TestClient(app) as client:
        app.state.pcl_units = PostgresPCLUnits(factory)
        yield client


def test_http_communication_and_correction_are_profile_scoped(api, monkeypatch):
    signals = []
    monkeypatch.setattr(
        api.app.state.telemetry, "signal", lambda name, **fields: signals.append((name, fields))
    )
    a = api.post("/api/v1/profiles").json()["id"]
    b = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{a}"
    foreign = f"/api/v1/profiles/{b}"
    concept = api.post(base + "/concepts", json={"canonical_key": "NOISE", "label": "Bruit"}).json()
    assert api.get(foreign + "/concepts").json() == []
    assert (
        api.patch(foreign + "/concepts/" + concept["id"], json={"label": "Intrusion"}).status_code
        == 404
    )
    block = api.post(base + "/blocks", json={"concept_id": concept["id"], "label": "Bruit"}).json()
    assert api.get(base + "/keyboard").json() == []
    feedback = {"action": "confirm", "actor_role": "user"}
    assert api.post(base + "/blocks/" + block["id"] + "/feedback", json=feedback).status_code == 200
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + "/sequences/" + sequence["id"]
    assert api.get(path).json()["status"] == "in_progress"
    assert api.get(foreign + "/sequences/" + sequence["id"]).status_code == 404
    assert (
        api.post(
            path + "/selection", json={"action": "append", "block_id": block["id"]}
        ).status_code
        == 200
    )
    assert api.post(path + "/selection", json={"action": "complete"}).status_code == 200
    assert api.get(path).json()["block_ids"] == [block["id"]]
    decision = api.post(path + "/interpret", json={}).json()
    assert decision["state"] == "multiple_hypotheses"
    assert ("interpretation.result", {"result_state": "multiple_hypotheses"}) in signals
    interpretation = decision["candidates"][0]
    reference = "/interpretations/" + interpretation["id"]
    assert api.get(base + reference).json()["status"] == "proposed"
    assert api.get(foreign + reference).status_code == 404
    assert api.get(base + "/memory").json()["interpretations"] == []
    endpoint = "/interpretations/" + interpretation["id"] + "/feedback"
    assert api.post(foreign + endpoint, json=feedback).status_code == 404
    corrected = api.post(
        base + endpoint,
        json={"action": "correct", "actor_role": "user", "corrected_value": "Le bruit me gêne."},
    ).json()
    assert corrected["text"] == "Bruit" and corrected["corrected_text"] == "Le bruit me gêne."
    assert api.get(base + reference).json()["corrected_text"] == "Le bruit me gêne."
    assert len(api.get(base + "/memory").json()["interpretations"]) == 1
    assert api.get(foreign + "/memory").json()["interpretations"] == []
    assert api.get(base + "/audit").json()[-1]["event_type"] == "interpretation_correct"
    assert api.delete(base + "/memory").status_code == 204
    assert api.get(base + "/concepts").json() == []
    assert api.get(path).status_code == 404
    assert api.get(base + reference).status_code == 404
    assert api.get(foreign + "/audit").json() == []


def test_http_rejects_implicit_validation_and_keeps_secrets_server_side(api):
    profile = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    response = api.post(
        base + "/concepts",
        json={"canonical_key": "KEY", "label": "Private text", "status": "validated"},
    )
    assert response.status_code == 422 and "Private text" not in response.text
    assert api.get("/api/v1/providers").json() == {
        "provider_id": "disabled",
        "status": "disabled",
        "capabilities": [],
        "error_code": None,
        "metadata": None,
    }


def test_pictogram_and_word_are_validated_together_and_remain_profile_scoped(api):
    profile = api.post("/api/v1/profiles").json()["id"]
    foreign = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    concept = api.post(
        base + "/concepts", json={"canonical_key": "TOILETS", "label": "Toilettes"}
    ).json()
    block = api.post(
        base + "/blocks",
        json={"concept_id": concept["id"], "label": "Toilettes", "pictogram_key": "toilets"},
    ).json()
    assert block["status"] == "proposed" and block["representation_id"]
    assert api.get(base + "/keyboard").json() == []
    visuals = api.get(base + "/representations").json()
    assert len(visuals) == 1 and visuals[0]["status"] == "proposed"
    feedback = {"action": "confirm", "actor_role": "caregiver"}
    endpoint = base + "/blocks/" + block["id"]
    assert api.post(endpoint + "/feedback", json=feedback).status_code == 400
    assert api.get(base + "/representations").json() == visuals
    accepted = api.post(endpoint + "/feedback", json={**feedback, "confirm_representation": True})
    assert accepted.status_code == 200 and accepted.json()["status"] == "validated"
    assert api.get(base + "/representations").json()[0]["status"] == "validated"
    place = {"zone": "stable", "position": 5, "actor_role": "caregiver"}
    assert api.put(base + "/keyboard/" + block["id"], json=place).status_code == 200
    keyboard = api.get(base + "/keyboard").json()
    selection = {"pictogram_key": "book", "actor_role": "caregiver"}
    foreign_endpoint = f"/api/v1/profiles/{foreign}/blocks/{block['id']}/pictogram"
    assert api.put(foreign_endpoint, json=selection).status_code == 404
    assert api.get(f"/api/v1/profiles/{foreign}/representations").json() == []
    changed = api.put(endpoint + "/pictogram", json=selection)
    assert changed.status_code == 200
    current = changed.json()
    assert current["label"] == "Toilettes" and current["concept_id"] == concept["id"]
    assert (
        current["stability"] == "stable"
        and current["representation_id"] != block["representation_id"]
    )
    assert current["visual_reference"] == "pictoflow:pictogram:v1:book"
    assert api.get(base + "/keyboard").json() == keyboard
    visuals = api.get(base + "/representations").json()
    assert len(visuals) == 2 and all(item["status"] == "validated" for item in visuals)
    assert all(item["concept_id"] == concept["id"] for item in visuals)
    assert api.get(base + "/relations").json() == []
    audit = api.get(base + "/audit").json()
    assert audit[-1]["event_type"] == "block_representation_changed"
    assert audit[-1]["source"] == "human:caregiver"
    # An uncertain network response can be reconciled and retried without duplicating a visual.
    assert api.put(endpoint + "/pictogram", json=selection).status_code == 200
    assert api.get(base + "/representations").json() == visuals
    assert api.get(base + "/audit").json() == audit


def test_invalid_or_implicit_pictogram_actions_leave_no_partial_changes(api, monkeypatch):
    from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository

    profile = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    concept = api.post(base + "/concepts", json={"canonical_key": "YES", "label": "Oui"}).json()
    for key in ("../../secret", "https://example.com/tracker.svg", "unknown"):
        assert (
            api.post(
                base + "/blocks",
                json={"concept_id": concept["id"], "label": "Oui", "pictogram_key": key},
            ).status_code
            == 422
        )
    assert api.get(base + "/blocks").json() == []
    assert api.get(base + "/representations").json() == []
    block = api.post(
        base + "/blocks", json={"concept_id": concept["id"], "label": "Oui", "pictogram_key": "yes"}
    ).json()
    endpoint = base + "/blocks/" + block["id"]
    assert (
        api.put(
            endpoint + "/pictogram", json={"pictogram_key": "no", "actor_role": "user"}
        ).status_code
        == 400
    )
    assert (
        api.post(
            endpoint + "/feedback",
            json={"action": "reject", "actor_role": "user", "confirm_representation": True},
        ).status_code
        == 400
    )
    before = {
        name: api.get(base + "/" + name).json() for name in ("blocks", "representations", "audit")
    }
    original = PostgresPCLRepository.audit

    def failing_audit(self, profile_id, event_type, *args, **kwargs):
        if event_type == "block_confirm":
            raise RuntimeError("Injected failure after visual validation")
        return original(self, profile_id, event_type, *args, **kwargs)

    with monkeypatch.context() as context:
        context.setattr(PostgresPCLRepository, "audit", failing_audit)
        with pytest.raises(RuntimeError, match="Injected failure"):
            api.post(
                endpoint + "/feedback",
                json={"action": "confirm", "actor_role": "user", "confirm_representation": True},
            )
    assert {name: api.get(base + "/" + name).json() for name in before} == before
    assert api.get(base + "/keyboard").json() == []


@pytest.mark.parametrize("kind", ["invalid", "refusal", "proposal"])
def test_strict_phrase_responses_never_promote_invalid_or_unconfirmed_meaning(api, kind):
    from app.ai.manager import ProviderManager
    from app.ai.providers.openai_compatible import OpenAICompatibleProvider

    requests = []
    output = {"status": "proposal", "candidates": []}
    if kind == "refusal":
        output["status"] = "not_understood"
    elif kind == "proposal":
        output["candidates"] = [
            {"intent": "DRINK", "text": "Je voudrais boire.", "confidence": 0.99}
        ]

    def respond(request):
        requests.append(request)
        assert json.loads(request.content)["response_format"]["type"] == "json_schema"
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": json.dumps({"result": output})},
                    }
                ]
            },
        )

    api.app.state.ai_provider = ProviderManager(
        OpenAICompatibleProvider(
            "https://example.test/v1",
            "model",
            response_format="json_schema",
            transport=httpx.MockTransport(respond),
        )
    )
    profile = api.post("/api/v1/profiles").json()["id"]
    foreign = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    concept = api.post(base + "/concepts", json={"canonical_key": "DRINK", "label": "Boire"}).json()
    block = api.post(base + "/blocks", json={"concept_id": concept["id"], "label": "Boire"}).json()
    api.post(
        base + "/blocks/" + block["id"] + "/feedback",
        json={"action": "confirm", "actor_role": "user"},
    ).raise_for_status()
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + "/sequences/" + sequence["id"]
    api.post(
        path + "/selection", json={"action": "append", "block_id": block["id"]}
    ).raise_for_status()
    api.post(path + "/selection", json={"action": "complete"}).raise_for_status()
    assert (
        api.post(
            f"/api/v1/profiles/{foreign}/sequences/{sequence['id']}/interpret", json={}
        ).status_code
        == 404
    )
    assert requests == []
    response = api.post(path + "/interpret", json={})
    assert len(requests) == 1
    assert api.get(path).json()["block_ids"] == [block["id"]]
    assert api.get(path).json()["status"] == "completed"
    assert api.get(base + "/memory").json()["interpretations"] == []
    if kind == "invalid":
        assert response.status_code == 502
        assert response.json() == {"detail": "Provider operation failed"}
        assert api.get(base + "/interpretations").json() == []
    elif kind == "refusal":
        assert response.status_code == 200
        assert response.json() == {"state": "not_understood", "candidates": []}
        assert api.get(base + "/interpretations").json()[0]["status"] == "not_understood"
    else:
        assert response.status_code == 200
        candidate = response.json()["candidates"][0]
        assert candidate["text"] == "Je voudrais boire." and candidate["status"] == "proposed"
        api.post(
            base + "/interpretations/" + candidate["id"] + "/feedback",
            json={"action": "confirm", "actor_role": "user"},
        ).raise_for_status()
        assert len(api.get(base + "/memory").json()["interpretations"]) == 1
