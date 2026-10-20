import json
from uuid import UUID, uuid4

import pytest

from app.domain.pcl.entities import CommunicationSequence
from tests.integration.test_business_api import api as api
from tests.integration.test_business_api import evolution_fixture

pytestmark = pytest.mark.postgres


def test_move_is_atomic_rejects_stale_replays_and_preserves_memory_keyboard_and_rhythm(api):
    base, candidate = evolution_fixture(api)
    accepted = candidate()
    api.post(
        base + f"/interpretations/{accepted['id']}/feedback",
        json={"action": "confirm", "actor_role": "user"},
    ).raise_for_status()
    water = api.get(base + "/blocks").json()[0]["id"]
    book = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Livre",
            "pictogram_key": "book",
            "actor_role": "user",
        },
    ).json()["id"]
    api.post(
        base + f"/blocks/{book}/feedback",
        json={"action": "confirm", "actor_role": "user", "confirm_representation": True},
    ).raise_for_status()
    before = {
        name: api.get(base + "/" + name).json()
        for name in ("memory", "keyboard", "blocks", "concepts", "representations")
    }
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{sequence['id']}"
    ids = [water, book, water]
    for block in ids:
        api.post(
            path + "/selection",
            json={
                "action": "append",
                "block_id": block,
                "observation": {"interval_ms": 100, "input_method": "keyboard"},
            },
        ).raise_for_status()
    rhythm = api.get(path + "/rhythm").json()
    body = {"action": "move", "index": 1, "target_index": 0, "expected_block_ids": ids}
    foreign = api.post("/api/v1/profiles").json()["id"]
    assert (
        api.post(
            f"/api/v1/profiles/{foreign}/sequences/{sequence['id']}/selection", json=body
        ).status_code
        == 404
    )
    audit_before = api.get(base + "/audit").json()
    result = api.post(path + "/selection", json=body)
    assert result.status_code == 200 and result.json()["block_ids"] == [book, water, water]
    assert api.get(path).json() == result.json()
    with api.app.state.pcl_units() as store:
        events = store.audit_history(
            UUID(sequence["profile_id"]),
            target_type="communication_sequence",
            target_id=UUID(sequence["id"]),
            limit=100,
        )
        assert store.get(
            UUID(sequence["profile_id"]), CommunicationSequence, UUID(sequence["id"])
        ).block_ids == (UUID(book), UUID(water), UUID(water))
    moves = [e for e in events if e.event_type == "sequence_move"]
    assert len(moves) == 1
    assert json.loads(moves[0].previous_state)["block_ids"] == ids
    assert json.loads(moves[0].new_state)["presentation"] == {
        "moved_from_index": 1,
        "moved_to_index": 0,
    }
    after = api.get(base + "/audit").json()
    assert len(after) == len(audit_before) + 1
    assert api.post(path + "/selection", json=body).status_code == 409
    assert api.get(base + "/audit").json() == after
    assert api.get(path + "/rhythm").json() == rhythm
    assert (
        api.post(
            path + "/selection",
            json={
                "action": "move",
                "index": 1,
                "target_index": 2,
                "expected_block_ids": [book, water, water],
            },
        ).status_code
        == 422
    )
    assert api.get(base + "/audit").json() == after
    moved = api.post(
        path + "/selection",
        json={
            "action": "move",
            "index": 0,
            "target_index": 2,
            "expected_block_ids": [book, water, water],
        },
    )
    assert moved.status_code == 200 and moved.json()["block_ids"] == [water, water, book]
    api.post(path + "/selection", json={"action": "complete"}).raise_for_status()
    original = api.get(path).json()
    conflict = api.post(
        path + "/selection",
        json={
            "action": "move",
            "index": 0,
            "target_index": 2,
            "expected_block_ids": original["block_ids"],
        },
    )
    assert conflict.status_code == 409
    assert api.get(path).json() == original
    assert {name: api.get(base + "/" + name).json() for name in before} == before


def test_move_requires_the_whole_ordered_snapshot_and_cancelled_drafts_are_immutable(api):
    base, _ = evolution_fixture(api)
    water = api.get(base + "/blocks").json()[0]["id"]
    book = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Livre",
            "pictogram_key": "book",
            "actor_role": "user",
        },
    ).json()["id"]
    api.post(
        base + f"/blocks/{book}/feedback",
        json={"action": "confirm", "actor_role": "user", "confirm_representation": True},
    ).raise_for_status()
    seq = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{seq['id']}"
    for block in [water, book, water]:
        api.post(
            path + "/selection", json={"action": "append", "block_id": block}
        ).raise_for_status()
    before = api.get(base + "/audit").json()
    # Same source at 2, another occurrence/order changed; matching just the source is unsafe.
    body = {
        "action": "move",
        "index": 2,
        "target_index": 0,
        "expected_block_ids": [book, water, water],
    }
    assert api.post(path + "/selection", json=body).status_code == 409
    assert api.get(base + "/audit").json() == before
    api.post(path + "/selection", json={"action": "cancel"}).raise_for_status()
    assert (
        api.post(
            path + "/selection",
            json={
                **body,
                "index": 1,
                "target_index": 0,
                "expected_block_ids": [water, book, water],
            },
        ).status_code
        == 409
    )
