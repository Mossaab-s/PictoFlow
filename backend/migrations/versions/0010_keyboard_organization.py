"""Explicit page ordering and retained page history; no touch movement during migration."""

import sqlalchemy as sa
from alembic import op

revision = "0010_keyboard_organization"
down_revision = "0009_explicit_phrase_shortcuts"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "keyboard_group", sa.Column("sort_order", sa.Integer, nullable=False, server_default="0")
    )
    op.add_column(
        "keyboard_group", sa.Column("status", sa.String, nullable=False, server_default="active")
    )
    op.execute(
        "WITH ranked AS (SELECT id, row_number() OVER "
        "(PARTITION BY profile_id ORDER BY created_at,id)-1 AS n FROM keyboard_group) "
        "UPDATE keyboard_group g SET sort_order=r.n FROM ranked r WHERE r.id=g.id"
    )
    op.create_check_constraint("status_values", "keyboard_group", "status IN ('active','archived')")
    op.create_check_constraint("nonnegative_order", "keyboard_group", "sort_order >= 0")
    op.drop_constraint("uq_keyboard_group_profile_label", "keyboard_group", type_="unique")
    op.create_index(
        "uq_keyboard_group_active_label",
        "keyboard_group",
        ["profile_id", "label"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade():
    changed = (
        op.get_bind()
        .exec_driver_sql(
            "WITH ranked AS (SELECT id, row_number() OVER "
            "(PARTITION BY profile_id ORDER BY created_at,id)-1 AS n FROM keyboard_group) "
            "SELECT EXISTS(SELECT 1 FROM keyboard_group g JOIN ranked r ON r.id=g.id "
            "WHERE g.status <> 'active' OR g.sort_order <> r.n)"
        )
        .scalar()
    )
    if changed:
        raise RuntimeError("Retain chosen page order and archived page history before downgrade")
    op.drop_index("uq_keyboard_group_active_label", table_name="keyboard_group")
    op.create_unique_constraint(
        "uq_keyboard_group_profile_label", "keyboard_group", ["profile_id", "label"]
    )
    op.drop_constraint(op.f("ck_keyboard_group_status_values"), "keyboard_group", type_="check")
    op.drop_constraint(op.f("ck_keyboard_group_nonnegative_order"), "keyboard_group", type_="check")
    op.drop_column("keyboard_group", "status")
    op.drop_column("keyboard_group", "sort_order")
