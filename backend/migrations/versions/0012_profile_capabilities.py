"""Add explicit per-profile capabilities without altering personal PCL records."""

import sqlalchemy as sa
from alembic import op

revision = "0012_profile_capabilities"
down_revision = "0011_accounts_and_access"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("auth_profile_access", sa.Column("capabilities", sa.ARRAY(sa.Text)))
    op.execute("""
        UPDATE auth_profile_access SET capabilities = CASE role
        WHEN 'communicator' THEN ARRAY['communicate','review_meanings']::text[]
        ELSE ARRAY['communicate','export_profile','manage_meanings','prepare_keyboard',
                   'review_meanings','view_history']::text[] END
    """)
    op.alter_column("auth_profile_access", "capabilities", nullable=False)
    op.create_check_constraint(
        "valid_capabilities",
        "auth_profile_access",
        "cardinality(capabilities) BETWEEN 1 AND 6 AND "
        "array_position(capabilities, NULL) IS NULL AND "
        "capabilities <@ ARRAY['communicate','review_meanings','prepare_keyboard',"
        "'manage_meanings','view_history','export_profile']::text[]",
    )


def downgrade():
    # Returning custom grants to a broad legacy role could silently elevate access.
    connection = op.get_bind()
    if connection.execute(
        sa.text("""
        SELECT EXISTS(SELECT 1 FROM auth_profile_access WHERE NOT (
          (role='communicator' AND capabilities @> ARRAY['communicate','review_meanings']::text[]
           AND capabilities <@ ARRAY['communicate','review_meanings']::text[]) OR
          (role='editor' AND cardinality(capabilities)=6 AND capabilities @>
           ARRAY['communicate','export_profile','manage_meanings','prepare_keyboard',
                 'review_meanings','view_history']::text[])))
    """)
    ).scalar():
        raise RuntimeError("Cannot downgrade customized profile capabilities")
    op.drop_constraint(
        op.f("ck_auth_profile_access_valid_capabilities"), "auth_profile_access", type_="check"
    )
    op.drop_column("auth_profile_access", "capabilities")
