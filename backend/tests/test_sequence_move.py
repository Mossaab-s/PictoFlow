from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.business import SelectionBody
from app.domain.pcl.entities import CommunicationSequence
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.sequences import edit_sequence


def test_move_uses_final_index_preserves_repetitions_and_is_reversible_in_both_directions():
    a, b, c = uuid4(), uuid4(), uuid4()
    original = CommunicationSequence(profile_id=uuid4(), session_id=uuid4(), block_ids=(a, b, c, a))
    for source, target, expected in (
        (0, 3, (b, c, a, a)),
        (3, 0, (a, a, b, c)),
        (1, 3, (a, c, a, b)),
        (2, 1, (a, c, b, a)),
    ):
        moved = edit_sequence(original, "move", index=source, target_index=target)
        assert moved.block_ids == expected
        assert edit_sequence(moved, "move", index=target, target_index=source) == original
    assert original.block_ids == (a, b, c, a)
    full = CommunicationSequence(profile_id=uuid4(), session_id=uuid4(), block_ids=(a,) * 31 + (b,))
    assert edit_sequence(full, "move", index=31, target_index=0).block_ids == (b,) + (a,) * 31
    for source, target in (
        (0, 0),
        (True, 1),
        (0, False),
        (-1, 1),
        (0, 4),
        (None, 0),
        (0, "1"),
        (0.0, 1),
    ):
        with pytest.raises(DomainInvariantError):
            edit_sequence(original, "move", index=source, target_index=target)
    repeated = CommunicationSequence(profile_id=uuid4(), session_id=uuid4(), block_ids=(a, a, b))
    with pytest.raises(DomainInvariantError):
        edit_sequence(repeated, "move", index=0, target_index=1)
    for status in ("complete", "cancel"):
        with pytest.raises(DomainInvariantError):
            edit_sequence(edit_sequence(original, status), "move", index=1, target_index=0)


@pytest.mark.parametrize(
    "change",
    [
        {"index": None},
        {"index": True},
        {"index": -1},
        {"index": 2},
        {"target_index": None},
        {"target_index": True},
        {"target_index": "1"},
        {"target_index": 1.0},
        {"target_index": -1},
        {"target_index": 2},
        {"target_index": 32},
        {"target_index": 0},
        {"expected_block_ids": None},
        {"expected_block_ids": []},
        {"expected_block_ids": [str(uuid4())] * 33},
        {"block_id": str(uuid4())},
        {"observation": {"input_method": "keyboard"}},
        {"action": "remove"},
        {"action": "undo"},
        {"action": "append"},
    ],
)
def test_move_body_requires_strict_bounded_indices_and_rejects_other_action_fields(change):
    body = {
        "action": "move",
        "index": 0,
        "target_index": 1,
        "expected_block_ids": [str(uuid4()), str(uuid4())],
    }
    assert SelectionBody.model_validate(body).target_index == 1
    with pytest.raises(ValidationError):
        SelectionBody.model_validate({**body, **change})


def test_move_body_rejects_indistinguishable_noop_occurrences():
    a = str(uuid4())
    with pytest.raises(ValidationError):
        SelectionBody.model_validate(
            {"action": "move", "index": 0, "target_index": 1, "expected_block_ids": [a, a]}
        )
