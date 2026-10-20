from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.business import GapIllustrationBody
from app.application.access import AccountView, permits
from app.domain.pcl.entities import CommunicationBlock, Concept, UserCommunicationProfile
from app.domain.pcl.gaps import GapPolicy, SemanticGapCandidate
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.state import PCLSnapshot
from tests.test_gaps_keyboard import evidence


@pytest.mark.parametrize(
    "change",
    [
        {"label": " "},
        {"label": "x" * 257},
        {"meaning": "Another meaning"},
        {"concept_id": str(uuid4())},
        {"pictogram_key": "unknown"},
        {"expected_intent": ""},
        {"expected_intent": "x" * 513},
        {"actor_role": "admin"},
        {"request_id": "bad"},
    ],
)
def test_illustrated_need_contract_rejects_implicit_or_unbounded_meaning_changes(change):
    body = dict(
        request_id=uuid4(),
        label="Boire",
        pictogram_key="water",
        expected_intent="Je voudrais boire de l’eau.",
        actor_role="user",
    )
    with pytest.raises(ValidationError):
        GapIllustrationBody.model_validate({**body, **change})


@pytest.mark.parametrize(
    "capability",
    [
        "communicate",
        "review_meanings",
        "manage_meanings",
        "view_history",
        "prepare_keyboard",
        "export_profile",
    ],
)
def test_illustrating_an_accepted_need_only_requires_keyboard_preparation(capability):
    account = AccountView(uuid4(), "sample", "Fictif", False, True, {})
    assert permits(
        account,
        None,
        "POST",
        "/profiles/{profile_id}/suggestions/{gap_id}/illustrated-block",
        capabilities=(capability,),
    ) == (capability == "prepare_keyboard")


def test_concept_backed_gap_touch_preserves_exact_personal_meaning_in_snapshot():
    profile = UserCommunicationProfile()
    gap = SemanticGapCandidate(
        profile_id=profile.id,
        source_sequence_signature="source",
        validated_intent="Je voudrais de l’eau.",
        occurrence_count=5,
        validated_count=4,
    )
    concept = Concept(profile_id=profile.id, canonical_key="PERSONAL", label=gap.validated_intent)
    block = CommunicationBlock(
        profile_id=profile.id,
        concept_id=concept.id,
        semantic_gap_id=gap.id,
        label="Eau",
        origin="pcl_suggestion",
    )
    snapshot = PCLSnapshot(profile=profile, gaps=(gap,), concepts=(concept,), blocks=(block,))
    assert snapshot.blocks[0].canonical_intent is None  # Keep the existing XOR contract.
    with pytest.raises(DomainInvariantError):
        replace(snapshot, concepts=(replace(concept, label="Another meaning"),))


def test_illustrated_gap_suppression_uses_the_meaning_and_only_validated_linked_touches():
    profile, sequences, meanings = evidence()
    concept = Concept(profile_id=profile, canonical_key="PERSONAL", label="Partir")
    block = CommunicationBlock(
        profile_id=profile,
        concept_id=concept.id,
        semantic_gap_id=uuid4(),
        label="Dehors",
        status="validated",
    )
    policy = GapPolicy()
    assert policy.detect(profile, sequences, meanings, (block,), (concept,)) == ()
    for other in (
        replace(block, status="proposed"),
        replace(block, status="rejected"),
        replace(block, semantic_gap_id=None),
    ):
        assert len(policy.detect(profile, sequences, meanings, (other,), (concept,))) == 1
    with pytest.raises(DomainInvariantError):
        policy.detect(
            profile, sequences, meanings, (block,), (replace(concept, profile_id=uuid4()),)
        )
