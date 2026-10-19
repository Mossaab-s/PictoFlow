import json
from uuid import UUID, uuid4

import httpx2 as httpx
import pytest
import sqlalchemy as sa
from alembic import command
from fastapi.testclient import TestClient
from pydantic import TypeAdapter
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.api.application import create_app
from app.config import Settings
from app.domain.pcl.entities import UserCommunicationProfile
from app.infrastructure.postgres.models import ProfileRow
from app.infrastructure.postgres.pcl_repository import PostgresPCLUnits
from app.infrastructure.postgres.repositories import PostgresProfileRepository
from tests.integration.conftest import migration_config

pytestmark = pytest.mark.postgres


def identity(value):
    # PostgreSQL can return the same instant with the host's local UTC offset.
    return TypeAdapter(UserCommunicationProfile).validate_python(value)


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


def test_legacy_creation_and_reading_keep_optional_profile_identity(api):
    first = api.post("/api/v1/profiles")
    assert first.status_code == 201 and first.json()["display_name"] is None
    named = api.post("/api/v1/profiles", json={"display_name": "  Élodie (démo)  "})
    assert named.status_code == 201 and named.json()["display_name"] == "Élodie (démo)"
    duplicate = api.post("/api/v1/profiles", json={"display_name": "Élodie (démo)"}).json()
    assert duplicate["id"] != named.json()["id"]
    assert identity(api.get("/api/v1/profiles/" + named.json()["id"]).json()) == identity(
        named.json()
    )
    assert len(api.get("/api/v1/profiles").json()) == 3
    assert api.get("/api/v1/profiles/" + str(uuid4())).status_code == 404


def test_rename_keeps_keyboard_memory_history_and_other_profile_unchanged(api):
    first = api.post("/api/v1/profiles", json={"display_name": "Premier (démo)"}).json()
    other = api.post("/api/v1/profiles", json={"display_name": "Autre (démo)"}).json()
    base = "/api/v1/profiles/" + first["id"]
    block = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Boire",
            "pictogram_key": "drink",
            "actor_role": "user",
        },
    ).json()
    api.post(
        base + "/blocks/" + block["id"] + "/feedback",
        json={
            "action": "confirm",
            "actor_role": "user",
            "confirm_representation": True,
        },
    ).raise_for_status()
    group = api.post(
        base + "/keyboard-groups",
        json={
            "label": "Besoins",
            "actor_role": "user",
        },
    ).json()
    api.put(
        base + "/keyboard/" + block["id"],
        json={
            "zone": "personal",
            "position": 3,
            "group_id": group["id"],
            "actor_role": "user",
        },
    ).raise_for_status()
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    selection = base + "/sequences/" + sequence["id"] + "/selection"
    for _ in range(2):
        api.post(selection, json={"action": "append", "block_id": block["id"]}).raise_for_status()
    api.post(selection, json={"action": "complete"}).raise_for_status()
    resources = (
        "concepts",
        "blocks",
        "representations",
        "keyboard",
        "keyboard-groups",
        "sequences",
        "memory",
        "audit",
        "relations",
    )
    before = {path: api.get(base + "/" + path).json() for path in resources}
    renamed = api.patch(
        base, json={"display_name": "  Nouveau nom (démo)  ", "expected_version": first["version"]}
    )
    assert renamed.status_code == 200
    current = renamed.json()
    assert current["id"] == first["id"]
    assert identity(current).created_at == identity(first).created_at
    assert current["display_name"] == "Nouveau nom (démo)"
    assert current["version"] == first["version"] + 1
    assert identity(current).updated_at >= identity(first).updated_at
    assert {path: api.get(base + "/" + path).json() for path in resources} == before
    assert identity(api.get("/api/v1/profiles/" + other["id"]).json()) == identity(other)
    # A name is metadata: no semantic audit or validation was fabricated.
    assert identity(
        api.patch(
            base,
            json={"display_name": current["display_name"], "expected_version": current["version"]},
        ).json()
    ) == identity(current)


def test_stale_rename_and_missing_profile_cannot_overwrite_state(api):
    first = api.post("/api/v1/profiles").json()
    base = "/api/v1/profiles/" + first["id"]
    current = api.patch(
        base, json={"display_name": "Choix confirmé (démo)", "expected_version": first["version"]}
    ).json()
    stale = api.patch(
        base, json={"display_name": "Private stale draft", "expected_version": first["version"]}
    )
    assert stale.status_code == 409 and "Private stale draft" not in stale.text
    assert identity(api.get(base).json()) == identity(current)
    assert (
        api.patch(
            "/api/v1/profiles/" + str(uuid4()),
            json={
                "display_name": "Private absent profile",
                "expected_version": 1,
            },
        ).status_code
        == 404
    )
    assert identity(api.get(base).json()) == identity(current)


@pytest.mark.parametrize(
    "body",
    [
        {"display_name": " "},
        {"display_name": "a" * 81},
        {"display_name": 7},
        {"display_name": "Private body", "id": str(uuid4())},
    ],
)
def test_invalid_create_is_redacted_and_has_no_persistent_effect(api, body):
    response = api.post("/api/v1/profiles", json=body)
    assert response.status_code == 422
    assert "Private body" not in response.text
    assert api.get("/api/v1/profiles").json() == []


