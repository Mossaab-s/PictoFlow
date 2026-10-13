import json
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.api.application import create_app
from app.config import Settings
from app.infrastructure.postgres.models import KeyboardPositionRow
from app.infrastructure.postgres.pcl_repository import PostgresPCLUnits

pytestmark = pytest.mark.postgres


@pytest.fixture
def api(postgres_connection):
    factory = sessionmaker(
        bind=postgres_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    app = create_app(
        Settings(environment="test", ai_provider="disabled", database_url=None, _env_file=None)
    )
    with TestClient(app) as client:
        app.state.pcl_units = PostgresPCLUnits(factory)
        yield client


def profile(api):
    return "/api/v1/profiles/" + api.post("/api/v1/profiles").json()["id"]


def group(api, base, label):
    response = api.post(base + "/keyboard-groups", json={"label": label, "actor_role": "user"})
    assert response.status_code == 201
    return response.json()


def touch(api, base, label):
    concept = api.post(
        base + "/concepts", json={"canonical_key": str(uuid4()), "label": label}
    ).json()
    block = api.post(base + "/blocks", json={"concept_id": concept["id"], "label": label}).json()
    assert (
        api.post(
            base + "/blocks/" + block["id"] + "/feedback",
            json={"action": "confirm", "actor_role": "user"},
        ).status_code
        == 200
    )
    return block


def place(api, base, block, group_id=None, zone="personal", position=0):
    return api.put(
        base + "/keyboard/" + block["id"],
        json={"zone": zone, "position": position, "group_id": group_id, "actor_role": "user"},
    )


def test_group_positions_preserve_global_anchors_and_ordered_communication(api):
    base = profile(api)
    people, needs = group(api, base, "Personnes"), group(api, base, "Besoins")
    mother, drink, stop = (touch(api, base, word) for word in ("Maman", "Boire", "Stop"))
    assert place(api, base, mother, people["id"]).status_code == 200
    assert place(api, base, drink, needs["id"]).status_code == 200
    assert place(api, base, stop, zone="stable", position=2).status_code == 200
    keyboard = api.get(base + "/keyboard").json()
    assert {(p["group_id"], p["zone"], p["position"]) for p in keyboard} == {
        (people["id"], "personal", 0),
        (needs["id"], "personal", 0),
        (None, "stable", 2),
    }
    renamed = api.patch(
        base + "/keyboard-groups/" + people["id"],
        json={"label": " Mes proches ", "actor_role": "caregiver"},
    )
    assert renamed.status_code == 200 and renamed.json()["label"] == "Mes proches"
    assert renamed.json()["id"] == people["id"]
    assert api.get(base + "/keyboard").json() == keyboard
    history = api.get(base + "/audit").json()
    event = history[-1]
    assert event["target_type"] == "keyboard_group" and event["source"] == "human:caregiver"
    assert json.loads(event["previous_state"])["label"] == "Personnes"
    assert json.loads(event["new_state"])["label"] == "Mes proches"
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    route = base + "/sequences/" + sequence["id"] + "/selection"
    for block in (mother, drink, mother):
        assert (
            api.post(route, json={"action": "append", "block_id": block["id"]}).status_code == 200
        )
    completed = api.post(route, json={"action": "complete"}).json()
    assert completed["block_ids"] == [mother["id"], drink["id"], mother["id"]]


def test_collision_and_stable_page_assignment_roll_back_atomically(api):
    base = profile(api)
    page = group(api, base, "Personnes")
    first, second = touch(api, base, "Maman"), touch(api, base, "Papa")
    assert place(api, base, first, page["id"]).status_code == 200
    before = api.get(base + "/keyboard").json()
    history = api.get(base + "/audit").json()
    assert place(api, base, second, page["id"]).status_code == 409
    assert api.get(base + "/keyboard").json() == before
    assert api.get(base + "/audit").json() == history
    assert place(api, base, first, page["id"], zone="stable").status_code == 400
    assert api.get(base + "/keyboard").json() == before
    assert place(api, base, second, zone="stable", position=1).status_code == 200
    assert place(api, base, first, zone="stable", position=1).status_code == 409


def test_groups_and_assignments_are_profile_scoped(api):
    base, foreign = profile(api), profile(api)
    page = group(api, base, "Personnes")
    own, other = touch(api, base, "Maman"), touch(api, foreign, "Boire")
    assert api.get(foreign + "/keyboard-groups").json() == []
    assert (
        api.patch(
            foreign + "/keyboard-groups/" + page["id"],
            json={"label": "Intrusion", "actor_role": "user"},
        ).status_code
        == 404
    )
    assert place(api, foreign, other, page["id"]).status_code == 404
    assert place(api, base, own, str(uuid4())).status_code == 404
    assert api.get(foreign + "/keyboard").json()[0]["group_id"] is None
    assert api.delete(base + "/memory").status_code == 204
    assert api.get(base + "/keyboard-groups").json() == []
    assert api.get(foreign + "/blocks").json()[0]["id"] == other["id"]


def test_group_name_conflicts_leave_placement_and_history_unchanged(api):
    base = profile(api)
    first, second = group(api, base, "Personnes"), group(api, base, "Besoins")
    history = api.get(base + "/audit").json()
    assert (
        api.patch(
            base + "/keyboard-groups/" + second["id"],
            json={"label": first["label"], "actor_role": "user"},
        ).status_code
        == 409
    )
    assert api.get(base + "/audit").json() == history
    assert [p["label"] for p in api.get(base + "/keyboard-groups").json()] == [
        "Personnes",
        "Besoins",
    ]
    assert (
        api.post(base + "/keyboard-groups", json={"label": " ", "actor_role": "user"}).status_code
        == 400
    )


def test_group_foreign_key_rejects_cross_profile_database_writes(api):
    base, foreign = profile(api), profile(api)
    page = group(api, base, "Personnes")
    block = touch(api, foreign, "Maman")
    with api.app.state.pcl_units.factory() as session:
        with pytest.raises(IntegrityError):
            session.add(
                KeyboardPositionRow(
                    profile_id=UUID(foreign.rsplit("/", 1)[1]),
                    block_id=UUID(block["id"]),
                    group_id=UUID(page["id"]),
                    zone="personal",
                    position=0,
                    locked=False,
                )
            )
            session.flush()
        session.rollback()


def test_group_creation_rolls_back_when_audit_write_fails(api, monkeypatch):
    from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository

    base = profile(api)

    def fail_history(*args, **kwargs):
        raise RuntimeError("injected group audit failure")

    monkeypatch.setattr(PostgresPCLRepository, "audit", fail_history)
    with pytest.raises(RuntimeError, match="injected"):
        api.post(base + "/keyboard-groups", json={"label": "Besoins", "actor_role": "user"})
    assert api.get(base + "/keyboard-groups").json() == []


def test_legacy_placement_preserves_membership_until_explicitly_cleared(api):
    base = profile(api)
    page = group(api, base, "Personnes")
    block = touch(api, base, "Maman")
    assert place(api, base, block, page["id"]).status_code == 200
    response = api.put(
        base + "/keyboard/" + block["id"],
        json={"zone": "personal", "position": 3, "actor_role": "user"},
    )
    assert response.status_code == 200 and response.json()["group_id"] == page["id"]
    assert place(api, base, block, group_id=None, position=3).json()["group_id"] is None


def test_downgrade_refuses_to_discard_personal_keyboard_organization(api, postgres_connection):
    from alembic import command

    from tests.integration.conftest import migration_config

    base = profile(api)
    page = group(api, base, "Personnes")
    with (
        pytest.raises(RuntimeError, match="Explicitly erase profile memory"),
        postgres_connection.begin_nested(),
    ):
        command.downgrade(migration_config(postgres_connection), "0005_personal_photos")
    assert api.get(base + "/keyboard-groups").json()[0]["id"] == page["id"]
