from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timedelta
from uuid import uuid4

import pytest

from app.domain.pcl.entities import (
    BlockOrigin,
    BlockStability,
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    HumanRole,
    Interpretation,
    InterpretationStatus,
    ProposalStatus,
    RelationStatus,
    RelationType,
    Representation,
    RepresentationType,
    SemanticRelation,
    SequenceStatus,
    TargetType,
    UserCommunicationProfile,
    ValidationAction,
    ValidationEvent,
)
from app.domain.pcl.examples import noise_scenario
from app.domain.pcl.invariants import DomainInvariantError


def feedback(state, action, **values):
    return ValidationEvent(
        profile_id=state.profile.id,
        target_type=TargetType.INTERPRETATION,
        target_id=state.interpretations[0].id,
        action=action,
        **values,
    )


def test_acceptance_scenario_remains_a_proposal_without_external_ai():
    state = noise_scenario()
    assert [block.label for block in state.blocks] == ["NOISE", "STOP", "LEAVE"]
    assert state.sequences[0].block_ids == tuple(block.id for block in state.blocks)
    assert [(item.confidence, item.status) for item in state.relations] == [
        (0.91, RelationStatus.VALIDATED),
        (0.84, RelationStatus.VALIDATED),
    ]
    proposal = state.interpretations[0]
    assert proposal.text == "The noise bothers me and I want to leave."
    assert proposal.status is InterpretationStatus.PROPOSED
    assert proposal.validated_text is None


def test_confirmation_requires_event_and_preserves_original_snapshot():
    before = noise_scenario()
    event = feedback(before, ValidationAction.CONFIRM)
    after = before.record_interpretation_feedback(event)
    assert after.interpretations[0].status is InterpretationStatus.CONFIRMED
    assert after.interpretations[0].validated_text == before.interpretations[0].text
    assert after.validation_events == (*before.validation_events, event)
    assert before.interpretations[0].status is InterpretationStatus.PROPOSED
    assert after.relations == before.relations and after.blocks == before.blocks


def test_human_correction_overrides_confidence_and_later_confirmation():
    before = noise_scenario()
    proposal = replace(before.interpretations[0], confidence=1.0, source="provider:removed-later")
    before = replace(before, interpretations=(proposal,))
    correction = feedback(
        before,
        ValidationAction.CORRECT,
        corrected_value="Le bruit me gêne.",
        actor_role=HumanRole.CAREGIVER,
    )
    corrected = before.record_interpretation_feedback(correction)
    confirmed = corrected.record_interpretation_feedback(
        feedback(corrected, ValidationAction.CONFIRM)
    )
    result = confirmed.interpretations[0]
    assert result.status is InterpretationStatus.CORRECTED
    assert result.validated_text == "Le bruit me gêne."
    assert result.text == proposal.text
    assert result.source == "provider:removed-later"
    assert confirmed.validation_events[-2:] == (correction, confirmed.validation_events[-1])
    assert before.interpretations[0].corrected_text is None


def test_rejection_creates_no_validated_meaning_and_reconfirmation_requires_new_event():
    before = noise_scenario()
    rejected = before.record_interpretation_feedback(feedback(before, ValidationAction.REJECT))
    assert rejected.interpretations[0].validated_text is None
    assert rejected.interpretations[0].status is InterpretationStatus.REJECTED
    assert rejected.relations == before.relations
    confirmed = rejected.record_interpretation_feedback(
        feedback(rejected, ValidationAction.CONFIRM)
    )
    assert confirmed.interpretations[0].status is InterpretationStatus.CONFIRMED
    assert confirmed.validation_events[-2].action is ValidationAction.REJECT
    assert confirmed.validation_events[-1].action is ValidationAction.CONFIRM


def test_refusal_is_final_and_adds_no_semantic_knowledge():
    before = replace(noise_scenario(), interpretations=())
    refusal = Interpretation(
        profile_id=before.profile.id,
        sequence_id=before.sequences[0].id,
        text="",
        confidence=0.28,
        source="pcl",
        status=InterpretationStatus.NOT_UNDERSTOOD,
    )
    after = before.add_interpretation(refusal)
    assert after.interpretations[0].validated_text is None
    assert (
        after.relations == before.relations and after.validation_events == before.validation_events
    )
    for action in ValidationAction:
        values = {"corrected_value": "Partir"} if action == ValidationAction.CORRECT else {}
        with pytest.raises(DomainInvariantError, match="refusal"):
            after.record_interpretation_feedback(feedback(after, action, **values))


