import pytest
from pydantic import ValidationError

from app.application.selection_rhythm import SelectionObservation


@pytest.mark.parametrize(
    "values",
    [
        {"interval_ms": -1},
        {"interval_ms": True},
        {"interval_ms": 86400001},
        {"interval_ms": 100, "blocked_ms": 101},
        {"blocked_ms": 1},
        {"input_method": "angry"},
        {"emotion": "angry"},
    ],
)
def test_observation_rejects_invalid_durations_and_inferred_emotions(values):
    with pytest.raises(ValidationError):
        SelectionObservation.model_validate({"input_method": "pointer", **values})
