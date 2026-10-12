"""Initial profile-scoped PCL persistence schema.

Revision ID: 0001_pcl_foundation
Revises: None

Frozen schema: do not import application model metadata into this revision.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_pcl_foundation"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_communication_profile",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "version >= 1", name=op.f("ck_user_communication_profile_positive_version")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_communication_profile")),
    )
    op.create_table(
        "communication_sequence",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("context_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            (
                "(status = 'completed' AND completed_at IS NOT NULL) OR (status != "
                "'completed' AND completed_at IS NULL)"
            ),
            name=op.f("ck_communication_sequence_completion_state"),
        ),
        sa.CheckConstraint(
            "status IN ('in_progress', 'completed', 'cancelled')",
            name=op.f("ck_communication_sequence_status_values"),
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_communication_sequence_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_communication_sequence")),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_communication_sequence_profile_id")),
    )
    op.create_index(
        op.f("ix_communication_sequence_profile_id"),
        "communication_sequence",
        ["profile_id"],
        unique=False,
    )
    op.create_table(
        "concept",
        sa.Column("canonical_key", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'archived')", name=op.f("ck_concept_status_values")
        ),
        sa.CheckConstraint("length(trim(canonical_key)) > 0", name=op.f("ck_concept_nonempty_key")),
        sa.CheckConstraint("length(trim(label)) > 0", name=op.f("ck_concept_nonempty_label")),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_concept_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_concept")),
        sa.UniqueConstraint("profile_id", "canonical_key", name="uq_concept_profile_key"),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_concept_profile_id")),
    )
    op.create_index(op.f("ix_concept_profile_id"), "concept", ["profile_id"], unique=False)
    op.create_table(
        "semantic_gap_candidate",
        sa.Column("source_sequence_signature", sa.Text(), nullable=False),
        sa.Column("validated_intent", sa.Text(), nullable=False),
        sa.Column("occurrence_count", sa.Integer(), nullable=False),
        sa.Column("validated_count", sa.Integer(), nullable=False),
        sa.Column("existing_block_match", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "status IN ('proposed', 'approved', 'rejected', 'resolved')",
            name=op.f("ck_semantic_gap_candidate_status_values"),
        ),
        sa.CheckConstraint(
            "occurrence_count >= 0 AND validated_count >= 0 "
            "AND validated_count <= occurrence_count",
            name=op.f("ck_semantic_gap_candidate_counts"),
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_semantic_gap_candidate_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_semantic_gap_candidate")),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_semantic_gap_candidate_profile_id")),
    )
    op.create_index(
        op.f("ix_semantic_gap_candidate_profile_id"),
        "semantic_gap_candidate",
        ["profile_id"],
        unique=False,
    )
    op.create_table(
        "interpretation",
        sa.Column("sequence_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("corrected_text", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "status IN ('proposed', 'confirmed', 'corrected', 'rejected', 'not_understood')",
            name=op.f("ck_interpretation_status_values"),
        ),
        sa.CheckConstraint(
            "confidence >= 0 AND confidence <= 1", name=op.f("ck_interpretation_confidence_range")
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "sequence_id"],
            ["communication_sequence.profile_id", "communication_sequence.id"],
            name="fk_sequence_id_communication_sequence",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_interpretation_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_interpretation")),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_interpretation_profile_id")),
    )
    op.create_index(
        op.f("ix_interpretation_profile_id"), "interpretation", ["profile_id"], unique=False
    )
    op.create_table(
        "representation",
        sa.Column("concept_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("asset_reference", sa.Text(), nullable=True),
        sa.Column("source_reference", sa.Text(), nullable=True),
        sa.Column("license", sa.Text(), nullable=True),
        sa.Column("attribution", sa.Text(), nullable=True),
        sa.Column("commercial_use_allowed", sa.Boolean(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('proposed', 'validated', 'rejected', 'archived')",
            name=op.f("ck_representation_status_values"),
        ),
        sa.CheckConstraint(
            "type IN ('pictogram', 'text', 'photo', 'generated_visual', 'audio')",
            name=op.f("ck_representation_type_values"),
        ),
        sa.CheckConstraint(
            "length(trim(source)) > 0", name=op.f("ck_representation_nonempty_source")
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "concept_id"],
            ["concept.profile_id", "concept.id"],
            name="fk_concept_id_concept",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_representation_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_representation")),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_representation_profile_id")),
    )
    op.create_index(
        op.f("ix_representation_profile_id"), "representation", ["profile_id"], unique=False
    )
    op.create_table(
        "semantic_relation",
        sa.Column("source_concept_id", sa.Uuid(), nullable=False),
        sa.Column("target_concept_id", sa.Uuid(), nullable=False),
        sa.Column("relation_type", sa.String(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("validation_count", sa.Integer(), nullable=False),
        sa.Column("rejection_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            (
                "relation_type IN ('associated_with', 'often_followed_by', "
                "'often_preceded_by', 'contextually_related_to', 'shortcut_for')"
            ),
            name=op.f("ck_semantic_relation_relation_type_values"),
        ),
        sa.CheckConstraint(
            "status IN ('proposed', 'validated', 'rejected')",
            name=op.f("ck_semantic_relation_status_values"),
        ),
        sa.CheckConstraint(
            "confidence >= 0 AND confidence <= 1",
            name=op.f("ck_semantic_relation_confidence_range"),
        ),
        sa.CheckConstraint(
            "validation_count >= 0 AND rejection_count >= 0",
            name=op.f("ck_semantic_relation_counts"),
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "source_concept_id"],
            ["concept.profile_id", "concept.id"],
            name="fk_source_concept_id_concept",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "target_concept_id"],
            ["concept.profile_id", "concept.id"],
            name="fk_target_concept_id_concept",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_semantic_relation_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_semantic_relation")),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_semantic_relation_profile_id")),
    )
    op.create_index(
        op.f("ix_semantic_relation_profile_id"), "semantic_relation", ["profile_id"], unique=False
    )
    op.create_table(
        "communication_block",
        sa.Column("concept_id", sa.Uuid(), nullable=True),
        sa.Column("canonical_intent", sa.Text(), nullable=True),
        sa.Column("representation_id", sa.Uuid(), nullable=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("visual_reference", sa.Text(), nullable=True),
        sa.Column("spoken_text", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("stability", sa.String(), nullable=False),
        sa.Column("origin", sa.String(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "origin IN ('system', 'user', 'caregiver', 'professional', 'pcl_suggestion')",
            name=op.f("ck_communication_block_origin_values"),
        ),
        sa.CheckConstraint(
            "stability IN ('stable', 'adaptive')",
            name=op.f("ck_communication_block_stability_values"),
        ),
        sa.CheckConstraint(
            "status IN ('proposed', 'validated', 'rejected', 'archived')",
            name=op.f("ck_communication_block_status_values"),
        ),
        sa.CheckConstraint(
            (
                "(concept_id IS NOT NULL AND canonical_intent IS NULL) OR (concept_id IS "
                "NULL AND canonical_intent IS NOT NULL)"
            ),
            name=op.f("ck_communication_block_semantic_target"),
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "concept_id"],
            ["concept.profile_id", "concept.id"],
            name="fk_concept_id_concept",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "representation_id"],
            ["representation.profile_id", "representation.id"],
            name="fk_representation_id_representation",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_communication_block_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_communication_block")),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_communication_block_profile_id")),
    )
    op.create_index(
        op.f("ix_communication_block_profile_id"),
        "communication_block",
        ["profile_id"],
        unique=False,
    )
    op.create_table(
        "communication_sequence_item",
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("sequence_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("block_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "position >= 0", name=op.f("ck_communication_sequence_item_position_nonnegative")
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "block_id"],
            ["communication_block.profile_id", "communication_block.id"],
            name="fk_block_id_communication_block",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "sequence_id"],
            ["communication_sequence.profile_id", "communication_sequence.id"],
            name="fk_sequence_id_communication_sequence",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "profile_id", "sequence_id", "position", name=op.f("pk_communication_sequence_item")
        ),
    )
    op.create_table(
        "semantic_audit_event",
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("previous_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("new_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("target_type", sa.String(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("concept_id", sa.Uuid(), nullable=True),
        sa.Column("representation_id", sa.Uuid(), nullable=True),
        sa.Column("communication_block_id", sa.Uuid(), nullable=True),
        sa.Column("semantic_relation_id", sa.Uuid(), nullable=True),
        sa.Column("communication_sequence_id", sa.Uuid(), nullable=True),
        sa.Column("interpretation_id", sa.Uuid(), nullable=True),
        sa.Column("semantic_gap_candidate_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            (
                "(target_type = 'concept' AND target_id = concept_id AND concept_id IS NOT "
                "NULL AND representation_id IS NULL AND communication_block_id IS NULL AND "
                "semantic_relation_id IS NULL AND communication_sequence_id IS NULL AND "
                "interpretation_id IS NULL AND semantic_gap_candidate_id IS NULL) OR "
                "(target_type = 'representation' AND target_id = representation_id AND "
                "concept_id IS NULL AND representation_id IS NOT NULL AND "
                "communication_block_id IS NULL AND semantic_relation_id IS NULL AND "
                "communication_sequence_id IS NULL AND interpretation_id IS NULL AND "
                "semantic_gap_candidate_id IS NULL) OR (target_type = 'communication_block' "
                "AND target_id = communication_block_id AND concept_id IS NULL AND "
                "representation_id IS NULL AND communication_block_id IS NOT NULL AND "
                "semantic_relation_id IS NULL AND communication_sequence_id IS NULL AND "
                "interpretation_id IS NULL AND semantic_gap_candidate_id IS NULL) OR "
                "(target_type = 'semantic_relation' AND target_id = semantic_relation_id "
                "AND concept_id IS NULL AND representation_id IS NULL AND "
                "communication_block_id IS NULL AND semantic_relation_id IS NOT NULL AND "
                "communication_sequence_id IS NULL AND interpretation_id IS NULL AND "
                "semantic_gap_candidate_id IS NULL) OR (target_type = "
                "'communication_sequence' AND target_id = communication_sequence_id AND "
                "concept_id IS NULL AND representation_id IS NULL AND "
                "communication_block_id IS NULL AND semantic_relation_id IS NULL AND "
                "communication_sequence_id IS NOT NULL AND interpretation_id IS NULL AND "
                "semantic_gap_candidate_id IS NULL) OR (target_type = 'interpretation' AND "
                "target_id = interpretation_id AND concept_id IS NULL AND representation_id "
                "IS NULL AND communication_block_id IS NULL AND semantic_relation_id IS "
                "NULL AND communication_sequence_id IS NULL AND interpretation_id IS NOT "
                "NULL AND semantic_gap_candidate_id IS NULL) OR (target_type = "
                "'semantic_gap_candidate' AND target_id = semantic_gap_candidate_id AND "
                "concept_id IS NULL AND representation_id IS NULL AND "
                "communication_block_id IS NULL AND semantic_relation_id IS NULL AND "
                "communication_sequence_id IS NULL AND interpretation_id IS NULL AND "
                "semantic_gap_candidate_id IS NOT NULL)"
            ),
            name=op.f("ck_semantic_audit_event_consistent_target"),
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "communication_block_id"],
            ["communication_block.profile_id", "communication_block.id"],
            name="fk_communication_block_id_communication_block",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "communication_sequence_id"],
            ["communication_sequence.profile_id", "communication_sequence.id"],
            name="fk_communication_sequence_id_communication_sequence",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "concept_id"],
            ["concept.profile_id", "concept.id"],
            name="fk_concept_id_concept",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "interpretation_id"],
            ["interpretation.profile_id", "interpretation.id"],
            name="fk_interpretation_id_interpretation",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "representation_id"],
            ["representation.profile_id", "representation.id"],
            name="fk_representation_id_representation",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "semantic_gap_candidate_id"],
            ["semantic_gap_candidate.profile_id", "semantic_gap_candidate.id"],
            name="fk_semantic_gap_candidate_id_semantic_gap_candidate",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "semantic_relation_id"],
            ["semantic_relation.profile_id", "semantic_relation.id"],
            name="fk_semantic_relation_id_semantic_relation",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_semantic_audit_event_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_semantic_audit_event")),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_semantic_audit_event_profile_id")),
    )
    op.create_index(
        op.f("ix_semantic_audit_event_profile_id"),
        "semantic_audit_event",
        ["profile_id"],
        unique=False,
    )
    op.create_table(
        "validation_event",
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("corrected_value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("actor_reference", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("target_type", sa.String(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("concept_id", sa.Uuid(), nullable=True),
        sa.Column("representation_id", sa.Uuid(), nullable=True),
        sa.Column("communication_block_id", sa.Uuid(), nullable=True),
        sa.Column("semantic_relation_id", sa.Uuid(), nullable=True),
        sa.Column("communication_sequence_id", sa.Uuid(), nullable=True),
        sa.Column("interpretation_id", sa.Uuid(), nullable=True),
        sa.Column("semantic_gap_candidate_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            (
                "(target_type = 'concept' AND target_id = concept_id AND concept_id IS NOT "
                "NULL AND representation_id IS NULL AND communication_block_id IS NULL AND "
                "semantic_relation_id IS NULL AND communication_sequence_id IS NULL AND "
                "interpretation_id IS NULL AND semantic_gap_candidate_id IS NULL) OR "
                "(target_type = 'representation' AND target_id = representation_id AND "
                "concept_id IS NULL AND representation_id IS NOT NULL AND "
                "communication_block_id IS NULL AND semantic_relation_id IS NULL AND "
                "communication_sequence_id IS NULL AND interpretation_id IS NULL AND "
                "semantic_gap_candidate_id IS NULL) OR (target_type = 'communication_block' "
                "AND target_id = communication_block_id AND concept_id IS NULL AND "
                "representation_id IS NULL AND communication_block_id IS NOT NULL AND "
                "semantic_relation_id IS NULL AND communication_sequence_id IS NULL AND "
                "interpretation_id IS NULL AND semantic_gap_candidate_id IS NULL) OR "
                "(target_type = 'semantic_relation' AND target_id = semantic_relation_id "
                "AND concept_id IS NULL AND representation_id IS NULL AND "
                "communication_block_id IS NULL AND semantic_relation_id IS NOT NULL AND "
                "communication_sequence_id IS NULL AND interpretation_id IS NULL AND "
                "semantic_gap_candidate_id IS NULL) OR (target_type = "
                "'communication_sequence' AND target_id = communication_sequence_id AND "
                "concept_id IS NULL AND representation_id IS NULL AND "
                "communication_block_id IS NULL AND semantic_relation_id IS NULL AND "
                "communication_sequence_id IS NOT NULL AND interpretation_id IS NULL AND "
                "semantic_gap_candidate_id IS NULL) OR (target_type = 'interpretation' AND "
                "target_id = interpretation_id AND concept_id IS NULL AND representation_id "
                "IS NULL AND communication_block_id IS NULL AND semantic_relation_id IS "
                "NULL AND communication_sequence_id IS NULL AND interpretation_id IS NOT "
                "NULL AND semantic_gap_candidate_id IS NULL) OR (target_type = "
                "'semantic_gap_candidate' AND target_id = semantic_gap_candidate_id AND "
                "concept_id IS NULL AND representation_id IS NULL AND "
                "communication_block_id IS NULL AND semantic_relation_id IS NULL AND "
                "communication_sequence_id IS NULL AND interpretation_id IS NULL AND "
                "semantic_gap_candidate_id IS NOT NULL)"
            ),
            name=op.f("ck_validation_event_consistent_target"),
        ),
        sa.CheckConstraint(
            "action IN ('confirm', 'correct', 'reject')",
            name=op.f("ck_validation_event_action_values"),
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "communication_block_id"],
            ["communication_block.profile_id", "communication_block.id"],
            name="fk_communication_block_id_communication_block",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "communication_sequence_id"],
            ["communication_sequence.profile_id", "communication_sequence.id"],
            name="fk_communication_sequence_id_communication_sequence",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "concept_id"],
            ["concept.profile_id", "concept.id"],
            name="fk_concept_id_concept",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "interpretation_id"],
            ["interpretation.profile_id", "interpretation.id"],
            name="fk_interpretation_id_interpretation",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "representation_id"],
            ["representation.profile_id", "representation.id"],
            name="fk_representation_id_representation",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "semantic_gap_candidate_id"],
            ["semantic_gap_candidate.profile_id", "semantic_gap_candidate.id"],
            name="fk_semantic_gap_candidate_id_semantic_gap_candidate",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "semantic_relation_id"],
            ["semantic_relation.profile_id", "semantic_relation.id"],
            name="fk_semantic_relation_id_semantic_relation",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_validation_event_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_validation_event")),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_validation_event_profile_id")),
    )
    op.create_index(
        op.f("ix_validation_event_profile_id"), "validation_event", ["profile_id"], unique=False
    )

    op.execute("""
        CREATE FUNCTION pcl_prevent_history_mutation() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'PCL history is append-only';
        END;
        $$
    """)
    for table in ("validation_event", "semantic_audit_event"):
        op.execute(
            f"CREATE TRIGGER prevent_history_mutation BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION pcl_prevent_history_mutation()"
        )


def downgrade() -> None:
    op.drop_table("validation_event")
    op.drop_table("semantic_audit_event")
    op.execute("DROP FUNCTION pcl_prevent_history_mutation()")
    op.drop_table("communication_sequence_item")
    op.drop_table("communication_block")
    op.drop_table("semantic_relation")
    op.drop_table("representation")
    op.drop_table("interpretation")
    op.drop_table("semantic_gap_candidate")
    op.drop_table("concept")
    op.drop_table("communication_sequence")
    op.drop_table("user_communication_profile")
