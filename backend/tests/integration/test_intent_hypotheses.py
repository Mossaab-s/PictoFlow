import asyncio

import pytest

from app.ai.contracts import InterpretationProposal
from app.application.ai_context import context_for
from app.domain.pcl.entities import ValidationAction
from app.infrastructure.postgres.ai_quality import quality_summary
from tests.integration.test_ai_quality import interpreter
from tests.integration.test_communication import communication as communication
from tests.integration.test_communication import completed, event

pytestmark = pytest.mark.postgres


def test_distinct_request_and_statement_survive_duplicate_collapse_and_remain_human_choices(
    communication,
):
    service, profile, _, blocks = communication
    target = completed(service, profile, blocks)
    ai = interpreter(service)
    request = "Bruit, stop : je veux partir."
    # Stop is deliberately protected from modal grouping; exact duplication still groups.
    statement = "Bruit, stop : je pars."
    ai.provider.interpret.return_value = InterpretationProposal.model_validate(
        {
            "candidates": [
                {"intent": "request", "text": request, "confidence": 0.1},
                {"intent": "request", "text": request, "confidence": 0.9},
                {"intent": "request", "text": statement, "confidence": 0.8},
            ]
        }
    )
    before = service.memory(profile, validated=True)
    decision = asyncio.run(ai.interpret(profile, target.id))
    assert [c.text for c in decision.candidates] == [request, statement]
    assert [c.confidence for c in decision.candidates] == [0.9, 0.8]
    assert all(c.status == "proposed" and c.validated_text is None for c in decision.candidates)
    assert service.memory(profile, validated=True) == before
    summary = quality_summary(service.units, profile)
    assert summary.received_candidates == 3 and summary.retained_candidates == 2
    assert not context_for(service.units, profile, decision.candidates[1].id).personal_hypothesis
    service.validate(event(profile, decision.candidates[0], ValidationAction.REJECT))
    accepted = service.validate(event(profile, decision.candidates[1], ValidationAction.CONFIRM))
    assert [i.validated_text for i in service.memory(profile, validated=True).interpretations] == [
        accepted.text
    ]
