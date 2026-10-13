"""REST adapter with profile scope in every personal operation."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from app.ai.contracts import ProviderHealth
from app.application.audit import AuditService
from app.application.blocks import BlockService, RepresentationService
from app.application.communication import CommunicationService, PersonalMemory
from app.application.interpretation import InterpretationService
from app.application.semantic_space import SemanticSpace
from app.application.validation import RelationCorrectionService
from app.domain.pcl.audit import SemanticAuditEvent
from app.domain.pcl.confidence import ConfidenceDecision, ConfidencePolicy
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    HumanRole,
    Interpretation,
    RelationType,
    Representation,
    RepresentationType,
    SemanticRelation,
    TargetType,
    UserCommunicationProfile,
    ValidationAction,
    ValidationEvent,
)
from app.domain.pcl.gaps import GapPolicy, SemanticGapCandidate
from app.domain.pcl.keyboard import KeyboardPosition, KeyboardZone
from app.domain.pcl.pictograms import PictogramKey
from app.infrastructure.postgres.models import ProfileRow
from app.infrastructure.postgres.repositories import PostgresProfileRepository, to_domain
from app.infrastructure.postgres.semantic_space import PostgresSemanticUnits

router = APIRouter(prefix="/api/v1", tags=["PCL"])


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True, allow_inf_nan=False)


class ConceptBody(Body):
    canonical_key: str = Field(min_length=1, max_length=128)
    label: str = Field(min_length=1, max_length=256)


class LabelBody(Body):
    label: str = Field(min_length=1, max_length=256)


class RelationBody(Body):
    source_concept_id: UUID
    target_concept_id: UUID
    relation_type: RelationType
    confidence: float = Field(ge=0, le=1, strict=True)


class ConfidenceBody(Body):
    confidence: float = Field(ge=0, le=1, strict=True)


class RelationCorrectionBody(RelationBody):
    actor_role: HumanRole


class FeedbackBody(Body):
    action: ValidationAction
    actor_role: HumanRole
    corrected_value: str | None = Field(default=None, min_length=1, max_length=4000)

    @model_validator(mode="after")
    def correction_is_explicit(self):
        if (self.action == ValidationAction.CORRECT) != (self.corrected_value is not None):
            raise ValueError("Only correction requires a corrected value")
        return self


class SequenceBody(Body):
    session_id: UUID
    context_id: UUID | None = None


class SelectionBody(Body):
    action: str = Field(pattern="^(append|undo|clear|complete|cancel)$")
    block_id: UUID | None = None


class InterpretationBody(Body):
    declared_context: tuple[str, ...] = Field(default=(), max_length=8)


class BlockBody(Body):
    concept_id: UUID
    label: str = Field(min_length=1, max_length=256)
    pictogram_key: PictogramKey | None = None


class BlockFeedbackBody(FeedbackBody):
    confirm_representation: bool = Field(default=False, strict=True)


class PersonalBlockBody(Body):
    request_id: UUID
    label: str = Field(min_length=1, max_length=256)
    pictogram_key: PictogramKey
    actor_role: HumanRole


class PictogramSelectionBody(Body):
    pictogram_key: PictogramKey
    actor_role: HumanRole


class GapDecisionBody(Body):
    approve: bool = Field(strict=True)
    actor_role: HumanRole


class PositionBody(Body):
    zone: KeyboardZone
    position: int = Field(ge=0, strict=True)
    actor_role: HumanRole


class RepresentationSelectionBody(Body):
    representation_id: UUID
    actor_role: HumanRole


class RepresentationBody(Body):
    concept_id: UUID
    type: RepresentationType
    source: str = Field(min_length=1, max_length=256)
    label: str | None = Field(default=None, max_length=256)
    asset_reference: str | None = Field(default=None, max_length=2000)
    source_reference: str | None = Field(default=None, max_length=2000)
    license: str | None = Field(default=None, max_length=512)
    attribution: str | None = Field(default=None, max_length=512)
    commercial_use_allowed: bool | None = None


class RepresentationUpdateBody(Body):
    label: str | None = Field(default=None, max_length=256)
    asset_reference: str | None = Field(default=None, max_length=2000)
    source_reference: str | None = Field(default=None, max_length=2000)
    license: str | None = Field(default=None, max_length=512)
    attribution: str | None = Field(default=None, max_length=512)
    commercial_use_allowed: bool | None = None


def units(request: Request):
    result = request.app.state.pcl_units
    if result is None:
        raise HTTPException(503, "Persistent storage is not configured")
    return result


def communication(request: Request):
    config = request.app.state.settings
    return CommunicationService(
        units(request),
        ConfidencePolicy(
            refusal=config.confidence_refusal,
            confirmation=config.confidence_confirmation,
            direct=config.confidence_direct,
        ),
    )


def blocks(request: Request):
    config = request.app.state.settings
    return BlockService(
        units(request), GapPolicy(config.gap_minimum_occurrences, config.gap_minimum_validated)
    )


def semantic(request: Request):
    return SemanticSpace(PostgresSemanticUnits(units(request).factory))


def listing(request: Request, profile_id: UUID, entity_type):
    with units(request)() as store:
        return store.list(profile_id, entity_type)


@router.get("/profiles", response_model=tuple[UserCommunicationProfile, ...])
def list_profiles(request: Request):
    with units(request).factory.begin() as session:
        rows = session.scalars(select(ProfileRow).order_by(ProfileRow.created_at, ProfileRow.id))
        return tuple(to_domain(UserCommunicationProfile, row) for row in rows)


@router.post("/profiles", status_code=201, response_model=UserCommunicationProfile)
def create_profile(request: Request):
    profile = UserCommunicationProfile()
    with units(request).factory.begin() as session:
        PostgresProfileRepository(session).add(profile)
    return profile


@router.get("/profiles/{profile_id}/concepts", response_model=tuple[Concept, ...])
def concepts(request: Request, profile_id: UUID):
    return listing(request, profile_id, Concept)


@router.post("/profiles/{profile_id}/concepts", status_code=201, response_model=Concept)
def create_concept(request: Request, profile_id: UUID, body: ConceptBody):
    return semantic(request).create_concept(profile_id, body.canonical_key, body.label)


@router.patch("/profiles/{profile_id}/concepts/{concept_id}", response_model=Concept)
def rename_concept(request: Request, profile_id: UUID, concept_id: UUID, body: LabelBody):
    return semantic(request).rename_concept(profile_id, concept_id, body.label)


@router.get("/profiles/{profile_id}/relations", response_model=tuple[SemanticRelation, ...])
def relations(request: Request, profile_id: UUID):
    return listing(request, profile_id, SemanticRelation)


@router.post("/profiles/{profile_id}/relations", status_code=201, response_model=SemanticRelation)
def create_relation(request: Request, profile_id: UUID, body: RelationBody):
    return semantic(request).create_relation(
        profile_id,
        body.source_concept_id,
        body.target_concept_id,
        body.relation_type,
        body.confidence,
    )


@router.patch(
    "/profiles/{profile_id}/relations/{relation_id}/confidence", response_model=SemanticRelation
)
def relation_confidence(
    request: Request, profile_id: UUID, relation_id: UUID, body: ConfidenceBody
):
    return semantic(request).update_confidence(profile_id, relation_id, body.confidence)


@router.post(
    "/profiles/{profile_id}/relations/{relation_id}/feedback", response_model=SemanticRelation
)
def relation_feedback(request: Request, profile_id: UUID, relation_id: UUID, body: FeedbackBody):
    return semantic(request).record_feedback(
        ValidationEvent(
            profile_id=profile_id,
            target_type=TargetType.SEMANTIC_RELATION,
            target_id=relation_id,
            **body.model_dump(),
        )
    )


@router.get("/profiles/{profile_id}/representations", response_model=tuple[Representation, ...])
def representations(request: Request, profile_id: UUID):
    return listing(request, profile_id, Representation)


@router.post(
    "/profiles/{profile_id}/relations/{relation_id}/correction", response_model=SemanticRelation
)
def correct_relation(
    request: Request, profile_id: UUID, relation_id: UUID, body: RelationCorrectionBody
):
    return RelationCorrectionService(units(request)).correct(
        profile_id,
        relation_id,
        source_id=body.source_concept_id,
        target_id=body.target_concept_id,
        relation_type=body.relation_type,
        confidence=body.confidence,
        actor_role=body.actor_role,
    )


@router.post(
    "/profiles/{profile_id}/representations", status_code=201, response_model=Representation
)
def create_representation(request: Request, profile_id: UUID, body: RepresentationBody):
    return RepresentationService(units(request)).create(
        Representation(profile_id=profile_id, **body.model_dump())
    )


@router.patch(
    "/profiles/{profile_id}/representations/{representation_id}", response_model=Representation
)
def update_representation(
    request: Request, profile_id: UUID, representation_id: UUID, body: RepresentationUpdateBody
):
    return RepresentationService(units(request)).update(
        profile_id, representation_id, **body.model_dump(exclude_unset=True)
    )


@router.post(
    "/profiles/{profile_id}/representations/{representation_id}/archive",
    response_model=Representation,
)
def archive_representation(request: Request, profile_id: UUID, representation_id: UUID):
    return RepresentationService(units(request)).archive(profile_id, representation_id)


@router.get("/profiles/{profile_id}/blocks", response_model=tuple[CommunicationBlock, ...])
def list_blocks(request: Request, profile_id: UUID):
    return listing(request, profile_id, CommunicationBlock)


@router.post(
    "/profiles/{profile_id}/representations/{representation_id}/feedback",
    response_model=Representation,
)
def representation_feedback(
    request: Request, profile_id: UUID, representation_id: UUID, body: FeedbackBody
):
    return RepresentationService(units(request)).validate(
        profile_id,
        representation_id,
        action=body.action,
        actor_role=body.actor_role,
        label=body.corrected_value,
    )


@router.post(
    "/profiles/{profile_id}/blocks/{block_id}/representation", response_model=CommunicationBlock
)
def attach_representation(
    request: Request, profile_id: UUID, block_id: UUID, body: RepresentationSelectionBody
):
    return blocks(request).attach_representation(
        profile_id, block_id, body.representation_id, actor_role=body.actor_role
    )


@router.post("/profiles/{profile_id}/blocks", status_code=201, response_model=CommunicationBlock)
def create_block(request: Request, profile_id: UUID, body: BlockBody):
    return blocks(request).create(
        profile_id, body.concept_id, body.label, pictogram_key=body.pictogram_key
    )


@router.post(
    "/profiles/{profile_id}/blocks/personal", status_code=201, response_model=CommunicationBlock
)
def create_personal_block(request: Request, profile_id: UUID, body: PersonalBlockBody):
    return blocks(request).create_personal(profile_id, **body.model_dump())


@router.post("/profiles/{profile_id}/blocks/{block_id}/feedback", response_model=CommunicationBlock)
def block_feedback(request: Request, profile_id: UUID, block_id: UUID, body: BlockFeedbackBody):
    return blocks(request).validate(
        profile_id,
        block_id,
        action=body.action,
        actor_role=body.actor_role,
        label=body.corrected_value,
        confirm_representation=body.confirm_representation,
    )


@router.put("/profiles/{profile_id}/blocks/{block_id}/pictogram", response_model=CommunicationBlock)
def select_pictogram(
    request: Request, profile_id: UUID, block_id: UUID, body: PictogramSelectionBody
):
    return blocks(request).select_pictogram(
        profile_id, block_id, body.pictogram_key, actor_role=body.actor_role
    )


@router.get("/profiles/{profile_id}/sequences", response_model=tuple[CommunicationSequence, ...])
def sequences(request: Request, profile_id: UUID):
    return communication(request).history(profile_id)


@router.get("/profiles/{profile_id}/sequences/{sequence_id}", response_model=CommunicationSequence)
def get_sequence(request: Request, profile_id: UUID, sequence_id: UUID):
    with units(request)() as store:
        return store.get(profile_id, CommunicationSequence, sequence_id)


@router.post(
    "/profiles/{profile_id}/sequences", status_code=201, response_model=CommunicationSequence
)
def start_sequence(request: Request, profile_id: UUID, body: SequenceBody):
    return communication(request).start(profile_id, body.session_id, body.context_id)


@router.post(
    "/profiles/{profile_id}/sequences/{sequence_id}/selection", response_model=CommunicationSequence
)
def selection(request: Request, profile_id: UUID, sequence_id: UUID, body: SelectionBody):
    return communication(request).select(profile_id, sequence_id, body.action, body.block_id)


@router.post(
    "/profiles/{profile_id}/sequences/{sequence_id}/interpret", response_model=ConfidenceDecision
)
async def interpret(
    request: Request, profile_id: UUID, sequence_id: UUID, body: InterpretationBody
):
    service = InterpretationService(
        units(request), communication(request), request.app.state.ai_provider
    )
    result = await service.interpret(
        profile_id, sequence_id, declared_context=body.declared_context
    )
    request.app.state.telemetry.signal("interpretation.result", result_state=result.state.value)
    return result


@router.get("/profiles/{profile_id}/interpretations", response_model=tuple[Interpretation, ...])
def interpretations(request: Request, profile_id: UUID):
    return listing(request, profile_id, Interpretation)


@router.get(
    "/profiles/{profile_id}/interpretations/{interpretation_id}", response_model=Interpretation
)
def get_interpretation(request: Request, profile_id: UUID, interpretation_id: UUID):
    with units(request)() as store:
        return store.get(profile_id, Interpretation, interpretation_id)


@router.post(
    "/profiles/{profile_id}/interpretations/{interpretation_id}/feedback",
    response_model=Interpretation,
)
def interpretation_feedback(
    request: Request, profile_id: UUID, interpretation_id: UUID, body: FeedbackBody
):
    return communication(request).validate(
        ValidationEvent(
            profile_id=profile_id,
            target_type=TargetType.INTERPRETATION,
            target_id=interpretation_id,
            **body.model_dump(),
        )
    )


@router.get("/profiles/{profile_id}/memory", response_model=PersonalMemory)
def memory(request: Request, profile_id: UUID, validated: bool = True):
    return communication(request).memory(profile_id, validated=validated)


@router.delete("/profiles/{profile_id}/memory", status_code=204)
async def erase_memory(request: Request, profile_id: UUID):
    await communication(request).erase(profile_id, request.app.state.transient_store)


@router.get("/profiles/{profile_id}/suggestions", response_model=tuple[SemanticGapCandidate, ...])
def suggestions(request: Request, profile_id: UUID):
    return listing(request, profile_id, SemanticGapCandidate)


@router.post(
    "/profiles/{profile_id}/suggestions/detect", response_model=tuple[SemanticGapCandidate, ...]
)
def detect_gaps(request: Request, profile_id: UUID):
    return blocks(request).detect_gaps(profile_id)


@router.post(
    "/profiles/{profile_id}/suggestions/{gap_id}/decision", response_model=SemanticGapCandidate
)
def decide_gap(request: Request, profile_id: UUID, gap_id: UUID, body: GapDecisionBody):
    return blocks(request).decide_gap(
        profile_id, gap_id, approve=body.approve, actor_role=body.actor_role
    )


@router.post(
    "/profiles/{profile_id}/suggestions/{gap_id}/block",
    status_code=201,
    response_model=CommunicationBlock,
)
def block_from_gap(request: Request, profile_id: UUID, gap_id: UUID, body: LabelBody):
    return blocks(request).from_gap(profile_id, gap_id, body.label)


@router.get("/profiles/{profile_id}/keyboard", response_model=tuple[KeyboardPosition, ...])
def keyboard(request: Request, profile_id: UUID):
    return blocks(request).keyboard(profile_id)


@router.put("/profiles/{profile_id}/keyboard/{block_id}", response_model=KeyboardPosition)
def position(request: Request, profile_id: UUID, block_id: UUID, body: PositionBody):
    return blocks(request).place(
        profile_id, block_id, body.zone, body.position, actor_role=body.actor_role
    )


@router.get("/profiles/{profile_id}/audit", response_model=tuple[SemanticAuditEvent, ...])
def audit(
    request: Request,
    profile_id: UUID,
    target_type: TargetType | None = None,
    target_id: UUID | None = None,
    limit: int = 500,
):
    return AuditService(units(request)).history(
        profile_id, target_type=target_type, target_id=target_id, limit=limit
    )


@router.get("/providers", response_model=ProviderHealth)
async def providers(request: Request):
    return await request.app.state.ai_provider.health()


@router.get("/readiness")
async def readiness(request: Request):
    redis = await request.app.state.transient_store.health()
    request.app.state.telemetry.signal("redis.availability", availability=redis.value)
    request.app.state.telemetry.signal("application.health", availability="healthy")
    return {
        "application": "healthy",
        "redis": redis.value,
        "database": "configured" if request.app.state.pcl_units else "disabled",
    }
