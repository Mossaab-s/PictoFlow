from uuid import uuid4

import pytest

from app.domain.pcl.entities import (
    Concept,
    ProposalStatus,
    Representation,
    RepresentationType,
    UserCommunicationProfile,
)


@pytest.mark.parametrize("key,label", [("", "Bruit"), ("  ", "Bruit"), ("NOISE", " ")])
def test_concept_rejects_empty_semantics(key, label):
    with pytest.raises(ValueError):
        Concept(profile_id=uuid4(), canonical_key=key, label=label)


def test_concept_can_exist_without_representation():
    concept = Concept(profile_id=uuid4(), canonical_key="NOISE", label="Bruit")
    assert concept.id and concept.created_at.tzinfo is not None


def test_generated_representation_starts_as_proposal():
    representation = Representation(
        profile_id=uuid4(),
        concept_id=uuid4(),
        type=RepresentationType.GENERATED_VISUAL,
        source="fake",
    )
    assert representation.status is ProposalStatus.PROPOSED
    assert representation.commercial_use_allowed is None


def test_invalid_profile_version_is_rejected():
    with pytest.raises(ValueError):
        UserCommunicationProfile(version=0)


@pytest.mark.parametrize("name", ["", " \t\n", "a" * 81, 42])
def test_profile_name_rejects_empty_unbounded_or_nontext_values(name):
    with pytest.raises(ValueError):
        UserCommunicationProfile(display_name=name)


def test_profile_names_are_optional_normalized_metadata_not_identity():
    unnamed = UserCommunicationProfile()
    first = UserCommunicationProfile(display_name="  Élodie (démo)  ")
    second = UserCommunicationProfile(display_name="Élodie (démo)")
    assert unnamed.display_name is None
    assert first.display_name == second.display_name == "Élodie (démo)"
    assert first.id != second.id
