from dataclasses import replace
from uuid import uuid4

import pytest

from app.domain.pcl.entities import CommunicationBlock
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.keyboard import KeyboardGroup, KeyboardPosition, project_keyboard


@pytest.mark.parametrize("label", ["", " ", " Personnes", "a" * 81, "ACCUEIL"])
def test_group_names_are_explicit_bounded_and_nonblank(label):
    with pytest.raises(DomainInvariantError):
        KeyboardGroup(profile_id=uuid4(), label=label)


def test_group_slots_can_overlap_but_stable_anchors_remain_global():
    profile = uuid4()
    blocks = tuple(
        CommunicationBlock(
            profile_id=profile, concept_id=uuid4(), label=word, origin="user", status="validated"
        )
        for word in ("Maman", "Boire")
    )
    first = KeyboardPosition(
        profile_id=profile,
        block_id=blocks[0].id,
        zone="personal",
        position=0,
        locked=False,
        group_id=uuid4(),
    )
    second = replace(first, id=uuid4(), block_id=blocks[1].id, group_id=uuid4())
    assert len(project_keyboard(profile, blocks, (first, second))) == 2
    with pytest.raises(DomainInvariantError, match="Duplicate keyboard position"):
        project_keyboard(profile, blocks, (first, replace(second, group_id=first.group_id)))
    with pytest.raises(DomainInvariantError, match="shared across"):
        replace(first, zone="stable", locked=True)
