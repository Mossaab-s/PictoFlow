"""Two families, shared adults, live revocation and patient-only communication."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.application.access import PRESETS
from app.infrastructure.postgres.access import AccessConflict
from app.infrastructure.postgres.account_scope import AccessDenied
from app.infrastructure.postgres.models import (
    AccessEventRow,
    AccountManagementRow,
    AccountRow,
    PatientProfileRow,
    ProfileRow,
    ValidationRow,
)
from tests.integration.test_access import PHRASE, login, profile, secured

pytestmark = pytest.mark.postgres
__all__ = ["secured"]


def create(client, kind, name, **extra):
    return client.post(
        "/api/v1/auth/users",
        json={
            "username": name,
            "display_name": name,
            "password": PHRASE,
            "account_type": kind,
            **extra,
        },
    )


def link(client, owner, target, *, linked=True, expected=False, capabilities=None, previous=None):
    return client.put(
        f"/api/v1/auth/users/{owner}/links/{target}",
        json={
            "linked": linked,
            "expected_linked": expected,
            "capabilities": capabilities,
            "expected_capabilities": previous,
        },
    )


@pytest.fixture
def families(secured):
    client, service, admin = secured
    login(client)
    a = create(client, "practitioner", "practitioner-a").json()
    b = create(client, "practitioner", "practitioner-b").json()
    login(client, a["username"])
    parent = create(client, "parent", "parent-a").json()
    patient = create(client, "patient", "patient-a").json()
    assert (
        link(client, parent["id"], patient["id"], capabilities=PRESETS["editor"]).status_code == 204
    )
    login(client, b["username"])
    other_parent = create(client, "parent", "parent-b").json()
    other = create(client, "patient", "patient-b").json()
    assert (
        link(client, other_parent["id"], other["id"], capabilities=PRESETS["editor"]).status_code
        == 204
    )
    return client, service, admin, a, parent, patient, b, other_parent, other


def test_role_creation_is_atomic_and_patients_have_distinct_profiles(families):
    client, service, admin, a, parent, patient, b, other_parent, other = families
    assert patient["account_type"] == "patient" and not patient["is_admin"]
    p = patient["patient_profile_id"]
    assert patient["profile_capabilities"] == {p: list(PRESETS["communicator"])}
    assert p != other["patient_profile_id"]
    login(client, a["username"])
    assert {u["id"] for u in client.get("/api/v1/auth/users").json()} == {
        parent["id"],
        patient["id"],
    }
    assert {u["id"] for u in client.get("/api/v1/profiles").json()} == {p}
    assert client.get(f"/api/v1/profiles/{other['patient_profile_id']}").status_code == 404
    assert (
        client.patch(
            f"/api/v1/auth/users/{other['id']}/active",
            json={"active": False, "expected_active": True},
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/auth/users/{other_parent['id']}/password", json={"password": PHRASE}
        ).status_code
        == 403
    )
    assert (
        client.post(f"/api/v1/auth/users/{uuid4()}/password", json={"password": PHRASE}).status_code
        == 403
    )
    login(client, parent["username"])
    assert {u["id"] for u in client.get("/api/v1/auth/users").json()} == {patient["id"]}
    assert {u["id"] for u in client.get("/api/v1/profiles").json()} == {p}


@pytest.mark.parametrize(
    "actor_kind,target_kind,allowed",
    [
        ("practitioner", "practitioner", False),
        ("practitioner", "parent", True),
        ("practitioner", "patient", True),
        ("parent", "practitioner", False),
        ("parent", "parent", False),
        ("parent", "patient", True),
        ("patient", "patient", False),
    ],
)
def test_account_creation_never_elevates_roles(secured, actor_kind, target_kind, allowed):
    client, service, admin = secured
    actor = service.create("actor", "Fictif", PHRASE, account_type=actor_kind)
    login(client, actor.username)
    before = service.users()
    result = create(client, target_kind, "created-user")
    assert result.status_code == (201 if allowed else 403)
    if allowed:
        assert result.json()["is_admin"] is False
        assert (
            UUID(result.json()["id"])
            in service.current(client.cookies.get("__Host-pictoflow-session")).managed_account_ids
        )
    else:
        assert service.users() == before


def test_browser_cannot_create_administrator_or_mutate_account_type(secured):
    client, service, admin = secured
    login(client)
    assert create(client, "administrator", "other-admin").status_code == 422
    assert create(client, "patient", "elevated-user", is_admin=True).status_code == 422
    assert client.patch(
        f"/api/v1/auth/users/{admin.id}/type", json={"account_type": "patient"}
    ).status_code in (404, 405)


def test_existing_profile_binding_is_administrator_only_and_never_copies_pcl(secured):
    client, service, admin = secured
    login(client)
    p = profile(client)
    result = create(client, "patient", "existing-patient", profile_id=p)
    assert result.status_code == 201
    assert result.json()["patient_profile_id"] == p
    assert create(client, "patient", "duplicate-patient", profile_id=p).status_code == 409
    practitioner = create(client, "practitioner", "practitioner").json()
    login(client, practitioner["username"])
    assert create(client, "patient", "takeover-patient", profile_id=p).status_code == 403
    assert (
        link(
            client, practitioner["id"], result.json()["id"], capabilities=PRESETS["editor"]
        ).status_code
        == 403
    )
    assert client.get(f"/api/v1/profiles/{p}").status_code == 404


def test_shared_parent_does_not_transitively_expose_other_patient_or_credentials(families):
    client, service, admin, a, parent, patient, b, other_parent, other = families
    login(client)
    assert link(client, b["id"], parent["id"]).status_code == 204
    assert (
        link(client, parent["id"], other["id"], capabilities=PRESETS["editor"]).status_code == 204
    )
    login(client, a["username"])
    users = client.get("/api/v1/auth/users").json()
    shown_parent = next(u for u in users if u["id"] == parent["id"])
    assert shown_parent["managed_account_ids"] == [patient["id"]]
    assert set(shown_parent["profile_capabilities"]) == {patient["patient_profile_id"]}
    assert client.get(f"/api/v1/profiles/{other['patient_profile_id']}").status_code == 404
    assert (
        client.post(
            f"/api/v1/auth/users/{parent['id']}/password", json={"password": PHRASE}
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/v1/auth/users/{parent['id']}/active",
            json={"active": False, "expected_active": True},
        ).status_code
        == 403
    )
    assert (
        link(
            client,
            parent["id"],
            other["id"],
            linked=False,
            expected=True,
            previous=PRESETS["editor"],
        ).status_code
        == 403
    )
    visible = client.get("/api/v1/auth/management-links").json()
    assert all(
        row["dependent_id"] != other["id"] and row["manager_id"] != b["id"] for row in visible
    )


def test_permissions_and_unlink_apply_to_existing_sessions_without_semantic_learning(families):
    client, service, admin, a, parent, patient, b, other_parent, other = families
    p = patient["patient_profile_id"]
    login(client, parent["username"])
    session_token = client.cookies.get("__Host-pictoflow-session")
    with service.factory.begin() as db:
        before = db.scalar(select(func.count()).select_from(ValidationRow))
    service.link(
        UUID(parent["id"]),
        UUID(patient["id"]),
        True,
        True,
        ["communicate"],
        PRESETS["editor"],
        actor_id=admin.id,
    )
    assert client.get(f"/api/v1/profiles/{p}/audit").status_code == 403
    assert (
        client.post(f"/api/v1/profiles/{p}/interpretations/{uuid4()}/feedback", json={}).status_code
        == 403
    )
    # Cannot recover review rights by resetting the more privileged patient's password.
    assert (
        client.post(
            f"/api/v1/auth/users/{patient['id']}/password", json={"password": PHRASE}
        ).status_code
        == 403
    )
    assert (
        link(
            client,
            parent["id"],
            patient["id"],
            expected=True,
            capabilities=PRESETS["editor"],
            previous=["communicate"],
        ).status_code
        == 403
    )
    service.link(
        UUID(parent["id"]),
        UUID(patient["id"]),
        False,
        True,
        None,
        ["communicate"],
        actor_id=admin.id,
    )
    assert client.get(f"/api/v1/profiles/{p}").status_code == 404
    assert service.current(session_token).profile_capabilities == {}
    assert client.get("/api/v1/auth/users").json() == []
    with service.factory.begin() as db:
        assert db.get(ProfileRow, UUID(p)) is not None
        assert db.scalar(select(func.count()).select_from(ValidationRow)) == before
        assert (
            db.scalar(
                select(func.count())
                .select_from(AccessEventRow)
                .where(AccessEventRow.event_type == "account_link_changed")
            )
            > 0
        )


def test_patient_can_communicate_and_decide_but_cannot_prepare_or_manage_accounts(families):
    from tests.integration.test_business_api import evolution_fixture

    client, service, admin, a, parent, patient, b, other_parent, other = families
    login(client)
    base, candidate = evolution_fixture(client)
    owned = create(client, "patient", "speaker", profile_id=base.rsplit("/", 1)[-1]).json()
    login(client, owned["username"])
    # The disabled provider still yields literal output; only an explicit choice confirms it.
    interpretation = candidate()
    result = client.post(
        base + f"/interpretations/{interpretation['id']}/feedback",
        json={"action": "confirm", "actor_role": "user"},
    )
    assert result.status_code == 200
    assert (
        client.post(base + "/concepts", json={"canonical_key": "X", "label": "X"}).status_code
        == 403
    )
    assert client.get(base + "/audit").status_code == 403
    assert client.get("/api/v1/auth/users").status_code == 403
    assert client.get("/api/v1/auth/management-links").status_code == 403
    assert client.get("/api/v1/providers/configuration").status_code == 403


def test_linked_account_recovery_and_suspension_respect_live_permissions(families):
    client, service, admin, a, parent, patient, b, other_parent, other = families
    login(client, parent["username"])
    assert (
        client.post(
            f"/api/v1/auth/users/{patient['id']}/password", json={"password": PHRASE}
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/v1/auth/users/{patient['id']}/active",
            json={"active": False, "expected_active": True},
        ).status_code
        == 200
    )
    assert login(client, patient["username"]).status_code == 401
    login(client, a["username"])
    assert (
        client.post(
            f"/api/v1/auth/users/{parent['id']}/password", json={"password": PHRASE}
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/v1/auth/users/{patient['id']}/active",
            json={"active": True, "expected_active": False},
        ).status_code
        == 200
    )
    assert login(client, patient["username"]).status_code == 200


def test_assisted_session_csrf_and_stale_link_guard(families):
    client, service, admin, a, parent, patient, b, other_parent, other = families
    login(client, a["username"])
    current = client.headers.pop("x-csrf-token")
    assert create(client, "patient", "missing-csrf").status_code == 403
    client.headers["x-csrf-token"] = current
    assert (
        link(
            client, parent["id"], patient["id"], expected=False, capabilities=PRESETS["editor"]
        ).status_code
        == 409
    )
    assert link(client, a["id"], a["id"], capabilities=PRESETS["editor"]).status_code == 403
    result = client.post(
        "/api/v1/auth/accompanied", json={"profile_id": patient["patient_profile_id"]}
    )
    assert result.status_code == 200
    client.headers["x-csrf-token"] = result.json()["csrf_token"]
    assert client.get("/api/v1/auth/users").status_code == 403
    assert create(client, "patient", "assisted-user").status_code == 403


def test_invalid_existing_profile_rolls_back_new_account_and_links(secured):
    client, service, admin = secured
    login(client)
    with service.factory.begin() as db:
        before = db.scalar(select(func.count()).select_from(AccountRow))
    assert create(client, "patient", "invalid-profile", profile_id=str(uuid4())).status_code == 409
    with service.factory.begin() as db:
        assert db.scalar(select(func.count()).select_from(AccountRow)) == before
        assert db.scalar(select(func.count()).select_from(PatientProfileRow)) == 0
        assert db.scalar(select(func.count()).select_from(AccountManagementRow)) == 0


def test_infrastructure_rechecks_actor_scope_inside_account_transactions(families):
    client, service, admin, a, parent, patient, b, other_parent, other = families
    with pytest.raises(AccessDenied):
        service.change(UUID(other["id"]), actor_id=UUID(a["id"]), password=PHRASE)
    with pytest.raises(AccessDenied):
        service.create(
            "elevated", "Fictif", PHRASE, account_type="practitioner", actor_id=UUID(parent["id"])
        )
    with pytest.raises(AccessConflict):
        service.grant(
            UUID(patient["id"]),
            UUID(other["patient_profile_id"]),
            "editor",
            None,
            actor_id=admin.id,
        )
