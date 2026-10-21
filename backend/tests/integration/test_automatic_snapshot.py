import json
from uuid import uuid4

import pytest

from app.domain.pcl.invariants import DomainInvariantError
from tests.integration.test_communication import communication as communication

pytestmark = pytest.mark.postgres


def test_automatic_snapshot_is_audited_without_human_validation(communication):
    service, profile, _, blocks = communication
    draft = service.start(profile, uuid4())
    service.select(profile, draft.id, "append", blocks[0].id)
    snapshot = service.select(profile, draft.id, "complete", automatic_preview=True)
    assert snapshot.status == "completed"
    assert snapshot.block_ids == (blocks[0].id,)
    assert service.memory(profile, validated=True).interpretations == ()
    with service.units() as store:
        events = store.audit_history(
            profile, target_type="communication_sequence", target_id=draft.id, limit=20
        )
    completion = next(event for event in events if event.event_type == "sequence_complete")
    assert completion.source == "application"
    assert json.loads(completion.new_state)["presentation"] == {
        "completion_reason": "automatic_phrase_preview"
    }


def test_automatic_marker_cannot_disguise_a_selection_as_human_feedback(communication):
    service, profile, _, blocks = communication
    draft = service.start(profile, uuid4())
    with pytest.raises(DomainInvariantError):
        service.select(profile, draft.id, "append", blocks[0].id, automatic_preview=True)
    assert service.memory(profile, validated=True).interpretations == ()
