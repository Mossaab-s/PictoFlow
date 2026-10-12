import asyncio
from uuid import uuid4

import pytest

from app.application.audit import AuditService
from app.application.blocks import BlockService, RepresentationService
from app.application.semantic_space import SemanticNotFoundError, SemanticSpace
from app.application.validation import RelationCorrectionService
from app.domain.pcl.entities import (
    CommunicationBlock,
    Concept,
    RelationType,
    Representation,
    RepresentationType,
    SemanticRelation,
    TargetType,
    ValidationAction,
)
from app.domain.pcl.gaps import SemanticGapCandidate
from app.domain.pcl.invariants import DomainInvariantError
from app.domain.pcl.keyboard import KeyboardPosition, KeyboardZone
from app.infrastructure.postgres.semantic_space import PostgresSemanticUnits
from tests.integration.test_communication import (
    communication as communication,
)
from tests.integration.test_communication import (
    completed,
    event,
    proposal,
)

pytestmark = pytest.mark.postgres


def test_every_persistent_communication_type_enforces_profile_scope(communication):
    service, a, b, blocks = communication
    sequence = completed(service, a, blocks)
    item, _ = proposal(service, a, sequence)
    with service.units() as store:
        extras = (
            Representation(
                profile_id=a,
                concept_id=blocks[0].concept_id,
                type=RepresentationType.TEXT,
                source="user",
                label="Bruit",
            ),
            SemanticRelation(
                profile_id=a,
                source_concept_id=blocks[0].concept_id,
                target_concept_id=blocks[2].concept_id,
                relation_type=RelationType.ASSOCIATED_WITH,
                confidence=0.5,
            ),
            SemanticGapCandidate(
                profile_id=a,
                source_sequence_signature="test-signature",
                validated_intent="Test meaning",
                occurrence_count=5,
                validated_count=4,
            ),
            KeyboardPosition(
                profile_id=a,
                block_id=blocks[0].id,
                zone=KeyboardZone.PERSONAL,
                position=0,
                locked=False,
            ),
        )
        for value in extras:
            store.add(a, value)
        concept = store.get(a, Concept, blocks[0].concept_id)
    values = (concept, blocks[0], sequence, item, *extras)
    for value in values:
        with service.units() as store:
            assert store.list(b, type(value)) == ()
        with pytest.raises(SemanticNotFoundError), service.units() as store:
            store.get(b, type(value), value.id)
        for mutation in ("add", "save"):
            with pytest.raises(ValueError), service.units() as store:
                getattr(store, mutation)(b, value)
    with service.units() as store:
        assert store.feedback_history(b, blocks[0].id) == ()
    assert (
        AuditService(service.units).history(
            b, target_type=TargetType.INTERPRETATION, target_id=item.id
        )
        == ()
    )
    with pytest.raises(SemanticNotFoundError):
        BlockService(service.units).place(
            b, blocks[0].id, KeyboardZone.STABLE, 0, actor_role="user"
        )


def test_relation_correction_preserves_old_meaning_and_requires_human_scope(communication):
    service, a, b, blocks = communication
    semantic = SemanticSpace(PostgresSemanticUnits(service.units.factory))
    old = semantic.create_relation(
        a, blocks[0].concept_id, blocks[1].concept_id, RelationType.ASSOCIATED_WITH, 0.9
    )
    correction = RelationCorrectionService(service.units)
    args = dict(
        source_id=blocks[0].concept_id,
        target_id=blocks[2].concept_id,
        relation_type=RelationType.ASSOCIATED_WITH,
        confidence=0.84,
        actor_role="user",
    )
    with pytest.raises(SemanticNotFoundError):
        correction.correct(b, old.id, **args)
    with pytest.raises(DomainInvariantError):
        correction.correct(a, old.id, **{**args, "actor_role": "provider"})
    replacement = correction.correct(a, old.id, **args)
    assert replacement.id != old.id and replacement.status == "validated"
    with service.units() as store:
        rejected = store.get(a, SemanticRelation, old.id)
        assert rejected.target_concept_id == old.target_concept_id
        assert rejected.status == "rejected" and rejected.rejection_count == 1
        assert [e.action for e in store.feedback_history(a, old.id)] == ["correct", "reject"]
    assert semantic.get_validated_relations(a, blocks[0].concept_id) == (replacement,)


