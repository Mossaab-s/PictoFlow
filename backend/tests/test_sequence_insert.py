from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.business import SelectionBody
from app.domain.pcl.entities import CommunicationSequence
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.sequences import edit_sequence


def test_insert_preserves_every_existing_occurrence_at_all_gaps_including_same_identity():
    a, b = uuid4(), uuid4()
    seq = CommunicationSequence(profile_id=uuid4(), session_id=uuid4(), block_ids=(a, b, a))
    for gap in range(4):
        current = edit_sequence(seq, "insert", a, index=gap)
        assert current.block_ids[gap] == a
        assert current.block_ids[:gap] + current.block_ids[gap + 1 :] == seq.block_ids
    assert seq.block_ids == (a, b, a)
    for ids, gap in (((a,), 1), ((a,) * 31, 31)):
        draft = CommunicationSequence(profile_id=uuid4(), session_id=uuid4(), block_ids=ids)
        assert edit_sequence(draft, "insert", b, index=gap).block_ids == ids + (b,)
    for ids in ((), (a,) * 32):
        draft = CommunicationSequence(profile_id=uuid4(), session_id=uuid4(), block_ids=ids)
        with pytest.raises(DomainInvariantError):
            edit_sequence(draft, "insert", b, index=0)
    for gap in (None, True, False, -1, 4, "1", 1.0):
        with pytest.raises(DomainInvariantError):
            edit_sequence(seq, "insert", b, index=gap)
    for block in (None, "not-a-uuid"):
        with pytest.raises(DomainInvariantError):
            edit_sequence(seq, "insert", block, index=0)
    for action in ("complete", "cancel"):
        with pytest.raises(DomainInvariantError):
            edit_sequence(edit_sequence(seq, action), "insert", b, index=1)


@pytest.mark.parametrize(
    "change",
    [
        {"index": None},
        {"index": True},
        {"index": "0"},
        {"index": 0.0},
        {"index": -1},
        {"index": 3},
        {"block_id": None},
        {"block_id": "not-a-uuid"},
        {"expected_block_ids": None},
        {"expected_block_ids": []},
        {"expected_block_ids": [str(uuid4())] * 32},
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
def test_insert_request_requires_a_bounded_snapshot_and_a_strict_gap(change):
    a = str(uuid4())
    body = {"action": "insert", "block_id": a, "index": 2, "expected_block_ids": [a, a]}
    assert SelectionBody.model_validate(body).index == 2
    with pytest.raises(ValidationError):
        SelectionBody.model_validate({**body, **change})
