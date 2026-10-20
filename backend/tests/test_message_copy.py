from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.business import MessageCopyBody
from app.application.access import AccountView, permits
from app.domain.pcl.entities import CommunicationSequence
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.sequences import edit_sequence, editable_copy


def test_copy_preserves_order_and_repetitions_but_starts_an_independent_unaccepted_draft():
    a, b = uuid4(), uuid4()
    for ids in ((a,), (a, b, a), (a,) * 31 + (b,)):
        draft = CommunicationSequence(
            profile_id=uuid4(), session_id=uuid4(), context_id=uuid4(), block_ids=ids
        )
        source = edit_sequence(draft, "complete")
        request = uuid4()
        copied = editable_copy(source, request)
        assert copied.id == request and copied.profile_id == source.profile_id
        assert copied.session_id != source.session_id and copied.context_id is None
        assert copied.status == "in_progress" and copied.completed_at is None
        assert copied.block_ids == ids
        assert edit_sequence(copied, "remove", index=0).block_ids == ids[1:]
        assert source.block_ids == ids and source.status == "completed"
        with pytest.raises(DomainInvariantError):
            editable_copy(source, source.id)
        for invalid in (draft, edit_sequence(draft, "cancel")):
            with pytest.raises(DomainInvariantError):
                editable_copy(invalid, request)
        for invalid in (None, "not-a-uuid"):
            with pytest.raises(DomainInvariantError):
                editable_copy(source, invalid)


@pytest.mark.parametrize(
    "change",
    [
        {"request_id": None},
        {"request_id": "bad"},
        {"expected_block_ids": None},
        {"expected_block_ids": []},
        {"expected_block_ids": [str(uuid4())] * 33},
        {"expected_block_ids": ["bad"]},
        {"confirm": False},
        {"confirm": "true"},
        {"confirm": 1},
        {"confirm": None},
        {"action": "complete"},
        {"observation": {"interval_ms": 123}},
    ],
)
def test_copy_request_requires_explicit_confirmation_and_bounded_uuid_snapshot(change):
    body = {"request_id": str(uuid4()), "expected_block_ids": [str(uuid4())], "confirm": True}
    assert MessageCopyBody.model_validate(body).confirm is True
    with pytest.raises(ValidationError):
        MessageCopyBody.model_validate({**body, **change})


@pytest.mark.parametrize(
    "capability",
    [
        "communicate",
        "review_meanings",
        "prepare_keyboard",
        "manage_meanings",
        "view_history",
        "export_profile",
    ],
)
def test_copy_is_an_explicit_communication_write_and_recovery_read(capability):
    account = AccountView(uuid4(), "sample", "Fictif", False, True, {})
    assert permits(
        account,
        None,
        "POST",
        "/profiles/{profile_id}/sequences/{sequence_id}/copy",
        capabilities=(capability,),
    ) == (capability == "communicate")
    assert permits(
        account,
        None,
        "GET",
        "/profiles/{profile_id}/sequences/{sequence_id}/copies/{request_id}",
        capabilities=(capability,),
    ) == (capability in {"communicate", "review_meanings", "prepare_keyboard", "view_history"})
