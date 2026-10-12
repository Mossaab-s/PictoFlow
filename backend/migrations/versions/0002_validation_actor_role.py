"""Preserve the human role without inventing one for existing feedback facts."""

import sqlalchemy as sa
from alembic import op

revision = "0002_validation_actor_role"
down_revision = "0001_pcl_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("validation_event", sa.Column("actor_role", sa.String(), nullable=True))
    op.create_check_constraint(
        op.f("ck_validation_event_actor_role_values"),
        "validation_event",
        "actor_role IN ('user', 'caregiver', 'professional')",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_validation_event_actor_role_values"), "validation_event", type_="check"
    )
    op.drop_column("validation_event", "actor_role")
