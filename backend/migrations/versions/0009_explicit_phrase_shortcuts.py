"""Personal shortcut choice on accepted messages; existing memory remains unchanged."""

import sqlalchemy as sa
from alembic import op

revision = "0009_explicit_phrase_shortcuts"
down_revision = "0008_profile_restore_receipts"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "interpretation",
        sa.Column("shortcut", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_check_constraint(
        "accepted_shortcut",
        "interpretation",
        "NOT shortcut OR status IN ('confirmed', 'corrected')",
    )


def downgrade():
    if (
        op.get_bind()
        .exec_driver_sql("SELECT EXISTS (SELECT 1 FROM interpretation WHERE shortcut)")
        .scalar()
    ):
        raise RuntimeError("Retain explicitly chosen phrase shortcuts before downgrade")
    op.drop_constraint(op.f("ck_interpretation_accepted_shortcut"), "interpretation", type_="check")
    op.drop_column("interpretation", "shortcut")