@pytest.mark.parametrize(
    "collection",
    [
        "concepts",
        "blocks",
        "relations",
        "sequences",
        "interpretations",
        "validation_events",
    ],
)
def test_snapshot_rejects_objects_belonging_to_another_profile(collection):
    state = noise_scenario()
    values = list(getattr(state, collection))
    values[0] = replace(values[0], profile_id=uuid4())
    with pytest.raises(DomainInvariantError, match="profile"):
        replace(state, **{collection: values})


def test_representation_is_scoped_and_cannot_reference_another_profiles_concept():
    state = noise_scenario()
    other = Concept(profile_id=uuid4(), canonical_key="NOISE", label="Other")
    representation = Representation(
        profile_id=state.profile.id,
        concept_id=other.id,
        type=RepresentationType.TEXT,
        source="user",
        label="Bruit",
    )
    with pytest.raises(DomainInvariantError, match="reference"):
        replace(state, representations=(representation,))
    with pytest.raises(DomainInvariantError, match="profile"):
        replace(state, representations=(replace(representation, profile_id=other.profile_id),))


def test_relation_cannot_target_a_foreign_concept_even_with_local_profile_id():
    state = noise_scenario()
    foreign = replace(state.relations[0], target_concept_id=uuid4())
    with pytest.raises(DomainInvariantError, match="reference"):
        replace(state, relations=(foreign, *state.relations[1:]))


@pytest.mark.parametrize("change", ["profile", "target", "target_type", "actor"])
def test_human_feedback_cannot_be_applied_to_foreign_or_automated_targets(change):
    state = noise_scenario()
    event = feedback(state, ValidationAction.CONFIRM)
    with pytest.raises(DomainInvariantError):
        if change == "actor":
            replace(event, actor_role="external_provider")
        else:
            changes = {
                "profile": {"profile_id": uuid4()},
                "target": {"target_id": uuid4()},
                "target_type": {"target_type": TargetType.CONCEPT},
            }[change]
            state.record_interpretation_feedback(replace(event, **changes))


def test_provider_cannot_insert_confirmed_interpretation_without_human_event():
    before = replace(noise_scenario(), interpretations=())
    forged = Interpretation(
        profile_id=before.profile.id,
        sequence_id=before.sequences[0].id,
        text="Model certainty",
        confidence=1.0,
        source="provider:fake",
        status=InterpretationStatus.CONFIRMED,
    )
    with pytest.raises(DomainInvariantError, match="unvalidated"):
        before.add_interpretation(forged)
    with pytest.raises(DomainInvariantError, match="human feedback"):
        replace(before, interpretations=(forged,))


def test_high_confidence_relation_does_not_become_validated():
    state = noise_scenario()
    relation = SemanticRelation(
        profile_id=state.profile.id,
        source_concept_id=state.concepts[0].id,
        target_concept_id=state.concepts[1].id,
        relation_type=RelationType.ASSOCIATED_WITH,
        confidence=1.0,
    )
    assert relation.status is RelationStatus.PROPOSED and relation.validation_count == 0
    with pytest.raises(DomainInvariantError):
        replace(relation, status=RelationStatus.VALIDATED)
    with pytest.raises(DomainInvariantError, match="human feedback"):
        replace(
            state,
            relations=(
                *state.relations,
                replace(relation, status=RelationStatus.VALIDATED, validation_count=1),
            ),
        )


def test_missing_validation_evidence_cannot_restore_validated_state():
    state = noise_scenario()
    with pytest.raises(DomainInvariantError, match="human feedback"):
        replace(state, validation_events=())


def test_correction_history_cannot_be_replaced_by_model_proposal():
    state = noise_scenario()
    corrected = state.record_interpretation_feedback(
        feedback(state, ValidationAction.CORRECT, corrected_value="Correct meaning")
    )
    forged = replace(
        corrected.interpretations[0], status=InterpretationStatus.CONFIRMED, corrected_text=None
    )
    with pytest.raises(DomainInvariantError, match="correction"):
        replace(corrected, interpretations=(forged,))


def test_sequence_order_and_duplicate_selections_are_immutable():
    state = noise_scenario()
    selections = [state.blocks[0].id, state.blocks[1].id, state.blocks[0].id]
    sequence = CommunicationSequence(
        profile_id=state.profile.id, session_id=uuid4(), block_ids=selections
    )
    selections.clear()
    assert sequence.block_ids == (state.blocks[0].id, state.blocks[1].id, state.blocks[0].id)
    reversed_sequence = replace(sequence, block_ids=tuple(reversed(state.sequences[0].block_ids)))
    assert reversed_sequence.block_ids != state.sequences[0].block_ids


