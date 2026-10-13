"""Immutable PCL domain objects. Database rows and AI transport models are adapters."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID, uuid4

from app.domain.pcl import invariants as check


def utc_now() -> datetime:
    return datetime.now(UTC)


class ConceptStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class RepresentationType(StrEnum):
    PICTOGRAM = "pictogram"
    TEXT = "text"
    PHOTO = "photo"
    GENERATED_VISUAL = "generated_visual"
    AUDIO = "audio"


class ProposalStatus(StrEnum):
    PROPOSED = "proposed"
    VALIDATED = "validated"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class BlockStability(StrEnum):
    STABLE = "stable"
    ADAPTIVE = "adaptive"


class BlockOrigin(StrEnum):
    SYSTEM = "system"
    USER = "user"
    CAREGIVER = "caregiver"
    PROFESSIONAL = "professional"
    PCL_SUGGESTION = "pcl_suggestion"


class RelationType(StrEnum):
    ASSOCIATED_WITH = "associated_with"
    OFTEN_FOLLOWED_BY = "often_followed_by"
    OFTEN_PRECEDED_BY = "often_preceded_by"
    CONTEXTUALLY_RELATED_TO = "contextually_related_to"
    SHORTCUT_FOR = "shortcut_for"


class RelationStatus(StrEnum):
    PROPOSED = "proposed"
    VALIDATED = "validated"
    REJECTED = "rejected"


class SequenceStatus(StrEnum):
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class InterpretationStatus(StrEnum):
    PROPOSED = "proposed"
    CONFIRMED = "confirmed"
    CORRECTED = "corrected"
    REJECTED = "rejected"
    NOT_UNDERSTOOD = "not_understood"


class ValidationAction(StrEnum):
    CONFIRM = "confirm"
    CORRECT = "correct"
    REJECT = "reject"


class HumanRole(StrEnum):
    USER = "user"
    CAREGIVER = "caregiver"
    PROFESSIONAL = "professional"


class TargetType(StrEnum):
    CONCEPT = "concept"
    REPRESENTATION = "representation"
    COMMUNICATION_BLOCK = "communication_block"
    SEMANTIC_RELATION = "semantic_relation"
    COMMUNICATION_SEQUENCE = "communication_sequence"
    INTERPRETATION = "interpretation"
    SEMANTIC_GAP_CANDIDATE = "semantic_gap_candidate"
    KEYBOARD_GROUP = "keyboard_group"


@dataclass(frozen=True, kw_only=True, slots=True)
class UserCommunicationProfile:
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    version: int = 1

    def __post_init__(self) -> None:
        check.identity_and_dates(self)
        check.count(self.version, "version", minimum=1)


@dataclass(frozen=True, kw_only=True, slots=True)
class Concept:
    profile_id: UUID
    canonical_key: str
    label: str
    id: UUID = field(default_factory=uuid4)
    status: ConceptStatus = ConceptStatus.ACTIVE
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    def __post_init__(self) -> None:
        check.identity_and_dates(self)
        check.text(self.canonical_key, "canonical_key")
        check.text(self.label, "label")
        check.enum_field(self, "status", ConceptStatus)


@dataclass(frozen=True, kw_only=True, slots=True)
class Representation:
    profile_id: UUID
    concept_id: UUID
    type: RepresentationType
    source: str
    id: UUID = field(default_factory=uuid4)
    label: str | None = None
    asset_reference: str | None = None
    source_reference: str | None = None
    license: str | None = None
    attribution: str | None = None
    commercial_use_allowed: bool | None = None
    status: ProposalStatus = ProposalStatus.PROPOSED
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    def __post_init__(self) -> None:
        check.identity_and_dates(self)
        check.identifier(self.concept_id, "concept_id")
        check.text(self.source, "source")
        check.enum_field(self, "type", RepresentationType)
        check.enum_field(self, "status", ProposalStatus)
        for name in ("label", "asset_reference", "source_reference", "license", "attribution"):
            if getattr(self, name) is not None:
                check.text(getattr(self, name), name)
        if (
            self.commercial_use_allowed is not None
            and type(self.commercial_use_allowed) is not bool
        ):
            raise check.DomainInvariantError(
                "commercial_use_allowed must be true, false or unknown"
            )


@dataclass(frozen=True, kw_only=True, slots=True)
class CommunicationBlock:
    profile_id: UUID
    label: str
    concept_id: UUID | None = None
    canonical_intent: str | None = None
    representation_id: UUID | None = None
    visual_reference: str | None = None
    spoken_text: str | None = None
    semantic_gap_id: UUID | None = None
    id: UUID = field(default_factory=uuid4)
    status: ProposalStatus = ProposalStatus.PROPOSED
    stability: BlockStability = BlockStability.ADAPTIVE
    origin: BlockOrigin = BlockOrigin.USER
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    def __post_init__(self) -> None:
        check.identity_and_dates(self)
        check.text(self.label, "label")
        if (self.concept_id is None) == (self.canonical_intent is None):
            raise check.DomainInvariantError(
                "A block requires exactly one concept or intent target"
            )
        if self.concept_id is not None:
            check.identifier(self.concept_id, "concept_id")
        for name in ("canonical_intent", "visual_reference", "spoken_text"):
            if getattr(self, name) is not None:
                check.text(getattr(self, name), name)
        if self.representation_id is not None:
            check.identifier(self.representation_id, "representation_id")
        if self.semantic_gap_id is not None:
            check.identifier(self.semantic_gap_id, "semantic_gap_id")
        check.enum_field(self, "status", ProposalStatus)
        check.enum_field(self, "stability", BlockStability)
        check.enum_field(self, "origin", BlockOrigin)
        if (
            self.origin == BlockOrigin.PCL_SUGGESTION
            and self.status == ProposalStatus.PROPOSED
            and self.stability != BlockStability.ADAPTIVE
        ):
            raise check.DomainInvariantError("New PCL block proposals must be adaptive")


@dataclass(frozen=True, kw_only=True, slots=True)
class SemanticRelation:
    profile_id: UUID
    source_concept_id: UUID
    target_concept_id: UUID
    relation_type: RelationType
    confidence: float
    id: UUID = field(default_factory=uuid4)
    validation_count: int = 0
    rejection_count: int = 0
    status: RelationStatus = RelationStatus.PROPOSED
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)

    def __post_init__(self) -> None:
        check.identity_and_dates(self)
        check.identifier(self.source_concept_id, "source_concept_id")
        check.identifier(self.target_concept_id, "target_concept_id")
        check.confidence(self.confidence)
        check.count(self.validation_count, "validation_count")
        check.count(self.rejection_count, "rejection_count")
        check.enum_field(self, "relation_type", RelationType)
        check.enum_field(self, "status", RelationStatus)
        if self.status == RelationStatus.VALIDATED and self.validation_count == 0:
            raise check.DomainInvariantError(
                "A validated relation requires human validation evidence"
            )
        if self.status == RelationStatus.REJECTED and self.rejection_count == 0:
            raise check.DomainInvariantError(
                "A rejected relation requires human rejection evidence"
            )


@dataclass(frozen=True, kw_only=True, slots=True)
class CommunicationSequence:
    profile_id: UUID
    session_id: UUID
    id: UUID = field(default_factory=uuid4)
    block_ids: tuple[UUID, ...] = ()
    context_id: UUID | None = None
    status: SequenceStatus = SequenceStatus.IN_PROGRESS
    created_at: datetime = field(default_factory=utc_now)
    completed_at: datetime | None = None

    def __post_init__(self) -> None:
        check.identity_and_dates(self)
        check.identifier(self.session_id, "session_id")
        if self.context_id is not None:
            check.identifier(self.context_id, "context_id")
        if not isinstance(self.block_ids, (tuple, list)):
            raise check.DomainInvariantError("block_ids must be an ordered collection")
        object.__setattr__(self, "block_ids", tuple(self.block_ids))
        for block_id in self.block_ids:
            check.identifier(block_id, "block_id")
        check.enum_field(self, "status", SequenceStatus)
        if self.status == SequenceStatus.COMPLETED:
            if not self.block_ids:
                raise check.DomainInvariantError("A completed sequence must not be empty")
            check.timestamp(self.completed_at, "completed_at")
            if self.completed_at < self.created_at:
                raise check.DomainInvariantError("completed_at must not precede created_at")
        elif self.completed_at is not None:
            raise check.DomainInvariantError("Only completed sequences have completed_at")


@dataclass(frozen=True, kw_only=True, slots=True)
class Interpretation:
    profile_id: UUID
    sequence_id: UUID
    text: str
    confidence: float
    source: str
    id: UUID = field(default_factory=uuid4)
    status: InterpretationStatus = InterpretationStatus.PROPOSED
    corrected_text: str | None = None
    created_at: datetime = field(default_factory=utc_now)

    def __post_init__(self) -> None:
        check.identity_and_dates(self)
        check.identifier(self.sequence_id, "sequence_id")
        check.text(self.source, "source")
        check.confidence(self.confidence)
        check.enum_field(self, "status", InterpretationStatus)
        if self.status == InterpretationStatus.NOT_UNDERSTOOD:
            if self.text != "" or self.corrected_text is not None:
                raise check.DomainInvariantError("A refusal cannot contain semantic meaning")
        else:
            check.text(self.text, "text")
        if self.corrected_text is not None:
            check.text(self.corrected_text, "corrected_text")
        if self.status == InterpretationStatus.CORRECTED and self.corrected_text is None:
            raise check.DomainInvariantError("A corrected interpretation requires corrected_text")
        if self.status in (InterpretationStatus.PROPOSED, InterpretationStatus.CONFIRMED):
            if self.corrected_text is not None:
                raise check.DomainInvariantError(
                    "Only corrected/rejected history may retain a correction"
                )

    @property
    def validated_text(self) -> str | None:
        if self.status == InterpretationStatus.CORRECTED:
            return self.corrected_text
        if self.status == InterpretationStatus.CONFIRMED:
            return self.text
        return None


@dataclass(frozen=True, kw_only=True, slots=True)
class ValidationEvent:
    profile_id: UUID
    target_type: TargetType
    target_id: UUID
    action: ValidationAction
    id: UUID = field(default_factory=uuid4)
    actor_role: HumanRole = HumanRole.USER
    actor_reference: str | None = None
    corrected_value: str | None = None
    created_at: datetime = field(default_factory=utc_now)

    def __post_init__(self) -> None:
        check.identity_and_dates(self)
        check.identifier(self.target_id, "target_id")
        check.enum_field(self, "target_type", TargetType)
        check.enum_field(self, "action", ValidationAction)
        check.enum_field(self, "actor_role", HumanRole)
        if self.actor_reference is not None:
            check.text(self.actor_reference, "actor_reference")
        if self.action == ValidationAction.CORRECT:
            check.text(self.corrected_value, "corrected_value")
        elif self.corrected_value is not None:
            raise check.DomainInvariantError("Only correction events include corrected_value")
