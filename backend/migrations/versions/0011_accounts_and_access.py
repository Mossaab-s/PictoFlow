"""Accounts and revocable sessions are separate from personal semantic memory."""

import sqlalchemy as sa
from alembic import op

revision = "0011_accounts_and_access"
down_revision = "0010_keyboard_organization"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "auth_account",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("username", sa.String(80), nullable=False, unique=True),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("password_hash", sa.Text, nullable=False),
        sa.Column("is_admin", sa.Boolean, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("username ~ '^[a-z0-9][a-z0-9._-]{2,79}$'", name="valid_username"),
        sa.CheckConstraint("length(trim(display_name)) BETWEEN 1 AND 80", name="bounded_name"),
    )
    op.create_table(
        "auth_session",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "account_id",
            sa.Uuid,
            sa.ForeignKey("auth_account.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_auth_session_account_id", "auth_session", ["account_id"])
    op.create_index("ix_auth_session_expires_at", "auth_session", ["expires_at"])
    op.create_table(
        "auth_profile_access",
        sa.Column(
            "account_id",
            sa.Uuid,
            sa.ForeignKey("auth_account.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "profile_id",
            sa.Uuid,
            sa.ForeignKey("user_communication_profile.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.String(20), nullable=False),
        sa.CheckConstraint("role IN ('communicator','editor')", name="role_values"),
    )
    op.create_table(
        "auth_login_window",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer, nullable=False),
        sa.CheckConstraint("attempts >= 0", name="nonnegative_attempts"),
    )
    op.create_table(
        "auth_access_event",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("actor_id", sa.Uuid),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("target_id", sa.Uuid),
        sa.Column("detail", sa.String(256)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    connection = op.get_bind()
    if any(
        connection.exec_driver_sql(f'SELECT EXISTS(SELECT 1 FROM "{name}")').scalar()
        for name in (
            "auth_account",
            "auth_session",
            "auth_profile_access",
            "auth_login_window",
            "auth_access_event",
        )
    ):
        raise RuntimeError(
            "Account data exists; retain it and coordinate recovery before downgrade"
        )
    for name in (
        "auth_access_event",
        "auth_login_window",
        "auth_profile_access",
        "auth_session",
        "auth_account",
    ):
        op.drop_table(name)
