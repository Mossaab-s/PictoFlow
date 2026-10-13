"""Optional personal profile names; preserve existing identity and PCL contents."""

import sqlalchemy as sa
from alembic import op

revision = "0007_profile_display_names"
down_revision = "0006_keyboard_groups"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user_communication_profile", sa.Column("display_name", sa.String(80), nullable=True)
    )
    op.create_check_constraint(
        op.f("ck_user_communication_profile_bounded_display_name"),
        "user_communication_profile",
        "display_name IS NULL OR (display_name = trim(display_name) "
        "AND length(display_name) BETWEEN 1 AND 80)",
    )


def downgrade():
    if (
        op.get_bind()
        .exec_driver_sql(
            "SELECT EXISTS (SELECT 1 FROM user_communication_profile "
            "WHERE display_name IS NOT NULL)"
        )
        .scalar()
    ):
        raise RuntimeError("Explicitly clear profile names before downgrading their storage")
    op.drop_constraint(
        op.f("ck_user_communication_profile_bounded_display_name"),
        "user_communication_profile",
        type_="check",
    )
    op.drop_column("user_communication_profile", "display_name")
