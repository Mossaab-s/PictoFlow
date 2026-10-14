"""SQL mappings, separate from pure Python PCL objects.

All semantic references pair profile_id with object id. Deletions use RESTRICT,
never cascading away validated state or history.
"""

from datetime import datetime
from uuid import UUID, uuid4

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column

from app.domain.pcl.entities import utc_now


class Base(DeclarativeBase):
    metadata = sa.MetaData(
        naming_convention={
            "pk": "pk_%(table_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "ix": "ix_%(table_name)s_%(column_0_name)s",
        }
    )


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class Scoped:
    id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid4)
    profile_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("user_communication_profile.id", ondelete="RESTRICT"), index=True
    )

    @declared_attr.directive
    def __table_args__(cls) -> tuple:
        return (sa.UniqueConstraint("profile_id", "id"),)


def scoped_fk(column: str, table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["profile_id", column],
        [f"{table}.profile_id", f"{table}.id"],
        name=f"fk_{column}_{table}",
        ondelete="RESTRICT",
    )


def states(column: str, values: tuple[str, ...]) -> sa.CheckConstraint:
    choices = ", ".join(f"'{value}'" for value in values)
    return sa.CheckConstraint(f"{column} IN ({choices})", name=f"{column}_values")


class ProfileRow(Timestamps, Base):
    __tablename__ = "user_communication_profile"
    id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True, default=uuid4)
    version: Mapped[int] = mapped_column(default=1)
    display_name: Mapped[str | None] = mapped_column(sa.String(80))
    __table_args__ = (
        sa.CheckConstraint("version >= 1", name="positive_version"),
        sa.CheckConstraint(
            "display_name IS NULL OR (display_name = trim(display_name) "
            "AND length(display_name) BETWEEN 1 AND 80)",
            name="bounded_display_name",
        ),
    )


class ConceptRow(Scoped, Timestamps, Base):
    __tablename__ = "concept"
    canonical_key: Mapped[str] = mapped_column(sa.Text)
    label: Mapped[str] = mapped_column(sa.Text)
    status: Mapped[str] = mapped_column(default="active")
    __table_args__ = (
        sa.UniqueConstraint("profile_id", "id"),
        sa.UniqueConstraint("profile_id", "canonical_key", name="uq_concept_profile_key"),
        states("status", ("active", "archived")),
        sa.CheckConstraint("length(trim(canonical_key)) > 0", name="nonempty_key"),
        sa.CheckConstraint("length(trim(label)) > 0", name="nonempty_label"),
    )


class ProfileRestoreRow(Base):
    """Technical receipt, retained after memory purge to prevent replaying an erased backup."""

    __tablename__ = "profile_restore_receipt"
    id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True)
    profile_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("user_communication_profile.id", ondelete="RESTRICT"), unique=True
    )
    payload_digest: Mapped[str] = mapped_column(sa.String(64))
    actor_role: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), default=utc_now)
    __table_args__ = (
        states("actor_role", ("user", "caregiver", "professional")),
        sa.CheckConstraint("payload_digest ~ '^[0-9a-f]{64}$'", name="valid_digest"),
    )


class RepresentationRow(Scoped, Timestamps, Base):
    __tablename__ = "representation"
    concept_id: Mapped[UUID] = mapped_column(sa.Uuid)
    type: Mapped[str]
    source: Mapped[str] = mapped_column(sa.Text)
    label: Mapped[str | None] = mapped_column(sa.Text)
    asset_reference: Mapped[str | None] = mapped_column(sa.Text)
    source_reference: Mapped[str | None] = mapped_column(sa.Text)
    license: Mapped[str | None] = mapped_column(sa.Text)
    attribution: Mapped[str | None] = mapped_column(sa.Text)
    commercial_use_allowed: Mapped[bool | None]
    status: Mapped[str] = mapped_column(default="proposed")
    __table_args__ = (
        sa.UniqueConstraint("profile_id", "id"),
        scoped_fk("concept_id", "concept"),
        states("type", ("pictogram", "text", "photo", "generated_visual", "audio")),
        states("status", ("proposed", "validated", "rejected", "archived")),
        sa.CheckConstraint("length(trim(source)) > 0", name="nonempty_source"),
    )


class PhotoAssetRow(Scoped, Base):
    __tablename__ = "photo_asset"
    content: Mapped[bytes] = mapped_column(sa.LargeBinary)
    digest: Mapped[str] = mapped_column(sa.String(64))
    width: Mapped[int]
    height: Mapped[int]
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True))
    __table_args__ = (
        sa.UniqueConstraint("profile_id", "id"),
        scoped_fk("id", "representation"),
        sa.CheckConstraint("octet_length(content) BETWEEN 1 AND 2097152", name="bounded_content"),
        sa.CheckConstraint(
            "width BETWEEN 1 AND 1024 AND height BETWEEN 1 AND 1024", name="bounded_dimensions"
        ),
        sa.CheckConstraint("digest ~ '^[0-9a-f]{64}$'", name="valid_digest"),
    )


