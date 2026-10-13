"""Personal keyboard pages, scoped positions, and append-only group history."""

import sqlalchemy as sa
from alembic import op

revision = "0006_keyboard_groups"
down_revision = "0005_personal_photos"
branch_labels = None
depends_on = None

# Frozen migration contract; never import current application model metadata.
OLD_TARGETS = (
    "concept",
    "representation",
    "communication_block",
    "semantic_relation",
    "communication_sequence",
    "interpretation",
    "semantic_gap_candidate",
)


def target_check(targets):
    alternatives = []
    for target in targets:
        clauses = [f"target_type = '{target}'", f"target_id = {target}_id"]
        clauses.extend(f"{item}_id IS {'NOT ' if item == target else ''}NULL" for item in targets)
        alternatives.append("(" + " AND ".join(clauses) + ")")
    return " OR ".join(alternatives)


def upgrade():
    op.create_table(
        "keyboard_group",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_keyboard_group")),
        sa.UniqueConstraint("profile_id", "id", name=op.f("uq_keyboard_group_profile_id")),
        sa.UniqueConstraint("profile_id", "label", name="uq_keyboard_group_profile_label"),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["user_communication_profile.id"],
            name=op.f("fk_keyboard_group_profile_id_user_communication_profile"),
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "label = trim(label) AND length(label) BETWEEN 1 AND 80 AND lower(label) != 'accueil'",
            name=op.f("ck_keyboard_group_bounded_label"),
        ),
    )
    op.create_index(op.f("ix_keyboard_group_profile_id"), "keyboard_group", ["profile_id"])
    op.add_column("keyboard_position", sa.Column("group_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_group_id_keyboard_group",
        "keyboard_position",
        "keyboard_group",
        ["profile_id", "group_id"],
        ["profile_id", "id"],
        ondelete="RESTRICT",
    )
    op.drop_constraint("uq_keyboard_profile_position", "keyboard_position", type_="unique")
    op.create_unique_constraint(
        "uq_keyboard_profile_position",
        "keyboard_position",
        ["profile_id", "group_id", "zone", "position"],
        postgresql_nulls_not_distinct=True,
    )
    op.create_check_constraint(
        op.f("ck_keyboard_position_stable_global"),
        "keyboard_position",
        "zone != 'stable' OR group_id IS NULL",
    )
    for table in ("validation_event", "semantic_audit_event"):
        name = op.f(f"ck_{table}_consistent_target")
        op.drop_constraint(name, table, type_="check")
        op.add_column(table, sa.Column("keyboard_group_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            "fk_keyboard_group_id_keyboard_group",
            table,
            "keyboard_group",
            ["profile_id", "keyboard_group_id"],
            ["profile_id", "id"],
            ondelete="RESTRICT",
        )
        op.create_check_constraint(name, table, target_check((*OLD_TARGETS, "keyboard_group")))


def downgrade():
    if op.get_bind().exec_driver_sql("SELECT EXISTS (SELECT 1 FROM keyboard_group)").scalar():
        raise RuntimeError(
            "Explicitly erase profile memory before downgrading stored keyboard groups"
        )
    for table in ("validation_event", "semantic_audit_event"):
        name = op.f(f"ck_{table}_consistent_target")
        op.drop_constraint(name, table, type_="check")
        op.drop_constraint("fk_keyboard_group_id_keyboard_group", table, type_="foreignkey")
        op.drop_column(table, "keyboard_group_id")
        op.create_check_constraint(name, table, target_check(OLD_TARGETS))
    op.drop_constraint(
        op.f("ck_keyboard_position_stable_global"), "keyboard_position", type_="check"
    )
    op.drop_constraint("uq_keyboard_profile_position", "keyboard_position", type_="unique")
    op.create_unique_constraint(
        "uq_keyboard_profile_position", "keyboard_position", ["profile_id", "zone", "position"]
    )
    op.drop_constraint("fk_group_id_keyboard_group", "keyboard_position", type_="foreignkey")
    op.drop_column("keyboard_position", "group_id")
    op.drop_table("keyboard_group")
