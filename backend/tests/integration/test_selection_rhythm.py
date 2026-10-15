import json
from uuid import uuid4

import pytest

from app.application.selection_rhythm import SelectionObservation, rhythm_report
from app.application.semantic_space import SemanticNotFoundError
from tests.integration.test_ai_quality import interpreter
from tests.integration.test_communication import communication as communication

pytestmark = pytest.mark.postgres


def test_observation_is_atomic_scoped_optional_and_never_sent_to_ai(communication):
    service, profile, foreign, blocks = communication
    sequence = service.start(profile, uuid4())
    service.select(profile, sequence.id, "append", blocks[0].id)
    assert rhythm_report(service.units, profile, sequence.id).intervals == ()
    service.select(
        profile, sequence.id, "append", blocks[1].id, SelectionObservation(input_method="pointer")
    )
    service.select(
        profile,
        sequence.id,
        "append",
        blocks[2].id,
        SelectionObservation(interval_ms=1600, blocked_ms=400, input_method="pointer"),
    )
    report = rhythm_report(service.units, profile, sequence.id)
    assert report.intervals[0].available_ms == 1200
    assert report.median_available_ms == 1200
    with pytest.raises(SemanticNotFoundError):
        rhythm_report(service.units, foreign, sequence.id)
    service.select(profile, sequence.id, "complete")
    request = interpreter(service).request(profile, sequence.id)
    assert "interval_ms" not in request.model_dump_json()
    assert "rhythm" not in request.model_dump_json()
    with service.units() as store:
        history = store.audit_history(
            profile, target_type="communication_sequence", target_id=sequence.id, limit=100
        )
    observed = [json.loads(e.new_state).get("presentation", {}) for e in history]
    assert sum("selection_observation" in e for e in observed) == 2


def test_failed_selection_records_no_observation_and_read_does_not_write(communication):
    service, profile, _, blocks = communication
    sequence = service.start(profile, uuid4())
    with pytest.raises(SemanticNotFoundError):
        service.select(
            profile,
            sequence.id,
            "append",
            uuid4(),
            SelectionObservation(interval_ms=100, input_method="keyboard"),
        )
    with service.units() as store:
        before = store.audit_history(
            profile, target_type="communication_sequence", target_id=sequence.id, limit=100
        )
    assert rhythm_report(service.units, profile, sequence.id).intervals == ()
    with service.units() as store:
        assert (
            store.audit_history(
                profile, target_type="communication_sequence", target_id=sequence.id, limit=100
            )
            == before
        )
