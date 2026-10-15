from uuid import UUID, uuid4

import pytest

from app.application.interpretation import InterpretationService
from tests.integration.test_photo_api import api as api
from tests.integration.test_photo_api import photo_body, profile

pytestmark = pytest.mark.postgres


@pytest.mark.parametrize("photo", [False, True])
def test_personal_meaning_is_separate_reviewed_scoped_and_used_in_provider_context(api, photo):
    base = profile(api)
    endpoint = base + ("/blocks/photo" if photo else "/blocks/personal")
    values = {"label": "Ours", "meaning": "Mon doudou pour me rassurer"}
    body = (
        photo_body(**values)
        if photo
        else {"request_id": str(uuid4()), "pictogram_key": "toy", "actor_role": "user", **values}
    )
    response = api.post(endpoint, json=body)
    assert response.status_code == 201, response.text
    block = response.json()
    concepts = api.get(base + "/concepts").json()
    assert concepts[0]["label"] == values["meaning"]
    assert block["label"] == "Ours" and block["status"] == "proposed"
    assert api.get(base + "/keyboard").json() == []
    before = api.get(base + "/audit").json()
    assert api.post(endpoint, json=body).json()["id"] == block["id"]
    assert api.get(base + "/audit").json() == before
    assert api.post(endpoint, json={**body, "meaning": "Un autre sens"}).status_code == 400
    assert api.get(profile(api) + "/concepts").json() == []
    api.post(
        base + f"/blocks/{block['id']}/feedback",
        json={"action": "confirm", "actor_role": "caregiver", "confirm_representation": True},
    ).raise_for_status()
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    for action in ("append", "complete"):
        api.post(
            base + f"/sequences/{sequence['id']}/selection",
            json={"action": action, **({"block_id": block["id"]} if action == "append" else {})},
        ).raise_for_status()
    service = InterpretationService(api.app.state.pcl_units, None, None)
    request = service.request(
        UUID(base.rsplit("/", 1)[1]),
        UUID(sequence["id"]),
        declared_context=("Je me prépare à dormir",),
    )
    assert request.blocks[0].label == "Ours"
    assert request.blocks[0].meaning == values["meaning"]
    assert request.declared_context == ("Je me prépare à dormir",)
    assert api.get(base + "/memory").json()["interpretations"] == []


@pytest.mark.parametrize("meaning", ["   ", "x" * 257])
def test_invalid_personal_meaning_does_not_create_partial_data(api, meaning):
    base = profile(api)
    for endpoint, body in (
        (
            "personal",
            {
                "request_id": str(uuid4()),
                "label": "Ours",
                "pictogram_key": "toy",
                "actor_role": "user",
            },
        ),
        ("photo", photo_body()),
    ):
        response = api.post(base + "/blocks/" + endpoint, json={**body, "meaning": meaning})
        assert response.status_code == 422
    assert api.get(base + "/blocks").json() == []
    assert api.get(base + "/concepts").json() == []
