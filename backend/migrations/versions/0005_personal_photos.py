"""Store bounded personal photo pixels atomically with their representations."""

import sqlalchemy as sa
from alembic import op

revision = "0005_personal_photos"
down_revision = "0004_gap_blocks_keyboard"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "photo_asset",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_photo_asset")),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_photo_asset_profile_id")),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_photo_asset_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["profile_id", "id"],
            ["representation.profile_id", "representation.id"],
            name="fk_id_representation",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "octet_length(content) BETWEEN 1 AND 2097152",
            name=op.f("ck_photo_asset_bounded_content"),
        ),
        sa.CheckConstraint(
            "width BETWEEN 1 AND 1024 AND height BETWEEN 1 AND 1024",
            name=op.f("ck_photo_asset_bounded_dimensions"),
        ),
        sa.CheckConstraint("digest ~ '^[0-9a-f]{64}$'", name=op.f("ck_photo_asset_valid_digest")),
    )
    op.create_index(op.f("ix_photo_asset_profile_id"), "photo_asset", ["profile_id"])


def downgrade():
    # Never silently discard personal media during a schema rollback.
    connection = op.get_bind()
    if connection.exec_driver_sql("SELECT EXISTS (SELECT 1 FROM photo_asset)").scalar():
        raise RuntimeError("Remove personal photos explicitly before downgrading this migration")
    op.drop_index(op.f("ix_photo_asset_profile_id"), table_name="photo_asset")
    op.drop_table("photo_asset")
