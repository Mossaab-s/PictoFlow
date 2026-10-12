from uuid import uuid4

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
    assert (
        api.post(
            path + "/selection", json={"action": "append", "block_id": block["id"]}
        ).status_code
        == 200
    )
    assert api.post(path + "/selection", json={"action": "complete"}).status_code == 200
    decision = api.post(path + "/interpret", json={}).json()
    assert decision["state"] == "multiple_hypotheses"
    assert ("interpretation.result", {"result_state": "multiple_hypotheses"}) in signals
    interpretation = decision["candidates"][0]
    assert api.get(base + "/memory").json()["interpretations"] == []
    endpoint = "/interpretations/" + interpretation["id"] + "/feedback"
    assert api.post(foreign + endpoint, json=feedback).status_code == 404
    corrected = api.post(
        base + endpoint,
        json={"action": "correct", "actor_role": "user", "corrected_value": "Le bruit me gêne."},
    ).json()
    assert corrected["text"] == "Bruit" and corrected["corrected_text"] == "Le bruit me gêne."
    assert len(api.get(base + "/memory").json()["interpretations"]) == 1
    assert api.get(foreign + "/memory").json()["interpretations"] == []
    assert api.get(base + "/audit").json()[-1]["event_type"] == "interpretation_correct"
    assert api.delete(base + "/memory").status_code == 204
    assert api.get(base + "/concepts").json() == []
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
