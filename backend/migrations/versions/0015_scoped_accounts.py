"""Add account types and explicit management relationships without changing PCL data."""

import sqlalchemy as sa
from alembic import op

revision = "0015_scoped_accounts"
down_revision = "0014_provider_configuration"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("auth_account", sa.Column("account_type", sa.String(20), nullable=True))
    op.execute("UPDATE auth_account SET account_type='administrator' WHERE is_admin")
    op.create_check_constraint(
        "consistent_account_type",
        "auth_account",
        "(is_admin AND account_type IS NOT NULL AND account_type = 'administrator') "
        "OR (NOT is_admin AND "
        "(account_type IS NULL OR account_type IN ('practitioner','parent','patient')))",
    )
    op.create_table(
        "auth_account_management",
        sa.Column("manager_id", sa.Uuid(), nullable=False),
        sa.Column("dependent_id", sa.Uuid(), nullable=False),
        sa.Column("capabilities", sa.ARRAY(sa.Text()), nullable=True),
        sa.PrimaryKeyConstraint("manager_id", "dependent_id"),
        sa.ForeignKeyConstraint(["manager_id"], ["auth_account.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dependent_id"], ["auth_account.id"], ondelete="CASCADE"),
        sa.CheckConstraint("manager_id <> dependent_id", name="different_accounts"),
        sa.CheckConstraint(
            "capabilities IS NULL OR (cardinality(capabilities) BETWEEN 1 AND 6 AND "
            "array_position(capabilities, NULL) IS NULL AND "
            "capabilities <@ ARRAY['communicate','review_meanings','prepare_keyboard',"
            "'manage_meanings','view_history','export_profile']::text[])",
            name="valid_management_capabilities",
        ),
    )
    op.create_index(
        "ix_auth_account_management_dependent_id", "auth_account_management", ["dependent_id"]
    )
    op.create_table(
        "auth_patient_profile",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("account_id"),
        sa.UniqueConstraint("profile_id"),
        sa.ForeignKeyConstraint(["account_id"], ["auth_account.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["profile_id"], ["user_communication_profile.id"], ondelete="RESTRICT"
        ),
    )


def downgrade():
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS(SELECT 1 FROM auth_account WHERE account_type IN "
            "('practitioner','parent','patient')) OR EXISTS(SELECT 1 FROM auth_account_management) "
            "OR EXISTS(SELECT 1 FROM auth_patient_profile)"
        )
    ):
        raise RuntimeError("Cannot downgrade configured account types or relationships")
    op.drop_table("auth_patient_profile")
    op.drop_index("ix_auth_account_management_dependent_id", table_name="auth_account_management")
    op.drop_table("auth_account_management")
    op.drop_constraint("consistent_account_type", "auth_account", type_="check")
    op.drop_column("auth_account", "account_type")
