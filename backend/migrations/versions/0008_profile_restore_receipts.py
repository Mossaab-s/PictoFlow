"""Atomic profile restore receipts; existing profiles and semantic state are untouched."""

import sqlalchemy as sa
from alembic import op

revision = "0008_profile_restore_receipts"
down_revision = "0007_profile_display_names"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "profile_restore_receipt",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("profile_id", sa.Uuid, nullable=False),
        sa.Column("payload_digest", sa.String(64), nullable=False),
        sa.Column("actor_role", sa.String, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["profile_id"], ["user_communication_profile.id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint("profile_id"),
        sa.CheckConstraint("payload_digest ~ '^[0-9a-f]{64}$'", name="valid_digest"),
        sa.CheckConstraint(
            "actor_role IN ('user', 'caregiver', 'professional')", name="actor_role_values"
        ),
    )


def downgrade():
    if (
        op.get_bind()
        .exec_driver_sql("SELECT EXISTS (SELECT 1 FROM profile_restore_receipt)")
        .scalar()
    ):
        raise RuntimeError("Retain restore receipts while restored profiles exist")
    op.drop_table("profile_restore_receipt")
