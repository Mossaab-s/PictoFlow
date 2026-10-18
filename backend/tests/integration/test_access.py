"""Exercise real cookies, CSRF, PostgreSQL grants, revocation and PCL boundaries."""

from dataclasses import replace
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.api.application import create_app
from app.application.access import permits, token_hash
from app.config import Settings
from app.domain.pcl.entities import utc_now
from app.infrastructure.postgres.access import Accounts
from app.infrastructure.postgres.models import (
    AccessEventRow,
    AccountRow,
    AuthSessionRow,
    LoginWindowRow,
    ProfileRow,
    ValidationRow,
)
from app.infrastructure.postgres.pcl_repository import PostgresPCLUnits

pytestmark = pytest.mark.postgres
ORIGIN = "https://pictoflow.test"
PHRASE = "Une longue phrase fictive 2026 !"


def login(client, username="administrator", password=PHRASE):
    client.cookies.clear()
    client.headers.pop("x-csrf-token", None)
    result = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    if result.status_code == 200:
        client.headers["x-csrf-token"] = result.json()["csrf_token"]
    return result


@pytest.fixture
def secured(postgres_connection):
    factory = sessionmaker(
        bind=postgres_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    service = Accounts(factory)
    admin = service.create("administrator", "Administrateur fictif", PHRASE, admin=True)
    app = create_app(
        Settings(
            environment="test",
            auth_enabled=True,
            auth_origin=ORIGIN,
            ai_provider="disabled",
            database_url=None,
            _env_file=None,
        )
    )
    with TestClient(app, base_url=ORIGIN, headers={"origin": ORIGIN}) as client:
        app.state.pcl_units = PostgresPCLUnits(factory)
        yield client, service, admin


def profile(client):
    response = client.post("/api/v1/profiles", json={"display_name": "Profil fictif"})
    response.raise_for_status()
    return response.json()["id"]


def grant(client, user, profile_id, role, expected=None):
    return client.put(
        f"/api/v1/auth/users/{user.id}/profiles/{profile_id}",
        json={"role": role, "expected_role": expected},
    )


def capability_grant(client, user, profile_id, values, expected=None):
    return client.put(
        f"/api/v1/auth/users/{user.id}/profiles/{profile_id}/capabilities",
        json={"capabilities": values, "expected_capabilities": expected},
    )


def test_limited_communication_and_review_are_independent_and_revocable(secured):
    client, service, admin = secured
    login(client)
    p, other = profile(client), profile(client)
    base = f"/api/v1/profiles/{p}"
    user = service.create("limited", "Communication fictive", PHRASE)
    capability_grant(client, user, p, ["communicate"]).raise_for_status()
    block = client.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Eau",
            "pictogram_key": "water",
            "actor_role": "user",
        },
    ).json()
    client.post(
        base + f"/blocks/{block['id']}/feedback",
        json={
            "action": "confirm",
            "confirm_representation": True,
            "actor_role": "user",
        },
    ).raise_for_status()
    login(client, "limited")
    assert client.get("/api/v1/auth/session").json()["account"]["profile_capabilities"][p] == [
        "communicate"
    ]
    assert client.get(f"/api/v1/profiles/{other}/keyboard").status_code == 404
    assert capability_grant(client, user, p, ["export_profile"], ["communicate"]).status_code == 403
    seq = client.post(base + "/sequences", json={"session_id": str(uuid4())}).json()["id"]
    client.post(
        base + f"/sequences/{seq}/selection", json={"action": "append", "block_id": block["id"]}
    ).raise_for_status()
    client.post(
        base + f"/sequences/{seq}/selection", json={"action": "complete"}
    ).raise_for_status()
    candidate = client.post(base + f"/sequences/{seq}/interpret", json={}).json()["candidates"][0]
    feedback = base + f"/interpretations/{candidate['id']}/feedback"
    assert (
        client.post(feedback, json={"action": "confirm", "actor_role": "professional"}).status_code
        == 403
    )
    assert client.get(base + f"/interpretations/{candidate['id']}").json()["status"] == "proposed"
    service.grant_capabilities(
        user.id, UUID(p), ["review_meanings"], ["communicate"], actor_id=admin.id
    )
    # The same cookie immediately sees the reduced/changed grant, without logging in again.
    assert client.post(base + "/sequences", json={"session_id": str(uuid4())}).status_code == 403
    client.post(feedback, json={"action": "confirm", "actor_role": "user"}).raise_for_status()
    assert client.get(base + f"/interpretations/{candidate['id']}").json()["status"] == "confirmed"
    service.grant_capabilities(user.id, UUID(p), None, ["review_meanings"], actor_id=admin.id)
    assert client.get("/api/v1/profiles").json() == []
    assert client.get(base + "/keyboard").status_code == 404
    assert client.post(feedback, json={"action": "reject", "actor_role": "user"}).status_code == 404