class BlockRow(Scoped, Timestamps, Base):
    __tablename__ = "communication_block"
    concept_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    canonical_intent: Mapped[str | None] = mapped_column(sa.Text)
    representation_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    label: Mapped[str] = mapped_column(sa.Text)
    visual_reference: Mapped[str | None] = mapped_column(sa.Text)
    spoken_text: Mapped[str | None] = mapped_column(sa.Text)
    semantic_gap_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    status: Mapped[str] = mapped_column(default="proposed")
    stability: Mapped[str] = mapped_column(default="adaptive")
    origin: Mapped[str]
    __table_args__ = (
        sa.UniqueConstraint("profile_id", "id"),
        scoped_fk("concept_id", "concept"),
        scoped_fk("representation_id", "representation"),
        scoped_fk("semantic_gap_id", "semantic_gap_candidate"),
        sa.UniqueConstraint("profile_id", "semantic_gap_id", name="uq_block_profile_gap"),
        sa.CheckConstraint(
            "(concept_id IS NOT NULL AND canonical_intent IS NULL) OR "
            "(concept_id IS NULL AND canonical_intent IS NOT NULL)",
            name="semantic_target",
        ),
        states("status", ("proposed", "validated", "rejected", "archived")),
        states("stability", ("stable", "adaptive")),
        states("origin", ("system", "user", "caregiver", "professional", "pcl_suggestion")),
    )


class RelationRow(Scoped, Timestamps, Base):
    __tablename__ = "semantic_relation"
    source_concept_id: Mapped[UUID] = mapped_column(sa.Uuid)
    target_concept_id: Mapped[UUID] = mapped_column(sa.Uuid)
    relation_type: Mapped[str]
    confidence: Mapped[float] = mapped_column(sa.Float)
    validation_count: Mapped[int] = mapped_column(default=0)
    rejection_count: Mapped[int] = mapped_column(default=0)
    status: Mapped[str] = mapped_column(default="proposed")
    __table_args__ = (
        sa.UniqueConstraint("profile_id", "id"),
        scoped_fk("source_concept_id", "concept"),
        scoped_fk("target_concept_id", "concept"),
        states(
            "relation_type",
            (
                "associated_with",
                "often_followed_by",
                "often_preceded_by",
                "contextually_related_to",
                "shortcut_for",
            ),
        ),
        states("status", ("proposed", "validated", "rejected")),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="confidence_range"),
        sa.CheckConstraint("validation_count >= 0 AND rejection_count >= 0", name="counts"),
    )


class SequenceRow(Scoped, Base):
    __tablename__ = "communication_sequence"
    session_id: Mapped[UUID] = mapped_column(sa.Uuid)
    context_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    status: Mapped[str] = mapped_column(default="in_progress")
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    __table_args__ = (
        sa.UniqueConstraint("profile_id", "id"),
        states("status", ("in_progress", "completed", "cancelled")),
        sa.CheckConstraint(
            "(status = 'completed' AND completed_at IS NOT NULL) OR "
            "(status != 'completed' AND completed_at IS NULL)",
            name="completion_state",
        ),
    )


class SequenceItemRow(Base):
    """Ordered selections with explicit block FKs; repeated selections are allowed."""

    __tablename__ = "communication_sequence_item"
    profile_id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True)
    sequence_id: Mapped[UUID] = mapped_column(sa.Uuid, primary_key=True)
    position: Mapped[int] = mapped_column(primary_key=True)
    block_id: Mapped[UUID] = mapped_column(sa.Uuid)
    __table_args__ = (
        scoped_fk("sequence_id", "communication_sequence"),
        scoped_fk("block_id", "communication_block"),
        sa.CheckConstraint("position >= 0", name="position_nonnegative"),
    )


class InterpretationRow(Scoped, Base):
    __tablename__ = "interpretation"
    sequence_id: Mapped[UUID] = mapped_column(sa.Uuid)
    text: Mapped[str] = mapped_column(sa.Text)
    corrected_text: Mapped[str | None] = mapped_column(sa.Text)
    confidence: Mapped[float] = mapped_column(sa.Float)
    source: Mapped[str]
    status: Mapped[str] = mapped_column(default="proposed")
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), default=utc_now)
    shortcut: Mapped[bool] = mapped_column(default=False, server_default=sa.false())
    __table_args__ = (
        sa.UniqueConstraint("profile_id", "id"),
        scoped_fk("sequence_id", "communication_sequence"),
        states("status", ("proposed", "confirmed", "corrected", "rejected", "not_understood")),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="confidence_range"),
        sa.CheckConstraint(
            "NOT shortcut OR status IN ('confirmed', 'corrected')", name="accepted_shortcut"
        ),
    )


