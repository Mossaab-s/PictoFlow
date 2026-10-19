from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.business import SelectionBody
from app.domain.pcl.entities import CommunicationSequence, SequenceStatus
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.sequences import edit_sequence


def test_removal_keeps_order_and_other_occurrences_and_can_leave_an_empty_draft():
    a, b = uuid4(), uuid4()
    original = CommunicationSequence(profile_id=uuid4(), session_id=uuid4(), block_ids=(a, b, a))
    assert edit_sequence(original, "remove", index=0).block_ids == (b, a)
    assert edit_sequence(original, "remove", index=1).block_ids == (a, a)
    assert edit_sequence(original, "remove", index=2).block_ids == (a, b)
    last = replace(original, block_ids=(a,))
    empty = edit_sequence(last, "remove", index=0)
    assert empty.block_ids == () and empty.status == SequenceStatus.IN_PROGRESS
    assert original.block_ids == (a, b, a)
    for index in (None, True, -1, 3, 0.0, "0"):
        with pytest.raises(DomainInvariantError):
            edit_sequence(original, "remove", index=index)
    with pytest.raises(DomainInvariantError):
        edit_sequence(empty, "remove", index=0)
    for status in ("complete", "cancel"):
        with pytest.raises(DomainInvariantError):
            edit_sequence(edit_sequence(original, status), "remove", index=1)


@pytest.mark.parametrize(
    "change",
    [
        {"index": None},
        {"index": True},
        {"index": "0"},
        {"index": 0.0},
        {"index": -1},
        {"index": 32},
        {"index": 1},
        {"expected_block_ids": None},
        {"expected_block_ids": []},
        {"expected_block_ids": [str(uuid4())] * 33},
        {"expected_block_ids": ["invalid"]},
        {"block_id": str(uuid4())},
        {"observation": {"input_method": "pointer"}},
        {"action": "append"},
        {"action": "undo"},
    ],
)
def test_removal_request_requires_a_bounded_exact_draft_and_strict_existing_index(change):
    body = {"action": "remove", "index": 0, "expected_block_ids": [str(uuid4())]}
    assert SelectionBody.model_validate(body).index == 0
    with pytest.raises(ValidationError):
        SelectionBody.model_validate({**body, **change})
