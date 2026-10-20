"""Persist administrator provider settings separately from personal PCL state."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0014_provider_configuration"
down_revision = "0013_accompanied_sessions"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_provider_configuration",
        sa.Column("id", sa.SmallInteger(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("configuration", JSONB(), nullable=False),
        sa.Column("api_key", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["updated_by"], ["auth_account.id"], ondelete="RESTRICT"),
        sa.CheckConstraint("id = 1", name="singleton"),
        sa.CheckConstraint("version >= 1", name="positive_version"),
    )


def downgrade():
    if (
        op.get_bind()
        .execute(sa.text("SELECT EXISTS(SELECT 1 FROM ai_provider_configuration)"))
        .scalar()
    ):
        raise RuntimeError("Cannot downgrade saved provider configuration")
    op.drop_table("ai_provider_configuration")
