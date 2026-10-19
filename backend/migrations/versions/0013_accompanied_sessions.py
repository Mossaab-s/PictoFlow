"""Restrict accompanied browser sessions without altering account grants or PCL."""

import sqlalchemy as sa
from alembic import op

revision = "0013_accompanied_sessions"
down_revision = "0012_profile_capabilities"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("auth_session", sa.Column("assisted_profile_id", sa.Uuid, nullable=True))
    op.add_column(
        "auth_session",
        sa.Column("assisted_review_allowed", sa.Boolean, server_default=sa.false(), nullable=False),
    )
    op.create_foreign_key(
        op.f("fk_auth_session_assisted_profile_id_user_communication_profile"),
        "auth_session",
        "user_communication_profile",
        ["assisted_profile_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "assisted_review_requires_profile",
        "auth_session",
        "assisted_profile_id IS NOT NULL OR NOT assisted_review_allowed",
    )


def downgrade():
    # Dropping the scope must never turn an assisted cookie back into an adult session.
    op.execute("DELETE FROM auth_session WHERE assisted_profile_id IS NOT NULL")
    op.drop_constraint(
        op.f("ck_auth_session_assisted_review_requires_profile"), "auth_session", type_="check"
    )
    op.drop_constraint(
        op.f("fk_auth_session_assisted_profile_id_user_communication_profile"),
        "auth_session",
        type_="foreignkey",
    )
    op.drop_column("auth_session", "assisted_review_allowed")
    op.drop_column("auth_session", "assisted_profile_id")
