import json
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from app.application.ai_context import context_for
from app.application.ai_quality import FALLBACK_REASONS


@pytest.mark.parametrize("reason", [*FALLBACK_REASONS, None, "private failure", [], {}])
@pytest.mark.parametrize("source", ["pcl", "openai-compatible"])
def test_only_known_recorded_literal_reasons_are_exposed(reason, source):
    profile, candidate = uuid4(), uuid4()
    store = Mock()
    store.get.return_value = SimpleNamespace(source=source)
    store.audit_history.return_value = [
        SimpleNamespace(
            event_type="interpretation_multiple_hypotheses",
            new_state=json.dumps({"presentation": {"fallback_reason": reason}}),
        )
    ]

    @contextmanager
    def units():
        yield store

    value = context_for(units, profile, candidate)
    assert value.fallback_reason == (
        reason if source == "pcl" and reason in FALLBACK_REASONS else None
    )
    assert value.references == () and value.personal_hypothesis is False
    assert store.get.call_args.args[0] == profile
    assert store.audit_history.call_args.args[0] == profile
    store.audit.assert_not_called()


def test_legacy_literal_without_a_recorded_origin_has_no_invented_reason():
    store = Mock()
    store.get.return_value = SimpleNamespace(source="pcl")
    store.audit_history.return_value = []

    @contextmanager
    def units():
        yield store

    assert context_for(units, uuid4(), uuid4()).fallback_reason is None
