import json
from uuid import UUID, uuid4

import pytest

from tests.integration.test_business_api import api as api
from tests.integration.test_business_api import evolution_fixture

pytestmark = pytest.mark.postgres


def personal_block(api, base, action="confirm"):
    block = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Livre",
            "pictogram_key": "book",
            "actor_role": "user",
        },
    ).json()
    if action:
        api.post(
            base + f"/blocks/{block['id']}/feedback",
            json={
                "action": action,
                "actor_role": "user",
                "confirm_representation": action == "confirm",
            },
        ).raise_for_status()
    return block["id"]


def test_replace_is_atomic_scoped_and_preserves_memory_keyboard_and_observations(api):
    base, candidate = evolution_fixture(api)
    accepted = candidate()
    api.post(
        base + f"/interpretations/{accepted['id']}/feedback",
        json={"action": "confirm", "actor_role": "user"},
    ).raise_for_status()
    water = api.get(base + "/blocks").json()[0]["id"]
    book = personal_block(api, base)
    proposed = personal_block(api, base, None)
    rejected = personal_block(api, base, "reject")
    foreign = "/api/v1/profiles/" + api.post("/api/v1/profiles").json()["id"]
    foreign_book = personal_block(api, foreign)
    before = {
        name: api.get(base + "/" + name).json()
        for name in ("memory", "keyboard", "blocks", "concepts", "representations")
    }
    seq = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{seq['id']}"
    ids = [water, water, book, water]
    for block in ids:
        api.post(
            path + "/selection",
            json={
                "action": "append",
                "block_id": block,
                "observation": {"interval_ms": 123, "input_method": "keyboard"},
            },
        ).raise_for_status()
    rhythm = api.get(path + "/rhythm").json()
    body = {"action": "replace", "block_id": book, "index": 1, "expected_block_ids": ids}
    audit = api.get(base + "/audit").json()
    for replacement, status in ((proposed, 400), (rejected, 400), (foreign_book, 404)):
        assert (
            api.post(path + "/selection", json={**body, "block_id": replacement}).status_code
            == status
        )
        assert api.get(path).json()["block_ids"] == ids
        assert api.get(base + "/audit").json() == audit
    assert api.post(foreign + f"/sequences/{seq['id']}/selection", json=body).status_code == 404
    # The selected occurrence is unchanged, but another part of the snapshot is stale.
    assert (
        api.post(
            path + "/selection", json={**body, "expected_block_ids": [book, water, book, water]}
        ).status_code
        == 409
    )
    assert api.get(base + "/audit").json() == audit
    result = api.post(path + "/selection", json=body)
    assert result.status_code == 200
    assert result.json()["block_ids"] == [water, book, book, water]
    assert api.get(path).json() == result.json()
    with api.app.state.pcl_units() as store:
        events = store.audit_history(
            UUID(seq["profile_id"]),
            target_type="communication_sequence",
            target_id=UUID(seq["id"]),
            limit=100,
        )
    replacements = [event for event in events if event.event_type == "sequence_replace"]
    assert len(replacements) == 1
    assert json.loads(replacements[0].previous_state)["block_ids"] == ids
    assert json.loads(replacements[0].new_state)["presentation"] == {"replaced_index": 1}
    audit_after = api.get(base + "/audit").json()
    assert len(audit_after) == len(audit) + 1
    assert api.post(path + "/selection", json=body).status_code == 409
    assert api.get(base + "/audit").json() == audit_after
    assert api.get(path + "/rhythm").json() == rhythm
    assert {name: api.get(base + "/" + name).json() for name in before} == before


@pytest.mark.parametrize("action", ["complete", "cancel"])
def test_replace_terminal_sequences_conflict_and_noop_never_writes(api, action):
    base, _ = evolution_fixture(api)
    water = api.get(base + "/blocks").json()[0]["id"]
    book = personal_block(api, base)
    seq = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{seq['id']}"
    api.post(path + "/selection", json={"action": "append", "block_id": water}).raise_for_status()
    body = {"action": "replace", "block_id": water, "index": 0, "expected_block_ids": [water]}
    before = api.get(base + "/audit").json()
    assert api.post(path + "/selection", json=body).status_code == 422
    assert api.get(base + "/audit").json() == before
    api.post(path + "/selection", json={"action": action}).raise_for_status()
    original = api.get(path).json()
    before = api.get(base + "/audit").json()
    assert api.post(path + "/selection", json={**body, "block_id": book}).status_code == 409
    assert api.get(path).json() == original
    assert api.get(base + "/audit").json() == before
