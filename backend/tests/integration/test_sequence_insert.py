import json
from uuid import UUID, uuid4

import pytest

from tests.integration.test_business_api import api as api
from tests.integration.test_business_api import evolution_fixture
from tests.integration.test_sequence_replace import personal_block

pytestmark = pytest.mark.postgres


@pytest.mark.parametrize("gap", [0, 2, 3])
def test_insert_is_atomic_and_scoped_and_preserves_accepted_resources_and_rhythm(api, gap):
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
        for name in (
            "memory",
            "keyboard",
            "blocks",
            "concepts",
            "representations",
        )
    }
    seq = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{seq['id']}"
    ids = [water, book, water]
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
    # The same touch can be inserted again; this is intentional repetition.
    body = {"action": "insert", "block_id": water, "index": gap, "expected_block_ids": ids}
    audit = api.get(base + "/audit").json()
    for block, status in ((proposed, 400), (rejected, 400), (foreign_book, 404)):
        assert api.post(path + "/selection", json={**body, "block_id": block}).status_code == status
        assert api.get(path).json()["block_ids"] == ids
        assert api.get(base + "/audit").json() == audit
    assert api.post(foreign + f"/sequences/{seq['id']}/selection", json=body).status_code == 404
    # A matching anchor is insufficient if another occurrence/order changed.
    assert (
        api.post(
            path + "/selection",
            json={
                **body,
                "expected_block_ids": [book, water, water],
            },
        ).status_code
        == 409
    )
    assert api.get(base + "/audit").json() == audit
    result = api.post(path + "/selection", json=body)
    assert result.status_code == 200
    assert result.json()["block_ids"] == ids[:gap] + [water] + ids[gap:]
    assert api.get(path).json() == result.json()
    with api.app.state.pcl_units() as store:
        events = store.audit_history(
            UUID(seq["profile_id"]),
            target_type="communication_sequence",
            target_id=UUID(seq["id"]),
            limit=100,
        )
    inserts = [event for event in events if event.event_type == "sequence_insert"]
    assert len(inserts) == 1
    assert json.loads(inserts[0].previous_state)["block_ids"] == ids
    assert json.loads(inserts[0].new_state)["presentation"] == {"inserted_index": gap}
    after = api.get(base + "/audit").json()
    assert len(after) == len(audit) + 1
    assert api.post(path + "/selection", json=body).status_code == 409
    assert api.get(base + "/audit").json() == after
    assert api.get(path + "/rhythm").json() == rhythm
    assert {name: api.get(base + "/" + name).json() for name in before} == before


@pytest.mark.parametrize("action", ["complete", "cancel"])
def test_insert_terminal_sequence_returns_conflict_without_any_write(api, action):
    base, _ = evolution_fixture(api)
    water = api.get(base + "/blocks").json()[0]["id"]
    seq = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{seq['id']}"
    api.post(path + "/selection", json={"action": "append", "block_id": water}).raise_for_status()
    api.post(path + "/selection", json={"action": action}).raise_for_status()
    original = api.get(path).json()
    audit = api.get(base + "/audit").json()
    assert (
        api.post(
            path + "/selection",
            json={
                "action": "insert",
                "block_id": water,
                "index": 1,
                "expected_block_ids": [water],
            },
        ).status_code
        == 409
    )
    assert api.get(path).json() == original
    assert api.get(base + "/audit").json() == audit