def test_gap_approval_rechecks_evidence_after_human_rejections(communication):
    service, a, _, blocks = communication
    candidates = []
    for _ in range(5):
        item, _ = proposal(service, a, completed(service, a, blocks))
        service.validate(event(a, item, ValidationAction.CONFIRM))
        candidates.append(item)
    block_service = BlockService(service.units)
    gap = block_service.detect_gaps(a)[0]
    for item in candidates[:3]:
        service.validate(event(a, item, ValidationAction.REJECT))
    assert block_service.detect_gaps(a) == ()
    with pytest.raises(DomainInvariantError):
        block_service.decide_gap(a, gap.id, approve=True, actor_role="user")
    with service.units() as store:
        assert store.get(a, SemanticGapCandidate, gap.id).status == "proposed"
    assert service.memory(a, validated=True).interpretations != ()


def test_incomplete_and_foreign_ai_requests_do_not_disclose_profile_data(communication):
    from app.ai.manager import ProviderManager
    from app.ai.providers.disabled import DisabledProvider
    from app.application.interpretation import InterpretationService

    service, a, b, blocks = communication
    interpreter = InterpretationService(service.units, service, ProviderManager(DisabledProvider()))
    sequence = completed(service, a, blocks)
    with pytest.raises(SemanticNotFoundError):
        interpreter.request(b, sequence.id)
    request = interpreter.request(a, sequence.id)
    assert [block.block_id for block in request.blocks] == [block.id for block in blocks]
    assert "profile_id" not in request.model_dump_json()
    unfinished = service.start(a, uuid4())
    with pytest.raises(DomainInvariantError):
        interpreter.request(a, unfinished.id)


def test_representation_selection_preserves_meaning_and_does_not_learn_relations(communication):
    service, a, b, blocks = communication
    representations = RepresentationService(service.units)
    block_service = BlockService(service.units)
    visual = representations.create(
        Representation(
            profile_id=a,
            concept_id=blocks[0].concept_id,
            type=RepresentationType.PICTOGRAM,
            source="test-library",
            asset_reference="noise.svg",
            license="test-license",
            commercial_use_allowed=False,
        )
    )
    with pytest.raises(DomainInvariantError):
        block_service.attach_representation(a, blocks[0].id, visual.id, actor_role="user")
    approved = representations.validate(a, visual.id, action="confirm", actor_role="user")
    attached = block_service.attach_representation(a, blocks[0].id, approved.id, actor_role="user")
    assert attached.concept_id == blocks[0].concept_id and attached.representation_id == approved.id
    assert service.memory(a, validated=True).relations == ()
    with pytest.raises(DomainInvariantError):
        block_service.attach_representation(a, blocks[1].id, approved.id, actor_role="user")
    with pytest.raises(SemanticNotFoundError):
        representations.validate(b, visual.id, action="confirm", actor_role="user")
    representations.archive(a, visual.id)
    with service.units() as store:
        assert store.get(a, Concept, approved.concept_id).id == blocks[0].concept_id
        assert store.get(a, CommunicationBlock, attached.id).concept_id == approved.concept_id


def test_disabled_provider_does_not_impose_ai_contract_bounds_on_pcl(communication):
    from app.ai.manager import ProviderManager
    from app.ai.providers.disabled import DisabledProvider
    from app.application.interpretation import InterpretationService

    service, a, _, _ = communication
    block = CommunicationBlock(
        profile_id=a, label="Message personnel", canonical_intent="sens " * 200, status="validated"
    )
    with service.units() as store:
        store.add(a, block)
    sequence = completed(service, a, (block,))
    interpreter = InterpretationService(service.units, service, ProviderManager(DisabledProvider()))
    decision = asyncio.run(interpreter.interpret(a, sequence.id))
    assert decision.candidates[0].text == "Message personnel"
    assert decision.candidates[0].source == "pcl"
    assert service.memory(a, validated=True).interpretations == ()
