import json
from uuid import UUID, uuid4

import pytest

from tests.integration.test_business_api import api as api
from tests.integration.test_business_api import evolution_fixture
from tests.integration.test_sequence_replace import personal_block

pytestmark = pytest.mark.postgres


def finished(api):
    base, _ = evolution_fixture(api)
    water = api.get(base + "/blocks").json()[0]["id"]
    book = personal_block(api, base)
    seq = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{seq['id']}"
    for block in [water, book, water]:
        api.post(
            path + "/selection",
            json={
                "action": "append",
                "block_id": block,
                "observation": {"interval_ms": 123, "input_method": "keyboard"},
            },
        ).raise_for_status()
    result = api.post(path + "/selection", json={"action": "complete"}).json()
    return base, path, result


def test_atomic_copy_preserves_source_meaning_and_rhythm_and_retries_return_actual_edited_copy(api):
    base, path, source = finished(api)
    candidate = api.post(path + "/interpret", json={}).json()["candidates"][0]
    api.post(
        base + f"/interpretations/{candidate['id']}/feedback",
        json={"action": "confirm", "actor_role": "user"},
    ).raise_for_status()
    before = {
        name: api.get(base + "/" + name).json()
        for name in (
            "memory",
            "keyboard",
            "blocks",
            "concepts",
            "representations",
            "interpretations",
        )
    }
    rhythm = api.get(path + "/rhythm").json()
    body = {"request_id": str(uuid4()), "expected_block_ids": source["block_ids"], "confirm": True}
    audit = api.get(base + "/audit").json()
    response = api.post(path + "/copy", json=body)
    assert response.status_code == 200
    copied = response.json()
    assert copied["id"] == body["request_id"] and copied["id"] != source["id"]
    assert copied["block_ids"] == source["block_ids"]
    assert (
        copied["status"] == "in_progress"
        and copied["completed_at"] is None
        and copied["context_id"] is None
    )
    assert api.get(path).json() == source
    assert api.get(path + f"/copies/{copied['id']}").json() == copied
    copy_path = base + f"/sequences/{copied['id']}"
    assert api.get(copy_path + "/rhythm").json()["intervals"] == []
    after = api.get(base + "/audit").json()
    assert len(after) == len(audit) + 1
    with api.app.state.pcl_units() as store:
        events = store.audit_history(
            UUID(source["profile_id"]),
            target_type="communication_sequence",
            target_id=UUID(copied["id"]),
            limit=1,
        )
    assert events[0].event_type == "sequence_copied" and events[0].previous_state is None
    assert json.loads(events[0].new_state)["presentation"] == {
        "copied_from_sequence_id": source["id"]
    }
    assert api.post(path + "/copy", json=body).json() == copied
    assert api.get(base + "/audit").json() == after
    edited = api.post(copy_path + "/selection", json={"action": "undo"}).json()
    after = api.get(base + "/audit").json()
    assert api.post(path + "/copy", json=body).json() == edited
    assert api.get(path + f"/copies/{copied['id']}").json() == edited
    assert api.get(base + "/audit").json() == after
    assert (
        api.post(
            path + "/copy",
            json={**body, "expected_block_ids": list(reversed(source["block_ids"]))[1:]},
        ).status_code
        == 409
    )
    assert api.get(base + "/audit").json() == after
    assert api.get(path + "/rhythm").json() == rhythm
    completed = api.post(copy_path + "/selection", json={"action": "complete"}).json()
    audit_completed = api.get(base + "/audit").json()
    assert api.post(path + "/copy", json=body).json() == completed
    assert api.get(copy_path + f"/copies/{copied['id']}").status_code == 409
    assert api.get(base + "/audit").json() == audit_completed
    assert {name: api.get(base + "/" + name).json() for name in before} == before


def test_copy_scope_unavailable_source_and_request_collisions_never_add_partial_drafts(api):
    base, path, source = finished(api)
    foreign_base, foreign_path, foreign = finished(api)
    body = {"request_id": str(uuid4()), "expected_block_ids": source["block_ids"], "confirm": True}
    audit = api.get(base + "/audit").json()
    assert api.post(foreign_base + f"/sequences/{source['id']}/copy", json=body).status_code == 404
    assert (
        api.post(
            path + "/copy", json={**body, "expected_block_ids": source["block_ids"][:-1]}
        ).status_code
        == 409
    )
    assert api.post(path + "/copy", json={**body, "request_id": source["id"]}).status_code == 409
    assert api.post(path + "/copy", json={**body, "request_id": foreign["id"]}).status_code == 409
    assert api.get(foreign_path).json() == foreign
    assert api.get(path + f"/copies/{foreign['id']}").status_code == 404
    assert api.get(path + f"/copies/{source['id']}").status_code == 409
    assert api.get(base + "/audit").json() == audit
    api.post(
        base + f"/blocks/{source['block_ids'][0]}/feedback",
        json={"action": "reject", "actor_role": "user"},
    ).raise_for_status()
    audit = api.get(base + "/audit").json()
    assert api.post(path + "/copy", json=body).status_code == 409
    assert api.get(base + f"/sequences/{body['request_id']}").status_code == 404
    assert api.get(base + "/audit").json() == audit
    assert api.get(path).json() == source


@pytest.mark.parametrize("action", [None, "cancel"])
def test_copy_rejects_unfinished_and_cancelled_messages(api, action):
    base, _ = evolution_fixture(api)
    water = api.get(base + "/blocks").json()[0]["id"]
    seq = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{seq['id']}"
    api.post(path + "/selection", json={"action": "append", "block_id": water}).raise_for_status()
    if action:
        api.post(path + "/selection", json={"action": action}).raise_for_status()
    audit = api.get(base + "/audit").json()
    body = {"request_id": str(uuid4()), "expected_block_ids": [water], "confirm": True}
    assert api.post(path + "/copy", json=body).status_code == 409
    assert api.get(base + "/audit").json() == audit
