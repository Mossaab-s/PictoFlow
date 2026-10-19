import json
from uuid import UUID, uuid4

import pytest

from app.domain.pcl.entities import CommunicationSequence
from tests.integration.test_business_api import api as api
from tests.integration.test_business_api import evolution_fixture

pytestmark = pytest.mark.postgres


def test_removal_is_atomic_scoped_reconciliable_and_does_not_change_accepted_memory(api):
    base, candidate = evolution_fixture(api)
    accepted = candidate()
    api.post(
        base + f"/interpretations/{accepted['id']}/feedback",
        json={"action": "confirm", "actor_role": "user"},
    ).raise_for_status()
    before = {name: api.get(base + "/" + name).json() for name in ("memory", "keyboard", "blocks")}
    block = before["blocks"][0]["id"]
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{sequence['id']}"
    for _ in range(3):
        api.post(
            path + "/selection",
            json={
                "action": "append",
                "block_id": block,
                "observation": {"interval_ms": 100, "input_method": "pointer"},
            },
        ).raise_for_status()
    rhythm = api.get(path + "/rhythm").json()
    body = {"action": "remove", "index": 1, "expected_block_ids": [block] * 3}
    foreign = api.post("/api/v1/profiles").json()["id"]
    assert (
        api.post(
            f"/api/v1/profiles/{foreign}/sequences/{sequence['id']}/selection", json=body
        ).status_code
        == 404
    )
    audit_before = api.get(base + "/audit").json()
    removed = api.post(path + "/selection", json=body)
    assert removed.status_code == 200 and removed.json()["block_ids"] == [block] * 2
    assert api.get(path).json() == removed.json()
    units = api.app.state.pcl_units
    with units() as store:
        events = store.audit_history(
            UUID(sequence["profile_id"]),
            target_type="communication_sequence",
            target_id=UUID(sequence["id"]),
            limit=100,
        )
        assert (
            store.get(
                UUID(sequence["profile_id"]), CommunicationSequence, UUID(sequence["id"])
            ).block_ids
            == (UUID(block),) * 2
        )
    edits = [e for e in events if e.event_type == "sequence_remove"]
    assert len(edits) == 1
    assert json.loads(edits[0].new_state)["presentation"] == {"removed_index": 1}
    after = api.get(base + "/audit").json()
    assert len(after) == len(audit_before) + 1
    # Replaying an uncertain response must not remove the remaining repeated occurrence.
    assert api.post(path + "/selection", json=body).status_code == 409
    assert api.get(base + "/audit").json() == after
    assert api.get(path + "/rhythm").json() == rhythm
    for ids in ([block, str(uuid4())], [block] * 3):
        assert (
            api.post(path + "/selection", json={**body, "expected_block_ids": ids}).status_code
            == 409
        )
    for count in (2, 1):
        response = api.post(
            path + "/selection", json={**body, "index": 0, "expected_block_ids": [block] * count}
        )
        assert response.status_code == 200 and len(response.json()["block_ids"]) == count - 1
    assert api.get(path).json()["status"] == "in_progress"
    assert api.post(path + "/selection", json={"action": "complete"}).status_code == 400
    assert {name: api.get(base + "/" + name).json() for name in before} == before
    completed = base + f"/sequences/{accepted['sequence_id']}"
    original = api.get(completed).json()
    assert (
        api.post(
            completed + "/selection",
            json={"action": "remove", "index": 0, "expected_block_ids": original["block_ids"]},
        ).status_code
        == 409
    )
    assert api.get(completed).json() == original
    api.post(path + "/selection", json={"action": "append", "block_id": block}).raise_for_status()
    api.post(path + "/selection", json={"action": "cancel"}).raise_for_status()
    assert (
        api.post(
            path + "/selection",
            json={"action": "remove", "index": 0, "expected_block_ids": [block]},
        ).status_code
        == 409
    )


def test_removal_compares_the_whole_ordered_draft_not_just_the_target(api):
    base, _ = evolution_fixture(api)
    first = api.get(base + "/blocks").json()[0]["id"]
    second = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Livre",
            "pictogram_key": "book",
            "actor_role": "user",
        },
    ).json()["id"]
    api.post(
        base + f"/blocks/{second}/feedback",
        json={"action": "confirm", "actor_role": "user", "confirm_representation": True},
    ).raise_for_status()
    seq = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{seq['id']}"
    ids = [first, second, first]
    for block in ids:
        api.post(
            path + "/selection", json={"action": "append", "block_id": block}
        ).raise_for_status()
    before = api.get(base + "/audit").json()
    # The target at index 2 is still the same, but another position changed.
    assert (
        api.post(
            path + "/selection",
            json={"action": "remove", "index": 2, "expected_block_ids": [second, first, first]},
        ).status_code
        == 409
    )
    assert api.get(base + "/audit").json() == before
    removed = api.post(
        path + "/selection", json={"action": "remove", "index": 1, "expected_block_ids": ids}
    )
    assert removed.status_code == 200 and removed.json()["block_ids"] == [first, first]