def test_incomplete_sequence_cannot_be_promoted_to_validated_communication():
    state = noise_scenario()
    sequence = replace(state.sequences[0], status=SequenceStatus.IN_PROGRESS, completed_at=None)
    state = replace(state, sequences=(sequence,))
    with pytest.raises(DomainInvariantError, match="completed"):
        state.record_interpretation_feedback(feedback(state, ValidationAction.CONFIRM))


def test_concept_and_visual_identity_are_separate():
    state = noise_scenario()
    concept = state.concepts[0]
    image = Representation(
        profile_id=state.profile.id,
        concept_id=concept.id,
        type=RepresentationType.PHOTO,
        source="user",
        asset_reference="photo-1",
    )
    with_image = replace(state, representations=(image,))
    changed_image = replace(
        with_image, representations=(replace(image, asset_reference="photo-2"),)
    )
    without_image = replace(changed_image, representations=())
    assert without_image.concepts == state.concepts and without_image.relations == state.relations
    assert changed_image.concepts[0].id == concept.id


def test_representation_cannot_change_a_blocks_concept_identity():
    state = noise_scenario()
    representation = Representation(
        profile_id=state.profile.id,
        concept_id=state.concepts[1].id,
        type=RepresentationType.TEXT,
        source="user",
        label="Stop",
    )
    block = replace(state.blocks[0], representation_id=representation.id)
    with pytest.raises(DomainInvariantError, match="concept identity"):
        replace(state, blocks=(block, *state.blocks[1:]), representations=(representation,))


def test_pcl_created_candidate_starts_in_adaptive_space():
    block = CommunicationBlock(
        profile_id=uuid4(),
        canonical_intent="LEAVE_DUE_TO_NOISE",
        label="Partir",
        origin=BlockOrigin.PCL_SUGGESTION,
    )
    assert block.status is ProposalStatus.PROPOSED and block.stability is BlockStability.ADAPTIVE
    with pytest.raises(DomainInvariantError, match="adaptive"):
        replace(block, stability=BlockStability.STABLE)


@pytest.mark.parametrize("value", [-0.1, 1.1, float("nan"), float("inf"), True, "0.8", 10**1000])
def test_domain_confidence_rejects_invalid_or_ambiguous_values(value):
    state = noise_scenario()
    with pytest.raises(DomainInvariantError):
        replace(state.interpretations[0], confidence=value)
    with pytest.raises(DomainInvariantError):
        replace(state.relations[0], confidence=value)


@pytest.mark.parametrize(
    "field,value",
    [
        ("profile_id", None),
        ("id", "not-a-uuid"),
        ("created_at", datetime(2026, 1, 1)),
        ("label", " "),
        ("status", "clinical_diagnosis"),
    ],
)
def test_structural_invariants_are_checked_in_plain_python(field, value):
    with pytest.raises(DomainInvariantError):
        replace(noise_scenario().concepts[0], **{field: value})


def test_validation_history_rejects_duplicate_ids_and_backdated_events():
    state = noise_scenario()
    event = feedback(state, ValidationAction.CONFIRM)
    confirmed = state.record_interpretation_feedback(event)
    with pytest.raises(DomainInvariantError, match="Duplicate"):
        confirmed.record_interpretation_feedback(event)
    with pytest.raises(DomainInvariantError, match="precede|chronological"):
        confirmed.record_interpretation_feedback(
            replace(
                event,
                id=uuid4(),
                created_at=state.interpretations[0].created_at - timedelta(seconds=1),
            )
        )


def test_domain_has_no_structured_clinical_or_provider_dependency_fields():
    with pytest.raises(TypeError):
        UserCommunicationProfile(diagnosis="inferred")
    with pytest.raises(TypeError):
        Concept(profile_id=uuid4(), canonical_key="NOISE", label="Bruit", inferred_emotion="fear")
    state = noise_scenario()
    with pytest.raises(FrozenInstanceError):
        state.profile.version = 2
    assert not hasattr(state, "provider") and not hasattr(state, "database")


def test_removing_provider_does_not_invalidate_personal_state():
    state = noise_scenario()
    proposal = replace(state.interpretations[0], source="provider:no-longer-installed")
    state = replace(state, interpretations=(proposal,))
    state = state.record_interpretation_feedback(feedback(state, ValidationAction.CONFIRM))
    # Reconstruct the domain with no provider registry, configuration or integration modules.
    restored = replace(state)
    assert restored.interpretations[0].validated_text == proposal.text
    assert (
        restored.relations == state.relations
        and restored.validation_events == state.validation_events
    )