def test_stale_and_legacy_grant_edits_cannot_overwrite_custom_capabilities(secured):
    client, service, _ = secured
    login(client)
    p = profile(client)
    user = service.create("customized", "Droits fictifs", PHRASE)
    grant(client, user, p, "communicator").raise_for_status()
    capability_grant(
        client, user, p, ["communicate"], ["review_meanings", "communicate"]
    ).raise_for_status()
    assert grant(client, user, p, "editor", "communicator").status_code == 409
    assert grant(client, user, p, None, "communicator").status_code == 409
    assert (
        capability_grant(
            client, user, p, ["export_profile"], ["communicate", "review_meanings"]
        ).status_code
        == 409
    )
    for invalid in ([], ["admin"], ["communicate", "communicate"]):
        assert capability_grant(client, user, p, invalid, ["communicate"]).status_code == 422
    users = client.get("/api/v1/auth/users").json()
    actual = next(item for item in users if item["id"] == str(user.id))
    assert actual["profile_capabilities"][p] == ["communicate"]
    capability_grant(client, user, p, None, ["communicate"]).raise_for_status()


@pytest.mark.parametrize(
    "capability,method,route,body",
    [
        (
            "prepare_keyboard",
            "POST",
            "/blocks/personal",
            {
                "label": "Livre",
                "pictogram_key": "book",
                "actor_role": "caregiver",
            },
        ),
        ("manage_meanings", "POST", "/concepts", {"canonical_key": "TEST", "label": "Sens"}),
        ("view_history", "GET", "/audit", None),
        ("export_profile", "GET", "/backup", None),
    ],
)
def test_custom_support_permissions_do_not_grant_communication_or_maintenance(
    secured, capability, method, route, body
):
    client, service, _ = secured
    login(client)
    p = profile(client)
    user = service.create("supporter", "Accompagnement fictif", PHRASE)
    capability_grant(client, user, p, [capability]).raise_for_status()
    login(client, "supporter")
    base = f"/api/v1/profiles/{p}"
    if body and route == "/blocks/personal":
        body = {**body, "request_id": str(uuid4())}
    result = client.request(method, base + route, json=body)
    result.raise_for_status()
    assert client.post(base + "/sequences", json={"session_id": str(uuid4())}).status_code == 403
    assert client.delete(base + "/memory").status_code == 403
    assert client.get(base + "/ai-quality").status_code == 403
    assert client.get("/api/v1/providers").status_code == 403
    if capability != "export_profile":
        assert client.get(base + "/backup").status_code == 403