class GapRow(Scoped, Base):
    __tablename__ = "semantic_gap_candidate"
    source_sequence_signature: Mapped[str] = mapped_column(sa.Text)
    validated_intent: Mapped[str] = mapped_column(sa.Text)
    occurrence_count: Mapped[int]
    validated_count: Mapped[int]
    existing_block_match: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(default="proposed")
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), default=utc_now)
    __table_args__ = (
        sa.UniqueConstraint("profile_id", "id"),
        states("status", ("proposed", "approved", "rejected", "resolved")),
        sa.CheckConstraint(
            "occurrence_count >= 0 AND validated_count >= 0 "
            "AND validated_count <= occurrence_count",
            name="counts",
        ),
        sa.Index(
            "uq_gap_profile_pattern",
            "profile_id",
            "source_sequence_signature",
            sa.text("md5(validated_intent)"),
            unique=True,
        ),
    )


class KeyboardGroupRow(Scoped, Timestamps, Base):
    __tablename__ = "keyboard_group"
    label: Mapped[str] = mapped_column(sa.Text)
    __table_args__ = (
        sa.UniqueConstraint("profile_id", "id"),
        sa.UniqueConstraint("profile_id", "label", name="uq_keyboard_group_profile_label"),
        sa.CheckConstraint(
            "label = trim(label) AND length(label) BETWEEN 1 AND 80 AND lower(label) != 'accueil'",
            name="bounded_label",
        ),
    )


class KeyboardPositionRow(Scoped, Base):
    __tablename__ = "keyboard_position"
    block_id: Mapped[UUID] = mapped_column(sa.Uuid)
    zone: Mapped[str]
    position: Mapped[int]
    locked: Mapped[bool]
    group_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    __table_args__ = (
        sa.UniqueConstraint("profile_id", "id"),
        sa.UniqueConstraint("profile_id", "block_id", name="uq_keyboard_profile_block"),
        sa.UniqueConstraint(
            "profile_id",
            "group_id",
            "zone",
            "position",
            name="uq_keyboard_profile_position",
            postgresql_nulls_not_distinct=True,
        ),
        scoped_fk("group_id", "keyboard_group"),
        scoped_fk("block_id", "communication_block"),
        states("zone", ("stable", "personal", "adaptive")),
        sa.CheckConstraint("position >= 0", name="position_nonnegative"),
        sa.CheckConstraint("locked = (zone = 'stable')", name="stable_locked"),
        sa.CheckConstraint("zone != 'stable' OR group_id IS NULL", name="stable_global"),
    )


EVENT_TARGETS = (
    "concept",
    "representation",
    "communication_block",
    "semantic_relation",
    "communication_sequence",
    "interpretation",
    "semantic_gap_candidate",
    "keyboard_group",
)


class EventTarget:
    """Typed target references give polymorphic events real, profile-scoped FKs."""

    target_type: Mapped[str]
    target_id: Mapped[UUID] = mapped_column(sa.Uuid)
    concept_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    representation_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    communication_block_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    semantic_relation_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    communication_sequence_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    interpretation_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    semantic_gap_candidate_id: Mapped[UUID | None] = mapped_column(sa.Uuid)
    keyboard_group_id: Mapped[UUID | None] = mapped_column(sa.Uuid)

    @declared_attr.directive
    def __table_args__(cls) -> tuple:
        alternatives = []
        for table in EVENT_TARGETS:
            conditions = [f"target_type = '{table}'", f"target_id = {table}_id"]
            conditions += [
                f"{target}_id IS {'NOT ' if target == table else ''}NULL"
                for target in EVENT_TARGETS
            ]
            alternatives.append("(" + " AND ".join(conditions) + ")")
        return (
            sa.UniqueConstraint("profile_id", "id"),
            *(scoped_fk(f"{table}_id", table) for table in EVENT_TARGETS),
            sa.CheckConstraint(" OR ".join(alternatives), name="consistent_target"),
        )


class ValidationRow(EventTarget, Scoped, Base):
    __tablename__ = "validation_event"
    action: Mapped[str]
    corrected_value: Mapped[dict | None] = mapped_column(JSONB)
    actor_reference: Mapped[str | None]
    actor_role: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), default=utc_now)


class AuditRow(EventTarget, Scoped, Base):
    __tablename__ = "semantic_audit_event"
    event_type: Mapped[str]
    previous_state: Mapped[dict | None] = mapped_column(JSONB)
    new_state: Mapped[dict | None] = mapped_column(JSONB)
    source: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(sa.DateTime(timezone=True), default=utc_now)


ValidationRow.__table__.append_constraint(states("action", ("confirm", "correct", "reject")))
ValidationRow.__table__.append_constraint(
    states("actor_role", ("user", "caregiver", "professional"))
)
