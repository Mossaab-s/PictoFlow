from dataclasses import replace
from uuid import uuid4

import pytest

from app.domain.pcl.confidence import ConfidencePolicy, HandlingState
from app.domain.pcl.entities import CommunicationSequence, Interpretation, SequenceStatus
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.sequences import edit_sequence


@pytest.mark.parametrize(
    "score,state",
    [
        (0.0, HandlingState.NOT_UNDERSTOOD),
        (0.3999, HandlingState.NOT_UNDERSTOOD),
        (0.40, HandlingState.MULTIPLE_HYPOTHESES),
        (0.6499, HandlingState.MULTIPLE_HYPOTHESES),
        (0.65, HandlingState.CONFIRMATION_REQUIRED),
        (0.8999, HandlingState.CONFIRMATION_REQUIRED),
        (0.90, HandlingState.PROPOSAL),
        (1.0, HandlingState.PROPOSAL),
    ],
)
def test_every_confidence_boundary_remains_unvalidated(score, state):
    item = Interpretation(
        profile_id=uuid4(),
        sequence_id=uuid4(),
        text="Sens proposé",
        confidence=score,
        source="fake",
    )
    decision = ConfidencePolicy().decide((item,))
    assert decision.state == state
    assert item.validated_text is None
    assert bool(decision.candidates) == (score >= 0.4)


def test_hypotheses_are_bounded_ranked_and_custom_thresholds_apply():
    profile, sequence = uuid4(), uuid4()
    items = tuple(
        Interpretation(
            profile_id=profile, sequence_id=sequence, text=str(i), confidence=score, source="pcl"
        )
        for i, score in enumerate((0.44, 0.58, 0.52, 0.48, 0.28))
    )
    result = ConfidencePolicy().decide(items)
    assert [i.confidence for i in result.candidates] == [0.58, 0.52, 0.48]
    assert (
        ConfidencePolicy(refusal=0.6, confirmation=0.7, direct=0.95).decide(items).candidates == ()
    )
    with pytest.raises(DomainInvariantError):
        ConfidencePolicy(refusal=0.7, confirmation=0.65)
    with pytest.raises(DomainInvariantError):
        ConfidencePolicy().decide((items[0], replace(items[1], profile_id=uuid4())))


@pytest.mark.parametrize("best_score", [0.7, 1.0])
def test_high_confidence_does_not_hide_other_eligible_hypotheses(best_score):
    profile, sequence = uuid4(), uuid4()
    items = tuple(
        Interpretation(
            profile_id=profile, sequence_id=sequence, text=str(i), confidence=score, source="fake"
        )
        for i, score in enumerate((best_score, 0.6, 0.4, 0.39))
    )
    assert ConfidencePolicy().decide(items).candidates == items[:3]


def test_preferred_hypothesis_survives_the_limit_without_changing_scores_or_validation():
    profile, sequence = uuid4(), uuid4()
    items = tuple(
        Interpretation(
            profile_id=profile, sequence_id=sequence, text=str(i), confidence=score, source="fake"
        )
        for i, score in enumerate((0.99, 0.95, 0.9, 0.65))
    )
    decision = ConfidencePolicy().decide(items, preferred_ids=frozenset({items[-1].id}))
    assert decision.candidates == (items[-1], items[0], items[1])
    assert decision.state == HandlingState.CONFIRMATION_REQUIRED
    assert [item.confidence for item in decision.candidates] == [0.65, 0.99, 0.95]
    assert all(item.validated_text is None for item in decision.candidates)


@pytest.mark.parametrize("score", [0.0, 0.3999, 0.4, 0.6499])
def test_priority_preserves_refusal_and_confirmation_thresholds(score):
    generic = Interpretation(
        profile_id=uuid4(), sequence_id=uuid4(), text="Generic", confidence=0.99, source="fake"
    )
    personal = replace(generic, id=uuid4(), text="Personal", confidence=score)
    decision = ConfidencePolicy().decide(
        (generic, personal), preferred_ids=frozenset({personal.id})
    )
    if score < 0.4:
        assert decision.candidates == (generic,)
        assert decision.state == HandlingState.PROPOSAL
        assert (
            ConfidencePolicy().decide((personal,), preferred_ids=frozenset({personal.id})).state
            == HandlingState.NOT_UNDERSTOOD
        )
    else:
        assert decision.candidates == (personal, generic)
        assert decision.state == HandlingState.MULTIPLE_HYPOTHESES


def test_priority_preserves_confidence_order_within_each_group_and_ignores_missing_ids():
    profile, sequence = uuid4(), uuid4()
    items = tuple(
        Interpretation(
            profile_id=profile, sequence_id=sequence, text=str(i), confidence=score, source="fake"
        )
        for i, score in enumerate((0.9, 0.6, 0.65))
    )
    decision = ConfidencePolicy().decide(
        items, preferred_ids=frozenset({items[1].id, items[2].id, uuid4()})
    )
    assert decision.candidates == (items[2], items[1], items[0])
    assert ConfidencePolicy().decide(items, preferred_ids=frozenset({uuid4()})) == (
        ConfidencePolicy().decide(items)
    )


def test_order_repetition_undo_clear_completion_and_terminal_state():
    sequence = CommunicationSequence(profile_id=uuid4(), session_id=uuid4())
    a, b = uuid4(), uuid4()
    for block in (a, b, a):
        sequence = edit_sequence(sequence, "append", block)
    assert sequence.block_ids == (a, b, a)
    assert edit_sequence(sequence, "undo").block_ids == (a, b)
    assert edit_sequence(sequence, "clear").block_ids == ()
    completed = edit_sequence(sequence, "complete")
    assert completed.status == SequenceStatus.COMPLETED
    assert completed.block_ids == sequence.block_ids
    for action in ("append", "undo", "clear", "complete", "cancel"):
        with pytest.raises(DomainInvariantError):
            edit_sequence(completed, action, a)
    with pytest.raises(DomainInvariantError):
        edit_sequence(replace(sequence, block_ids=()), "complete")