def test_every_pcl_route_requires_authentication_before_accessing_data(secured):
    client, service, administrator = secured
    editor = replace(administrator, is_admin=False)
    assert not permits(editor, "editor", "POST", "/profiles/{profile_id}/unknown-command")
    assert not permits(editor, "editor", "POST", "/auth/users")
    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/auth/session").json() == {
        "enabled": True,
        "account": None,
        "csrf_token": None,
    }
    assert client.get("/openapi.json").status_code == 404
    with service.factory.begin() as session:
        before = session.scalar(select(func.count()).select_from(AccessEventRow))
    for _ in range(3):
        assert client.post("/api/v1/auth/logout").status_code == 204
    with service.factory.begin() as session:
        assert session.scalar(select(func.count()).select_from(AccessEventRow)) == before
    for route, operations in client.app.openapi()["paths"].items():
        if (
            not route.startswith("/api/v1/")
            or route in ("/api/v1/health", "/api/v1/readiness")
            or "/auth/" in route
        ):
            continue
        import re

        path = re.sub(r"\{[^}]+\}", str(uuid4()), route)
        for method in operations:
            if method not in ("get", "post", "put", "patch", "delete"):
                continue
            if route.startswith("/api/v1/profiles/{profile_id}"):
                admin_only = route in (
                    "/api/v1/profiles/{profile_id}/ai-quality",
                    "/api/v1/profiles/{profile_id}/memory",
                ) and (method == "delete" or route.endswith("/ai-quality"))
                assert (
                    permits(editor, "editor", method.upper(), route.removeprefix("/api/v1"))
                    != admin_only
                )
            result = client.request(method, path, json={} if method != "get" else None)
            assert result.status_code == 401, (method, route, result.status_code)


def test_secure_session_token_is_never_stored_or_returned_as_json(secured):
    client, service, admin = secured
    response = login(client)
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert all(
        value in cookie
        for value in ("__Host-pictoflow-session", "HttpOnly", "Secure", "SameSite=strict", "Path=/")
    )
    token = client.cookies.get("__Host-pictoflow-session")
    assert len(token) == 43 and token not in response.text
    assert PHRASE not in response.text and "password_hash" not in response.text
    with service.factory.begin() as session:
        stored = session.scalar(select(AuthSessionRow))
        assert stored.token_hash == token_hash(token) and token != stored.token_hash
        row = session.get(AccountRow, admin.id)
        assert row.password_hash.startswith("$argon2id$") and PHRASE not in row.password_hash
    result = client.get("/api/v1/auth/session")
    assert result.json()["account"]["id"] == str(admin.id)
    assert result.headers["cache-control"] == "no-store"
    assert response.json()["csrf_token"] != token


def test_unknown_password_and_inactive_account_have_same_generic_error(secured):
    client, service, _ = secured
    inactive = service.create("inactive", "Fictif inactif", PHRASE)
    service.change(inactive.id, actor_id=None, active=False)
    responses = [
        login(client, name, secret)
        for name, secret in (
            ("administrator", "mauvais secret"),
            ("unknown", PHRASE),
            ("inactive", PHRASE),
        )
    ]
    assert {r.status_code for r in responses} == {401}
    assert len({r.text for r in responses}) == 1
    assert all(PHRASE not in r.text for r in responses)


def test_login_throttle_is_persistent_and_applies_to_unknown_names(secured):
    client, service, administrator = secured
    assert [login(client, "unknown", PHRASE).status_code for _ in range(6)] == [401] * 5 + [429]
    response = login(client, "unknown", PHRASE)
    assert response.status_code == 429 and response.headers["retry-after"] == "900"
    with service.factory.begin() as session:
        before = session.scalar(select(func.count()).select_from(AccessEventRow))
    assert login(client, "unknown", PHRASE).status_code == 429
    with service.factory.begin() as session:
        assert session.scalar(select(func.count()).select_from(AccessEventRow)) == before
    with service.factory.begin() as session:
        assert session.scalar(select(func.count()).select_from(LoginWindowRow)) == 2
    assert login(client).status_code == 200
    for _ in range(5):
        assert login(client, password="mauvais secret").status_code == 401
    assert login(client).status_code == 429
    service.change(administrator.id, actor_id=None, password=PHRASE + " nouveau")
    assert login(client, password=PHRASE + " nouveau").status_code == 200


