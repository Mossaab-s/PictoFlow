"""Legacy account access and semantic rows survive the scoped-role migration."""

from uuid import uuid4

import pytest
from alembic import command
from sqlalchemy import text

from tests.integration.conftest import migration_config

pytestmark = pytest.mark.postgres


def test_account_type_migration_never_guesses_non_administrator_roles(postgres_connection):
    db = postgres_connection
    config = migration_config(db)
    command.downgrade(config, "0014_provider_configuration")
    admin, adult, profile = (uuid4() for _ in range(3))
    db.execute(
        text(
            "INSERT INTO user_communication_profile(id,version,display_name,created_at,updated_at) "
            "VALUES (:id,1,'Synthetic',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
        ),
        {"id": profile},
    )
    for key, name, is_admin in ((admin, "admin", True), (adult, "legacy-adult", False)):
        db.execute(
            text(
                "INSERT INTO auth_account(id,username,display_name,password_hash,is_admin,active,"
                "created_at,updated_at) VALUES (:id,:name,'Synthetic','unused',:admin,true,"
                "CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
            ),
            {"id": key, "name": name, "admin": is_admin},
        )
    db.execute(
        text(
            "INSERT INTO auth_profile_access(account_id,profile_id,role,capabilities) "
            "VALUES (:account,:profile,'editor',ARRAY['prepare_keyboard','view_history'])"
        ),
        {"account": adult, "profile": profile},
    )
    before = db.scalar(text("SELECT to_jsonb(p) FROM user_communication_profile p"))
    grant = db.scalar(text("SELECT to_jsonb(p) FROM auth_profile_access p"))
    command.upgrade(config, "head")
    assert dict(db.execute(text("SELECT id,account_type FROM auth_account")).all()) == {
        admin: "administrator",
        adult: None,
    }
    assert db.scalar(text("SELECT to_jsonb(p) FROM user_communication_profile p")) == before
    assert db.scalar(text("SELECT to_jsonb(p) FROM auth_profile_access p")) == grant
    command.downgrade(config, "0014_provider_configuration")
    command.upgrade(config, "head")
    db.execute(text("UPDATE auth_account SET account_type='parent' WHERE id=:id"), {"id": adult})
    with pytest.raises(RuntimeError, match="Cannot downgrade configured"):
        command.downgrade(config, "0014_provider_configuration")
