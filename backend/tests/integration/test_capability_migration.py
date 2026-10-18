from uuid import uuid4

import pytest
from alembic import command
from sqlalchemy import inspect, text

from tests.integration.conftest import migration_config

pytestmark = pytest.mark.postgres


def test_legacy_grants_are_backfilled_without_changing_pcl_and_custom_downgrade_is_refused(
    postgres_connection,
):
    db = postgres_connection
    config = migration_config(db)
    command.downgrade(config, "0011_accounts_and_access")
    profile, concept, speaker, editor = (uuid4() for _ in range(4))
    db.execute(
        text("""
        INSERT INTO user_communication_profile(id,version,display_name,created_at,updated_at)
        VALUES (:id,1,'Profil fictif',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    """),
        {"id": profile},
    )
    db.execute(
        text("""
        INSERT INTO concept(id,profile_id,canonical_key,label,status,created_at,updated_at)
        VALUES (:id,:profile,'WATER','Eau','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    """),
        {"id": concept, "profile": profile},
    )
    for identifier, role in ((speaker, "communicator"), (editor, "editor")):
        db.execute(
            text("""
            INSERT INTO auth_account(id,username,display_name,password_hash,is_admin,active,
                                     created_at,updated_at)
            VALUES (:id,:name,'Fictif','unused-test-hash',false,true,
                    CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        """),
            {"id": identifier, "name": role},
        )
        db.execute(
            text("""
            INSERT INTO auth_profile_access(account_id,profile_id,role) VALUES (:id,:profile,:role)
        """),
            {"id": identifier, "profile": profile, "role": role},
        )
    before = db.execute(
        text("SELECT to_jsonb(c) FROM concept c WHERE id=:id"), {"id": concept}
    ).scalar_one()
    command.upgrade(config, "head")
    rows = dict(db.execute(text("SELECT role,capabilities FROM auth_profile_access")).all())
    assert rows["communicator"] == ["communicate", "review_meanings"]
    assert set(rows["editor"]) == {
        "communicate",
        "review_meanings",
        "prepare_keyboard",
        "manage_meanings",
        "view_history",
        "export_profile",
    }
    assert (
        db.execute(
            text("SELECT to_jsonb(c) FROM concept c WHERE id=:id"), {"id": concept}
        ).scalar_one()
        == before
    )
    db.execute(
        text(
            "UPDATE auth_profile_access SET capabilities=ARRAY['communicate']::text[] "
            "WHERE account_id=:id"
        ),
        {"id": speaker},
    )
    with pytest.raises(RuntimeError, match="Cannot downgrade customized"):
        command.downgrade(config, "0011_accounts_and_access")
    assert "capabilities" in {
        column["name"] for column in inspect(db).get_columns("auth_profile_access")
    }
