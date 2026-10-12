from dataclasses import replace
from uuid import uuid4

import pytest

from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Interpretation,
    InterpretationStatus,
    SequenceStatus,
    utc_now,
)
from app.domain.pcl.gaps import GapPolicy
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.keyboard import KeyboardPosition, KeyboardZone, project_keyboard


def evidence():
    profile = uuid4()
    ids = (uuid4(), uuid4(), uuid4())
    sequences = tuple(
        CommunicationSequence(
            profile_id=profile,
            session_id=uuid4(),
            block_ids=ids,
            status=SequenceStatus.COMPLETED,
            created_at=utc_now(),
            completed_at=utc_now(),
        )
        for _ in range(6)
    )
    meanings = tuple(
        Interpretation(
            profile_id=profile,
            sequence_id=s.id,
            text="Partir",
            confidence=0.78,
            source="fake",
            status=InterpretationStatus.CONFIRMED if i < 5 else InterpretationStatus.PROPOSED,
        )
        for i, s in enumerate(sequences)
    )
    return profile, sequences, meanings


def test_gap_thresholds_corrections_rejections_and_existing_block_suppression():
    profile, sequences, meanings = evidence()
    assert len(GapPolicy().detect(profile, sequences, meanings, ())) == 1
    assert (
        GapPolicy(minimum_occurrences=7, minimum_validated=6).detect(
            profile, sequences, meanings, ()
        )
        == ()
    )
    rejected = (
        tuple(replace(i, status=InterpretationStatus.REJECTED) for i in meanings[:3]) + meanings[3:]
    )
    assert GapPolicy().detect(profile, sequences, rejected, ()) == ()
    corrected = (
        tuple(
            replace(i, status=InterpretationStatus.CORRECTED, corrected_text="Gêne")
            for i in meanings[:5]
        )
        + meanings[5:]
    )
    assert GapPolicy().detect(profile, sequences, corrected, ())[0].validated_intent == "Gêne"
    block = CommunicationBlock(
        profile_id=profile, label="Partir", canonical_intent="Partir", status="validated"
    )
    assert GapPolicy().detect(profile, sequences, meanings, (block,)) == ()
    reordered = (
        tuple(replace(s, block_ids=tuple(reversed(s.block_ids))) for s in sequences[:3])
        + sequences[3:]
    )
    assert GapPolicy().detect(profile, reordered, meanings, ()) == ()
    with pytest.raises(DomainInvariantError):
        GapPolicy().detect(uuid4(), sequences, meanings, ())
    with pytest.raises(DomainInvariantError):
        GapPolicy().detect(profile, (*sequences, sequences[0]), meanings, ())


def test_keyboard_stable_holes_and_positions_survive_adaptive_changes():
    profile = uuid4()
    stop = CommunicationBlock(
        profile_id=profile,
        label="STOP",
        canonical_intent="STOP",
        status="validated",
        stability="stable",
    )
    stable = KeyboardPosition(
        profile_id=profile, block_id=stop.id, zone=KeyboardZone.STABLE, position=4, locked=True
    )
    proposed = CommunicationBlock(
        profile_id=profile, label="Sortir", canonical_intent="SORTIR", origin="pcl_suggestion"
    )
    assert project_keyboard(profile, (stop, proposed), (stable,)) == (stable,)
    active = replace(proposed, status="validated")
    projected = project_keyboard(profile, (stop, active), (stable,))
    assert stable in projected
    assert next(p for p in projected if p.block_id == active.id).zone == KeyboardZone.ADAPTIVE
    with pytest.raises(DomainInvariantError):
        project_keyboard(uuid4(), (stop, active), (stable,))
    with pytest.raises(DomainInvariantError):
        project_keyboard(profile, (stop,), ())
    with pytest.raises(DomainInvariantError):
        replace(stable, locked=False)
