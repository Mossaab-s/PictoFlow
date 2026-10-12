"""Synthetic acceptance fixture that requires only Python, not infrastructure or AI."""

from uuid import uuid4

from app.domain.pcl.entities import (
    BlockOrigin,
    BlockStability,
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    Interpretation,
    ProposalStatus,
    RelationStatus,
    RelationType,
    SemanticRelation,
    SequenceStatus,
    TargetType,
    UserCommunicationProfile,
    ValidationAction,
    ValidationEvent,
    utc_now,
)
from app.domain.pcl.state import PCLSnapshot


def noise_scenario() -> PCLSnapshot:
    profile = UserCommunicationProfile()
    concepts = {
        key: Concept(profile_id=profile.id, canonical_key=key, label=key)
        for key in ("NOISE", "STOP", "LEAVE", "DISCOMFORT")
    }
    blocks = tuple(
        CommunicationBlock(
            profile_id=profile.id,
            concept_id=concepts[key].id,
            label=key,
            origin=BlockOrigin.USER,
            stability=BlockStability.STABLE,
            status=ProposalStatus.VALIDATED,
        )
        for key in ("NOISE", "STOP", "LEAVE")
    )
    relations = tuple(
        SemanticRelation(
            profile_id=profile.id,
            source_concept_id=concepts["NOISE"].id,
            target_concept_id=concepts[target].id,
            relation_type=RelationType.ASSOCIATED_WITH,
            confidence=confidence,
            validation_count=1,
            status=RelationStatus.VALIDATED,
        )
        for target, confidence in (("DISCOMFORT", 0.91), ("LEAVE", 0.84))
    )
    # Existing knowledge comes with explicit human history, not just a confidence score.
    events = tuple(
        ValidationEvent(
            profile_id=profile.id,
            target_type=target_type,
            target_id=obj.id,
            action=ValidationAction.CONFIRM,
        )
        for target_type, objects in (
            (TargetType.COMMUNICATION_BLOCK, blocks),
            (TargetType.SEMANTIC_RELATION, relations),
        )
        for obj in objects
    )
    sequence = CommunicationSequence(
        profile_id=profile.id,
        session_id=uuid4(),
        block_ids=tuple(block.id for block in blocks),
        status=SequenceStatus.COMPLETED,
        created_at=utc_now(),
        completed_at=utc_now(),
    )
    proposal = Interpretation(
        profile_id=profile.id,
        sequence_id=sequence.id,
        text="The noise bothers me and I want to leave.",
        confidence=0.78,
        source="pcl",
    )
    return PCLSnapshot(
        profile=profile,
        concepts=tuple(concepts.values()),
        blocks=blocks,
        relations=relations,
        sequences=(sequence,),
        validation_events=events,
    ).add_interpretation(proposal)
