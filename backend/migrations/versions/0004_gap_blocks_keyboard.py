"""Link controlled block proposals to gaps and persist explicit keyboard positions."""

import sqlalchemy as sa
from alembic import op

revision = "0004_gap_blocks_keyboard"
down_revision = "0003_explicit_memory_purge"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("communication_block", sa.Column("semantic_gap_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_semantic_gap_id_semantic_gap_candidate",
        "communication_block",
        "semantic_gap_candidate",
        ["profile_id", "semantic_gap_id"],
        ["profile_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_block_profile_gap", "communication_block", ["profile_id", "semantic_gap_id"]
    )
    op.create_index(
        "uq_gap_profile_pattern",
        "semantic_gap_candidate",
        [
            "profile_id",
            "source_sequence_signature",
            sa.text("md5(validated_intent)"),
        ],
        unique=True,
    )
    op.create_table(
        "keyboard_position",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("block_id", sa.Uuid(), nullable=False),
        sa.Column("zone", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("locked", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_keyboard_position")),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_keyboard_position_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "block_id"],
            ["communication_block.profile_id", "communication_block.id"],
            name="fk_block_id_communication_block",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_keyboard_position_profile_id")),
        sa.UniqueConstraint("profile_id", "block_id", name="uq_keyboard_profile_block"),
        sa.UniqueConstraint("profile_id", "zone", "position", name="uq_keyboard_profile_position"),
        sa.CheckConstraint(
            "zone IN ('stable', 'personal', 'adaptive')",
            name=op.f("ck_keyboard_position_zone_values"),
        ),
        sa.CheckConstraint("position >= 0", name=op.f("ck_keyboard_position_position_nonnegative")),
        sa.CheckConstraint(
            "locked = (zone = 'stable')", name=op.f("ck_keyboard_position_stable_locked")
        ),
    )
    op.create_index(op.f("ix_keyboard_position_profile_id"), "keyboard_position", ["profile_id"])


def downgrade():
    op.drop_table("keyboard_position")
    op.drop_index("uq_gap_profile_pattern", table_name="semantic_gap_candidate")
    op.drop_constraint("uq_block_profile_gap", "communication_block", type_="unique")
    op.drop_constraint(
        "fk_semantic_gap_id_semantic_gap_candidate", "communication_block", type_="foreignkey"
    )
    op.drop_column("communication_block", "semantic_gap_id")
