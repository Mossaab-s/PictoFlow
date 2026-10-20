from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.business import SelectionBody
from app.domain.pcl.entities import CommunicationSequence
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.sequences import edit_sequence


def test_replace_changes_only_the_chosen_occurrence_and_works_at_both_size_limits():
    a, b, c = uuid4(), uuid4(), uuid4()
    original = CommunicationSequence(profile_id=uuid4(), session_id=uuid4(), block_ids=(a, b, a))
    assert edit_sequence(original, "replace", c, index=0).block_ids == (c, b, a)
    assert edit_sequence(original, "replace", b, index=2).block_ids == (a, b, b)
    assert original.block_ids == (a, b, a)
    for ids, index in (((a,), 0), ((a,) * 32, 31)):
        draft = CommunicationSequence(profile_id=uuid4(), session_id=uuid4(), block_ids=ids)
        changed = edit_sequence(draft, "replace", c, index=index)
        assert changed.block_ids == ids[:index] + (c,) + ids[index + 1 :]
        assert len(changed.block_ids) == len(ids)
    for index in (None, True, False, -1, 3, "1", 1.0):
        with pytest.raises(DomainInvariantError):
            edit_sequence(original, "replace", c, index=index)
    for block in (None, "not-a-uuid", a):
        with pytest.raises(DomainInvariantError):
            edit_sequence(original, "replace", block, index=0)
    for action in ("complete", "cancel"):
        with pytest.raises(DomainInvariantError):
            edit_sequence(edit_sequence(original, action), "replace", c, index=1)


@pytest.mark.parametrize(
    "change",
    [
        {"index": None},
        {"index": True},
        {"index": "0"},
        {"index": 0.0},
        {"index": -1},
        {"index": 2},
        {"block_id": None},
        {"block_id": "not-a-uuid"},
        {"expected_block_ids": None},
        {"expected_block_ids": []},
        {"expected_block_ids": [str(uuid4())] * 33},
        {"target_index": 1},
        {"observation": {"input_method": "keyboard"}},
        {"action": "remove"},
        {"action": "move"},
        {"action": "append"},
        {"action": "undo"},
        {"unknown": 1},
    ],
)
def test_replace_request_requires_a_new_identity_and_strict_bounded_snapshot(change):
    body = {
        "action": "replace",
        "block_id": str(uuid4()),
        "index": 1,
        "expected_block_ids": [str(uuid4()), str(uuid4())],
    }
    assert SelectionBody.model_validate(body).index == 1
    with pytest.raises(ValidationError):
        SelectionBody.model_validate({**body, **change})


def test_replace_rejects_same_identity_but_accepts_another_occurrence_identity():
    a, b = str(uuid4()), str(uuid4())
    body = {"action": "replace", "block_id": a, "index": 0, "expected_block_ids": [a, b]}
    with pytest.raises(ValidationError):
        SelectionBody.model_validate(body)
    assert str(SelectionBody.model_validate({**body, "index": 1}).block_id) == a