@pytest.mark.parametrize(
    "body",
    [
        {"display_name": " ", "expected_version": 1},
        {"display_name": "a" * 81, "expected_version": 1},
        {"display_name": "Private body"},
        {"display_name": "Private body", "expected_version": True},
        {"display_name": "Private body", "expected_version": 0},
        {"expected_version": 1},
    ],
)
def test_invalid_rename_preserves_profile_and_hides_input(api, body):
    first = api.post("/api/v1/profiles").json()
    base = "/api/v1/profiles/" + first["id"]
    response = api.patch(base, json=body)
    assert response.status_code == 422 and "Private body" not in response.text
    assert identity(api.get(base).json()) == identity(first)


def test_explicit_clear_and_memory_purge_have_separate_effects(api):
    first = api.post("/api/v1/profiles", json={"display_name": "Prénom (démo)"}).json()
    base = "/api/v1/profiles/" + first["id"]
    assert api.delete(base + "/memory").status_code == 204
    after_purge = api.get(base).json()
    assert after_purge["display_name"] == first["display_name"]
    response = api.patch(
        base, json={"display_name": None, "expected_version": after_purge["version"]}
    )
    assert response.status_code == 200
    assert response.json()["display_name"] is None
    assert response.json()["id"] == first["id"]


def test_rename_transaction_rolls_back_name_version_and_timestamp(api):
    first = api.post("/api/v1/profiles", json={"display_name": "Avant (démo)"}).json()
    with pytest.raises(RuntimeError, match="injected"):
        with api.app.state.pcl_units.factory.begin() as session:
            PostgresProfileRepository(session).rename(UUID(first["id"]), "Après (démo)", 1)
            raise RuntimeError("injected failure after flush")
    assert identity(api.get("/api/v1/profiles/" + first["id"]).json()) == identity(first)


def test_names_do_not_enter_provider_payloads_or_technical_signals(api, monkeypatch):
    from app.ai.manager import ProviderManager
    from app.ai.providers.openai_compatible import OpenAICompatibleProvider

    requests, signals = [], []
    monkeypatch.setattr(
        api.app.state.telemetry, "signal", lambda *args, **kwargs: signals.append((args, kwargs))
    )

    def respond(request):
        requests.append(request.content.decode())
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps({"status": "not_understood", "candidates": []}),
                        },
                    }
                ]
            },
        )

    api.app.state.ai_provider = ProviderManager(
        OpenAICompatibleProvider(
            "https://example.test/v1",
            "model",
            response_format="json_schema",
            transport=httpx.MockTransport(respond),
        )
    )
    name = "Private profile identity sentinel"
    first = api.post("/api/v1/profiles", json={"display_name": name}).json()
    base = "/api/v1/profiles/" + first["id"]
    block = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Boire",
            "pictogram_key": "drink",
            "actor_role": "user",
        },
    ).json()
    api.post(
        base + "/blocks/" + block["id"] + "/feedback",
        json={
            "action": "confirm",
            "actor_role": "user",
            "confirm_representation": True,
        },
    ).raise_for_status()
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + "/sequences/" + sequence["id"]
    api.post(
        path + "/selection", json={"action": "append", "block_id": block["id"]}
    ).raise_for_status()
    api.post(path + "/selection", json={"action": "complete"}).raise_for_status()
    api.post(path + "/interpret", json={}).raise_for_status()
    assert len(requests) == 1 and "Boire" in requests[0]
    assert name not in requests[0] and name not in json.dumps(signals)
    assert api.get(base + "/memory").json()["interpretations"] == []


def test_database_rejects_blank_or_untrimmed_names(session):
    for name in ("", " ", " untrimmed "):
        with pytest.raises(IntegrityError):
            with session.begin_nested():
                session.add(ProfileRow(display_name=name))
                session.flush()


def test_additive_migration_preserves_old_profiles_and_refuses_losing_names(postgres_connection):
    config = migration_config(postgres_connection)
    command.downgrade(config, "0006_keyboard_groups")
    profile = UserCommunicationProfile()
    table = sa.table(
        "user_communication_profile",
        sa.column("id", sa.Uuid()),
        sa.column("created_at"),
        sa.column("updated_at"),
        sa.column("version"),
    )
    postgres_connection.execute(
        table.insert().values(
            id=profile.id,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
            version=3,
        )
    )
    before = postgres_connection.execute(sa.select(table)).mappings().one()
    command.upgrade(config, "head")
    assert postgres_connection.execute(sa.select(table)).mappings().one() == before
    assert postgres_connection.scalar(sa.select(ProfileRow.display_name)) is None
    postgres_connection.execute(
        sa.update(ProfileRow).values(
            display_name="Nom conservé (démo)",
            updated_at=profile.updated_at,
        )
    )
    with pytest.raises(RuntimeError, match="Explicitly clear profile names"):
        command.downgrade(config, "0006_keyboard_groups")
    assert postgres_connection.scalar(sa.select(ProfileRow.display_name)) == "Nom conservé (démo)"
    postgres_connection.execute(
        sa.update(ProfileRow).values(display_name=None, updated_at=profile.updated_at)
    )
    command.downgrade(config, "0006_keyboard_groups")
    assert postgres_connection.execute(sa.select(table)).mappings().one() == before
    command.upgrade(config, "head")
