"""Atomic local-draft import with real profile locks and persistent receipts."""

from uuid import UUID, uuid4

import pytest

from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository
from tests.integration import test_keyboard_groups as scenarios
from tests.integration.test_keyboard_groups import group, place, profile, touch
from tests.integration.test_photo_api import confirm, media, photo_body

pytestmark = pytest.mark.postgres


@pytest.fixture
def api(postgres_connection):
    yield from scenarios.api.__wrapped__(postgres_connection)


def snapshot(api, base):
    result = api.get(base + "/communication-snapshot")
    assert result.status_code == 200
    return result.json()


def body(snapshot, ids):
    return {
        "request_id": str(uuid4()),
        "expected_revision": snapshot["revision"],
        "block_ids": ids,
        "actor_role": "user",
        "confirm": True,
    }


def records(api, base):
    return api.get(base + "/backup").json()["records"]


def test_snapshot_is_read_only_validated_scoped_and_keeps_reserved_gaps(api):
    base, other = profile(api), profile(api)
    rejected, chosen, stable = (touch(api, base, word) for word in ("Refusé", "Livre", "Stop"))
    place(api, base, rejected, position=0).raise_for_status()
    place(api, base, stable, zone="stable", position=2).raise_for_status()
    api.post(
        base + "/blocks/" + rejected["id"] + "/feedback",
        json={"action": "reject", "actor_role": "user"},
    ).raise_for_status()
    touch(api, other, "Secret autre profil")
    before = records(api, base)
    value = snapshot(api, base)
    assert {b["id"] for b in value["blocks"]} == {chosen["id"], stable["id"]}
    assert value["positions"] == api.get(base + "/keyboard").json()
    assert next(p for p in value["positions"] if p["block_id"] == chosen["id"])["position"] == 1
    assert snapshot(api, base)["revision"] == value["revision"]
    assert records(api, base) == before
    assert (
        api.get("/api/v1/profiles/" + str(uuid4()) + "/communication-snapshot").status_code == 404
    )


def test_import_preserves_repetitions_is_idempotent_and_never_validates_or_calls_ai(api):
    base = profile(api)
    a, b = (touch(api, base, word) for word in ("Maman", "Boire"))
    value = snapshot(api, base)
    payload = body(value, [a["id"], b["id"], a["id"]])
    before = records(api, base)

    def forbidden(*args, **kwargs):
        raise AssertionError("Offline import called the provider")

    api.app.state.ai_provider.interpret = forbidden
    response = api.post(base + "/offline-drafts", json=payload)
    assert response.status_code == 200
    assert response.json()["block_ids"] == payload["block_ids"]
    assert response.json()["id"] == payload["request_id"]
    assert response.json()["status"] == "completed"
    after = records(api, base)
    for collection in (
        "blocks",
        "positions",
        "groups",
        "concepts",
        "representations",
        "relations",
        "interpretations",
        "validations",
        "photos",
    ):
        assert after[collection] == before[collection]
    assert len(after["sequences"]) == len(before["sequences"]) + 1
    assert len(after["audit"]) == len(before["audit"]) + 1
    assert any(e["event_type"] == "sequence_imported_offline" for e in after["audit"])
    assert api.post(base + "/offline-drafts", json=payload).json() == response.json()
    assert records(api, base) == after
    # Retry confirms the original commit even after the keyboard was changed.
    touch(api, base, "Autre")
    assert api.post(base + "/offline-drafts", json=payload).json() == response.json()


@pytest.mark.parametrize("change", ["label", "meaning", "page", "position", "rejected"])
def test_changed_keyboard_refuses_the_whole_message_without_partial_writes(api, change):
    base = profile(api)
    block = touch(api, base, "Livre")
    page = group(api, base, "Objets")
    value = snapshot(api, base)
    payload = body(value, [block["id"], block["id"]])
    if change == "label":
        api.post(
            base + "/blocks/" + block["id"] + "/feedback",
            json={"action": "correct", "corrected_value": "Mon livre", "actor_role": "user"},
        ).raise_for_status()
    elif change == "meaning":
        api.patch(
            base + "/concepts/" + block["concept_id"], json={"label": "Mon sens changé"}
        ).raise_for_status()
    elif change == "page":
        api.patch(
            base + "/keyboard-groups/" + page["id"],
            json={"label": "Mes objets", "actor_role": "user"},
        ).raise_for_status()
    elif change == "position":
        place(api, base, block, page["id"], position=4).raise_for_status()
    else:
        api.post(
            base + "/blocks/" + block["id"] + "/feedback",
            json={"action": "reject", "actor_role": "user"},
        ).raise_for_status()
    before = records(api, base)
    assert api.post(base + "/offline-drafts", json=payload).status_code == 409
    assert records(api, base) == before