@pytest.mark.parametrize("header", [None, "https://evil.test", "null"])
def test_login_requires_the_configured_browser_origin(secured, header):
    client, service, _ = secured
    client.headers.pop("origin")
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "administrator", "password": PHRASE},
        headers={"origin": header} if header else {},
    )
    assert response.status_code == 403
    with service.factory.begin() as session:
        assert session.scalar(select(func.count()).select_from(AuthSessionRow)) == 0


def test_mutations_and_logout_require_csrf_and_origin(secured):
    client, service, _ = secured
    login(client)
    csrf = client.headers.pop("x-csrf-token")
    assert client.post("/api/v1/profiles", json={}).status_code == 403
    assert client.post("/api/v1/auth/logout").status_code == 403
    client.headers["x-csrf-token"] = csrf
    assert (
        client.post(
            "/api/v1/profiles", json={}, headers={"origin": "https://evil.test"}
        ).status_code
        == 403
    )
    with service.factory.begin() as session:
        assert session.scalar(select(func.count()).select_from(ProfileRow)) == 0
    saved = client.cookies.get("__Host-pictoflow-session")
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert service.current(saved) is None
    assert client.get("/api/v1/profiles").status_code == 401


def test_communicator_can_complete_and_validate_only_its_profile(secured):
    client, service, _ = secured
    login(client)
    a, b = profile(client), profile(client)
    user = service.create("speaker", "Personne fictive", PHRASE)
    assert grant(client, user, a, "communicator").status_code == 204
    base = f"/api/v1/profiles/{a}"
    block = client.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Boire",
            "pictogram_key": "drink",
            "actor_role": "user",
        },
    ).json()
    client.post(
        base + "/blocks/" + block["id"] + "/feedback",
        json={"action": "confirm", "actor_role": "user", "confirm_representation": True},
    ).raise_for_status()
    login(client, "speaker")
    assert [p["id"] for p in client.get("/api/v1/profiles").json()] == [a]
    assert client.get(f"/api/v1/profiles/{b}/communication-snapshot").status_code == 404
    assert client.get(f"/api/v1/profiles/{uuid4()}/communication-snapshot").status_code == 404
    assert client.get(base + "/backup").status_code == 403
    assert client.get("/api/v1/providers").status_code == 403
    assert client.get("/api/v1/auth/users").status_code == 403
    assert client.post("/api/v1/profiles", json={}).status_code == 403
    assert client.delete(base + "/memory").status_code == 403
    assert (
        client.post(
            base + "/blocks/personal",
            json={
                "request_id": str(uuid4()),
                "label": "Intrusion",
                "pictogram_key": "drink",
                "actor_role": "professional",
            },
        ).status_code
        == 403
    )
    seq = client.post(base + "/sequences", json={"session_id": str(uuid4())}).json()["id"]
    for action in ("append", "append", "complete"):
        body = {"action": action, **({"block_id": block["id"]} if action == "append" else {})}
        client.post(base + f"/sequences/{seq}/selection", json=body).raise_for_status()
    result = client.post(base + f"/sequences/{seq}/interpret", json={}).json()["candidates"][0]
    feedback = base + "/interpretations/" + result["id"] + "/feedback"
    assert (
        client.post(
            feedback, json={"action": "confirm", "actor_role": "user", "actor_reference": "forged"}
        ).status_code
        == 422
    )
    client.post(feedback, json={"action": "confirm", "actor_role": "user"}).raise_for_status()
    with service.factory.begin() as session:
        event = session.scalar(
            select(ValidationRow).where(ValidationRow.target_id == UUID(result["id"]))
        )
        assert event.actor_reference == str(user.id)
    assert client.get(base + "/memory").json()["interpretations"][0]["status"] == "confirmed"


