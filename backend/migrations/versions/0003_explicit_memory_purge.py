"""Reconcile append-only history with explicitly scoped profile-memory erasure."""

from alembic import op

revision = "0003_explicit_memory_purge"
down_revision = "0002_validation_actor_role"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE OR REPLACE FUNCTION pcl_prevent_history_mutation() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE'
                AND current_setting('pictoflow.purge_profile', true) = OLD.profile_id::text THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'PCL history is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)


def downgrade():
    op.execute("""
        CREATE OR REPLACE FUNCTION pcl_prevent_history_mutation() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'PCL history is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