def test_request_identity_cannot_replace_an_import_or_an_existing_online_sequence(api):
    base = profile(api)
    block = touch(api, base, "Livre")
    payload = body(snapshot(api, base), [block["id"]])
    api.post(base + "/offline-drafts", json=payload).raise_for_status()
    before = records(api, base)
    for changes in (
        {"block_ids": [block["id"], block["id"]]},
        {"actor_role": "caregiver"},
        {"expected_revision": "0" * 64},
    ):
        assert api.post(base + "/offline-drafts", json={**payload, **changes}).status_code == 409
        assert records(api, base) == before
    online = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    assert (
        api.post(base + "/offline-drafts", json={**payload, "request_id": online["id"]}).status_code
        == 409
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"confirm": False},
        {"confirm": "true"},
        {"block_ids": []},
        {"block_ids": [str(uuid4())] * 33},
        {"unexpected": "no"},
    ],
)
def test_strict_confirmation_and_bounded_sequence(api, changes):
    base = profile(api)
    b = touch(api, base, "Livre")
    payload = body(snapshot(api, base), [b["id"]])
    before = records(api, base)
    assert api.post(base + "/offline-drafts", json={**payload, **changes}).status_code == 422
    assert records(api, base) == before


def test_foreign_or_absent_touch_and_profile_never_import(api):
    base, other = profile(api), profile(api)
    b = touch(api, other, "Secret")
    value = snapshot(api, base)
    before = records(api, base)
    assert api.post(base + "/offline-drafts", json=body(value, [b["id"]])).status_code == 409
    assert api.post(base + "/offline-drafts", json=body(value, [str(uuid4())])).status_code == 409
    assert (
        api.post(
            "/api/v1/profiles/" + str(uuid4()) + "/offline-drafts", json=body(value, [b["id"]])
        ).status_code
        == 404
    )
    assert records(api, base) == before


def test_late_audit_failure_rolls_back_sequence_and_items(api, monkeypatch):
    base = profile(api)
    b = touch(api, base, "Livre")
    payload = body(snapshot(api, base), [b["id"], b["id"]])
    before = records(api, base)
    original = PostgresPCLRepository.audit

    def failing(self, profile_id, event_type, *args, **kwargs):
        original(self, profile_id, event_type, *args, **kwargs)
        if event_type == "sequence_imported_offline":
            raise RuntimeError("Forced late failure")

    monkeypatch.setattr(PostgresPCLRepository, "audit", failing)
    with pytest.raises(RuntimeError, match="Forced late failure"):
        api.post(base + "/offline-drafts", json=payload)
    assert records(api, base) == before


def test_snapshot_contains_only_chosen_validated_photo_bytes(api):
    import base64

    base = profile(api)
    photo = api.post(base + "/blocks/photo", json=photo_body()).json()
    assert not snapshot(api, base)["photos"]
    confirm(api, base, photo).raise_for_status()
    value = snapshot(api, base)
    assert list(value["photos"]) == [photo["representation_id"]]
    assert value["photos"][photo["representation_id"]].startswith("data:image/jpeg;base64,")
    assert (
        base64.b64decode(value["photos"][photo["representation_id"]].split(",")[1])
        == api.get(media(base, photo)).content
    )
    payload = body(value, [photo["id"]])
    replacement = photo_body("blue")
    replacement.pop("label")
    api.put(base + "/blocks/" + photo["id"] + "/photo", json=replacement).raise_for_status()
    assert snapshot(api, base)["revision"] != value["revision"]
    assert api.post(base + "/offline-drafts", json=payload).status_code == 409


def test_large_snapshot_is_read_only_and_local_receipt_survives_archive_roundtrip(api, monkeypatch):
    from app.application import offline_communication

    base = profile(api)
    photo = api.post(base + "/blocks/photo", json=photo_body()).json()
    confirm(api, base, photo).raise_for_status()
    value = snapshot(api, base)
    payload = body(value, [photo["id"], photo["id"]])
    before = records(api, base)
    monkeypatch.setattr(offline_communication, "MAX_OFFLINE_MEDIA_BYTES", 1)
    assert api.get(base + "/communication-snapshot").status_code == 413
    assert records(api, base) == before
    # Import verifies the same revision without copying the photos a second time.
    api.post(base + "/offline-drafts", json=payload).raise_for_status()
    archive = api.get(base + "/backup").json()
    restored = api.post(
        "/api/v1/profiles/restore",
        json={
            "request_id": str(uuid4()),
            "confirm": True,
            "actor_role": "user",
            "display_name": "Copie fictive",
            "snapshot": archive,
        },
    )
    restored.raise_for_status()
    copy = records(api, "/api/v1/profiles/" + restored.json()["id"])
    assert any(s["block_ids"] and len(s["block_ids"]) == 2 for s in copy["sequences"])
    assert any(e["event_type"] == "sequence_imported_offline" for e in copy["audit"])
    assert sorted(p["digest"] for p in copy["photos"]) == sorted(
        p["digest"] for p in archive["records"]["photos"]
    )


def test_a_purged_profile_cannot_replay_the_old_local_message(api):
    base = profile(api)
    block = touch(api, base, "Livre")
    payload = body(snapshot(api, base), [block["id"]])
    api.post(base + "/offline-drafts", json=payload).raise_for_status()
    with api.app.state.pcl_units() as store:
        store.purge(UUID(base.rsplit("/", 1)[1]))
    before = records(api, base)
    assert api.post(base + "/offline-drafts", json=payload).status_code == 409
    assert records(api, base) == before