def test_editor_can_prepare_and_backup_but_not_manage_accounts_or_restore(secured):
    client, service, _ = secured
    login(client)
    p = profile(client)
    user = service.create("editor", "Aidant fictif", PHRASE)
    grant(client, user, p, "editor").raise_for_status()
    login(client, "editor")
    base = f"/api/v1/profiles/{p}"
    client.post(
        base + "/concepts", json={"canonical_key": "TEST", "label": "Essai"}
    ).raise_for_status()
    archive = client.get(base + "/backup")
    assert archive.status_code == 200 and archive.json()["version"] == 3
    assert all(
        key not in archive.text for key in ("password_hash", "auth_account", "auth_session", PHRASE)
    )
    assert client.post("/api/v1/profiles/restore-preview", json=archive.json()).status_code == 403
    assert (
        client.post(
            "/api/v1/auth/users",
            json={"username": "new-admin", "display_name": "Escalade", "password": PHRASE},
        ).status_code
        == 403
    )
    assert client.delete(base + "/memory").status_code == 403


def test_revocation_applies_to_existing_sessions_and_stale_grants_are_refused(secured):
    client, service, admin = secured
    login(client)
    p = profile(client)
    user = service.create("speaker", "Personne fictive", PHRASE)
    grant(client, user, p, "communicator").raise_for_status()
    login(client, "speaker")
    assert client.get(f"/api/v1/profiles/{p}").status_code == 200
    service.grant(user.id, UUID(p), None, "communicator", actor_id=admin.id)
    assert client.get(f"/api/v1/profiles/{p}").status_code == 404
    assert client.get("/api/v1/profiles").json() == []
    login(client)
    assert grant(client, user, p, "editor", expected="communicator").status_code == 409
    assert (
        client.patch(
            f"/api/v1/auth/users/{user.id}/active", json={"active": True, "expected_active": False}
        ).status_code
        == 409
    )
    assert (
        client.patch(
            f"/api/v1/auth/users/{user.id}/active", json={"active": False, "expected_active": True}
        ).status_code
        == 200
    )


@pytest.mark.parametrize("action", ["password", "active", "expired"])
def test_password_reset_deactivation_and_expiration_revoke_access(secured, action):
    client, service, admin = secured
    user = service.create("speaker", "Personne fictive", PHRASE)
    login(client, "speaker")
    if action == "password":
        service.change(user.id, actor_id=admin.id, password=PHRASE + " nouveau")
    elif action == "active":
        service.change(user.id, actor_id=admin.id, active=False)
    else:
        with service.factory.begin() as session:
            session.scalar(select(AuthSessionRow)).expires_at = utc_now() - timedelta(seconds=1)
    assert client.get("/api/v1/profiles").status_code == 401
    assert client.get("/api/v1/auth/session").json()["account"] is None


def test_administrator_cannot_disable_last_admin_or_create_admin_from_browser(secured):
    client, _, admin = secured
    login(client)
    assert (
        client.patch(
            f"/api/v1/auth/users/{admin.id}/active", json={"active": False, "expected_active": True}
        ).status_code
        == 409
    )


def test_missing_or_forged_credentials_do_not_allow_a_bearer_or_actor_role_bypass(secured):
    client, _, _ = secured
    for headers in (
        {"Authorization": "Bearer invented"},
        {"Cookie": "__Host-pictoflow-session=" + "x" * 43},
        {"Cookie": "pictoflow-session=" + "x" * 43},
    ):
        assert client.get("/api/v1/profiles", headers=headers).status_code == 401
    login(client)
    assert (
        client.post("/api/v1/profiles", json={}, headers={"x-csrf-token": "wrong"}).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/auth/users",
            json={
                "username": "intruder",
                "display_name": "Fictif",
                "password": PHRASE,
                "is_admin": True,
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/auth/users",
            json={"username": "weak", "display_name": "Fictif", "password": "short"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/auth/users",
            json={"username": "blank", "display_name": "Fictif", "password": " " * 15},
        ).status_code
        == 422
    )
