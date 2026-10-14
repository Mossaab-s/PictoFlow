"""Real profile locks, projected coordinates, atomic moves and archive compatibility."""

import hashlib
import json
from uuid import UUID, uuid4

import pytest
from alembic import command

from app.application.profile_archive import parse_restore
from app.domain.pcl.entities import (
    BlockOrigin,
    CommunicationBlock,
    ProposalStatus,
    TargetType,
    ValidationAction,
    ValidationEvent,
)
from app.infrastructure.postgres.models import ProfileRestoreRow
from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository
from tests.integration import test_keyboard_groups as scenarios
from tests.integration.conftest import migration_config
from tests.integration.test_keyboard_groups import group, place, profile, touch
from tests.integration.test_profile_archives import fixture_archive, restore_body

pytestmark = pytest.mark.postgres


@pytest.fixture
def api(postgres_connection):
    yield from scenarios.api.__wrapped__(postgres_connection)


def preview_move(api, base, block, destination, position):
    return api.post(
        base + "/keyboard/" + block["id"] + "/move-preview",
        json={"destination_group_id": destination, "position": position},
    )


def move(api, base, block, preview):
    return api.post(
        base + "/keyboard/" + block["id"] + "/move",
        json={
            "destination_group_id": preview["destination_page"]["id"]
            if preview["destination_page"]
            else None,
            "position": preview["moves"][0]["after"]["position"],
            "preview_token": preview["preview_token"],
            "actor_role": "caregiver",
        },
    )


def preview_remove(api, base, page, destination=None):
    return api.post(
        base + "/keyboard-groups/" + page["id"] + "/removal-preview",
        json={"destination_group_id": destination},
    )


def remove(api, base, page, preview, **extra):
    return api.post(
        base + "/keyboard-groups/" + page["id"] + "/remove",
        json={
            "destination_group_id": preview["destination_page"]["id"]
            if preview["destination_page"]
            else None,
            "preview_token": preview["preview_token"],
            "actor_role": "professional",
            "confirm": True,
            **extra,
        },
    )


def state(api, base):
    return api.get(base + "/backup").json()["records"]


def test_page_order_is_persisted_scoped_and_never_moves_touches(api):
    base = profile(api)
    pages = [group(api, base, label) for label in ("Personnes", "Besoins", "Activités")]
    block = touch(api, base, "Maman")
    assert place(api, base, block, pages[0]["id"]).status_code == 200
    before = state(api, base)
    ids = [g["id"] for g in pages]
    body = {"group_ids": list(reversed(ids)), "expected_group_ids": ids, "actor_role": "caregiver"}
    response = api.put(base + "/keyboard-groups/order", json=body)
    assert response.status_code == 200
    assert [g["id"] for g in api.get(base + "/keyboard-groups").json()] == list(reversed(ids))
    after = state(api, base)
    assert after["positions"] == before["positions"] and after["blocks"] == before["blocks"]
    assert after["validations"] == before["validations"]
    assert api.put(base + "/keyboard-groups/order", json=body).status_code == 200
    assert state(api, base) == after
    stale = api.put(
        base + "/keyboard-groups/order", json={**body, "group_ids": [ids[1], ids[0], ids[2]]}
    )
    assert stale.status_code == 409 and state(api, base) == after
    foreign = profile(api)
    assert api.put(foreign + "/keyboard-groups/order", json=body).status_code == 404


@pytest.mark.parametrize("ids", [[0, 0, 1], [0, 1]])
def test_partial_or_duplicate_page_order_is_rejected_without_mutation(api, ids):
    base = profile(api)
    pages = [group(api, base, label) for label in ("A", "B", "C")]
    before = state(api, base)
    result = api.put(
        base + "/keyboard-groups/order",
        json={
            "group_ids": [pages[i]["id"] for i in ids],
            "expected_group_ids": [g["id"] for g in pages],
            "actor_role": "user",
        },
    )
    assert result.status_code == 409 and state(api, base) == before


def test_moving_out_of_accueil_freezes_other_default_coordinates_without_revalidation(api):
    base = profile(api)
    page = group(api, base, "Personnes")
    blocks = [touch(api, base, label) for label in ("Maman", "Papa", "Livre")]
    before = state(api, base)
    keyboard = api.get(base + "/keyboard").json()
    first_slot = min(keyboard, key=lambda p: p["position"])
    block = next(b for b in blocks if b["id"] == first_slot["block_id"])
    prepared = preview_move(api, base, block, page["id"], 0)
    assert prepared.status_code == 200 and state(api, base) == before
    changed = move(api, base, block, prepared.json())
    assert changed.status_code == 200
    after = api.get(base + "/keyboard").json()
    assert {p["block_id"]: p for p in after if p["block_id"] != block["id"]} == {
        p["block_id"]: p for p in keyboard if p["block_id"] != block["id"]
    }
    records = state(api, base)
    assert records["blocks"] == before["blocks"] and records["validations"] == before["validations"]
    assert len(records["positions"]) == len(blocks)
    assert any(e["event_type"] == "keyboard_place_retained" for e in records["audit"])
    assert any(
        e["event_type"] == "keyboard_touch_moved" and e["source"] == "human:caregiver"
        for e in records["audit"]
    )


def test_implicit_and_reserved_destinations_are_not_overwritten(api):
    base = profile(api)
    page = group(api, base, "Besoins")
    first, second = touch(api, base, "Eau"), touch(api, base, "Manger")
    keyboard = api.get(base + "/keyboard").json()
    target = next(p for p in keyboard if p["block_id"] == second["id"])
    before = state(api, base)
    assert preview_move(api, base, first, None, target["position"]).status_code == 409
    assert state(api, base) == before
    assert place(api, base, second, page["id"], position=7).status_code == 200
    api.post(
        base + "/blocks/" + second["id"] + "/feedback",
        json={"action": "reject", "actor_role": "user"},
    ).raise_for_status()
    before = state(api, base)
    assert preview_move(api, base, first, page["id"], 7).status_code == 409
    assert state(api, base) == before


def test_removal_transfers_every_placement_appends_after_destination_and_retains_history(api):
    base = profile(api)
    source, destination = group(api, base, "Personnes"), group(api, base, "Besoins")
    first, second, other, stop = [
        touch(api, base, label) for label in ("Maman", "Papa", "Eau", "Stop")
    ]
    for block, page, slot in ((first, source, 0), (second, source, 4), (other, destination, 9)):
        place(api, base, block, page["id"], position=slot).raise_for_status()
    place(api, base, stop, zone="stable", position=2).raise_for_status()
    api.post(
        base + "/blocks/" + second["id"] + "/feedback",
        json={"action": "reject", "actor_role": "user"},
    ).raise_for_status()
    before = state(api, base)
    prepared = preview_remove(api, base, source, destination["id"])
    assert prepared.status_code == 200 and state(api, base) == before
    preview = prepared.json()
    assert [m["after"]["position"] for m in preview["moves"]] == [10, 11]
    assert preview["moves"][1]["block"]["status"] == "rejected"
    assert remove(api, base, source, preview, confirm=False).status_code == 422
    assert remove(api, base, source, preview, confirm=1).status_code == 422
    assert state(api, base) == before
    result = remove(api, base, source, preview)
    assert result.status_code == 200 and result.json()["status"] == "archived"
    assert [g["id"] for g in api.get(base + "/keyboard-groups").json()] == [destination["id"]]
    after = state(api, base)
    assert after["blocks"] == before["blocks"] and after["validations"] == before["validations"]
    assert next(p for p in after["positions"] if p["block_id"] == stop["id"]) == next(
        p for p in before["positions"] if p["block_id"] == stop["id"]
    )
    assert next(p for p in after["positions"] if p["block_id"] == other["id"]) == next(
        p for p in before["positions"] if p["block_id"] == other["id"]
    )
    assert all(p["group_id"] != source["id"] for p in after["positions"])
    assert any(g["id"] == source["id"] and g["status"] == "archived" for g in after["groups"])
    assert any(e["event_type"] == "keyboard_group_archived" for e in after["audit"])
    assert place(api, base, first, source["id"]).status_code == 400
    assert (
        api.patch(
            base + "/keyboard-groups/" + source["id"], json={"label": "Autre", "actor_role": "user"}
        ).status_code
        == 409
    )
    assert group(api, base, "Personnes")["id"] != source["id"]


def test_empty_page_removal_and_accueil_transfer_preserve_existing_gap_and_defaults(api):
    base = profile(api)
    source = group(api, base, "Personnes")
    first, other, default = [touch(api, base, label) for label in ("Maman", "Livre", "Eau")]
    place(api, base, first, source["id"], position=0).raise_for_status()
    place(api, base, other, position=7).raise_for_status()
    keyboard = api.get(base + "/keyboard").json()
    preview = preview_remove(api, base, source).json()
    assert preview["moves"][0]["after"]["position"] == 8
    remove(api, base, source, preview).raise_for_status()
    after = api.get(base + "/keyboard").json()
    assert {p["block_id"]: p for p in after if p["block_id"] != first["id"]} == {
        p["block_id"]: p for p in keyboard if p["block_id"] != first["id"]
    }
    empty = group(api, base, "Vide")
    preview = preview_remove(api, base, empty).json()
    assert preview["moves"] == []
    positions = state(api, base)["positions"]
    remove(api, base, empty, preview).raise_for_status()
    assert state(api, base)["positions"] == positions


def test_stable_anchor_move_and_foreign_targets_are_rejected(api):
    base, foreign = profile(api), profile(api)
    page, foreign_page = group(api, base, "A"), group(api, foreign, "B")
    stop = touch(api, base, "Stop")
    place(api, base, stop, zone="stable", position=3).raise_for_status()
    before = state(api, base)
    assert preview_move(api, base, stop, page["id"], 0).status_code == 409
    assert preview_move(api, foreign, stop, foreign_page["id"], 0).status_code == 404
    assert preview_remove(api, foreign, page).status_code == 404
    assert preview_remove(api, base, page, foreign_page["id"]).status_code == 404
    assert preview_remove(api, base, page, page["id"]).status_code == 409
    assert state(api, base) == before


def test_changed_preview_is_rejected_atomically_and_noop_move_does_not_write(api):
    base = profile(api)
    page = group(api, base, "A")
    block = touch(api, base, "Maman")
    prepared = preview_move(api, base, block, page["id"], 0).json()
    touch(api, base, "Papa")
    before = state(api, base)
    assert move(api, base, block, prepared).status_code == 409 and state(api, base) == before
    fresh = preview_move(api, base, block, page["id"], 0).json()
    move(api, base, block, fresh).raise_for_status()
    prepared = preview_remove(api, base, page).json()
    api.patch(
        base + "/keyboard-groups/" + page["id"],
        json={"label": "Nouveau", "expected_label": "A", "actor_role": "user"},
    ).raise_for_status()
    before = state(api, base)
    assert remove(api, base, page, prepared).status_code == 409 and state(api, base) == before
    assert (
        api.patch(
            base + "/keyboard-groups/" + page["id"],
            json={"label": "Écrasement", "expected_label": "A", "actor_role": "user"},
        ).status_code
        == 409
    )
    prepared = preview_move(api, base, block, page["id"], 0).json()
    assert move(api, base, block, prepared).status_code == 200 and state(api, base) == before


def test_late_archive_audit_failure_rolls_back_all_transfers(api, monkeypatch):
    base = profile(api)
    page = group(api, base, "A")
    block = touch(api, base, "Maman")
    touch(api, base, "Livre")
    place(api, base, block, page["id"], position=1).raise_for_status()
    preview = preview_remove(api, base, page).json()
    before = state(api, base)
    original = PostgresPCLRepository.audit

    def fail(self, profile_id, event_type, *args, **kwargs):
        if event_type == "keyboard_group_archived":
            raise RuntimeError("Synthetic late audit failure")
        return original(self, profile_id, event_type, *args, **kwargs)

    monkeypatch.setattr(PostgresPCLRepository, "audit", fail)
    with pytest.raises(RuntimeError, match="Synthetic late"):
        remove(api, base, page, preview)
    assert state(api, base) == before


def test_page_changes_preserve_completed_sequence_and_interpretation(api):
    base = profile(api)
    page = group(api, base, "A")
    block = touch(api, base, "Livre")
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + "/sequences/" + sequence["id"]
    for _ in range(2):
        api.post(
            path + "/selection", json={"action": "append", "block_id": block["id"]}
        ).raise_for_status()
    api.post(path + "/selection", json={"action": "complete"}).raise_for_status()
    item = api.post(path + "/interpret", json={}).json()["candidates"][0]
    api.post(
        base + "/interpretations/" + item["id"] + "/feedback",
        json={"action": "correct", "corrected_value": "Lire mon livre", "actor_role": "user"},
    ).raise_for_status()
    memory = api.get(base + "/memory").json()
    preview = preview_move(api, base, block, page["id"], 2).json()
    move(api, base, block, preview).raise_for_status()
    remove(api, base, page, preview_remove(api, base, page).json()).raise_for_status()
    assert api.get(base + "/memory").json() == memory
    assert api.get(path).json()["block_ids"] == [block["id"], block["id"]]


def test_v3_archive_preserves_chosen_order_archived_name_reuse_and_references(api):
    base = profile(api)
    first, second, third = [group(api, base, label) for label in ("A", "B", "C")]
    block = touch(api, base, "Maman")
    place(api, base, block, first["id"]).raise_for_status()
    ids = [third["id"], second["id"], first["id"]]
    api.put(
        base + "/keyboard-groups/order",
        json={
            "group_ids": ids,
            "expected_group_ids": [first["id"], second["id"], third["id"]],
            "actor_role": "user",
        },
    ).raise_for_status()
    remove(
        api, base, first, preview_remove(api, base, first, second["id"]).json()
    ).raise_for_status()
    group(api, base, "A")
    snapshot = api.get(base + "/backup").json()
    assert snapshot["version"] == 3
    restored = api.post("/api/v1/profiles/restore", json=restore_body(snapshot))
    assert restored.status_code == 201, restored.text
    target = "/api/v1/profiles/" + restored.json()["id"]
    assert [g["label"] for g in api.get(target + "/keyboard-groups").json()] == ["C", "B", "A"]
    copy = state(api, target)
    assert len(copy["groups"]) == 4 and sum(g["status"] == "archived" for g in copy["groups"]) == 1
    assert all(
        p["group_id"] not in {g["id"] for g in copy["groups"] if g["status"] == "archived"}
        for p in copy["positions"]
    )
    assert copy["blocks"][0]["label"] == "Maman"
    assert state(api, base) == snapshot["records"]
    invalid = api.get(base + "/backup").json()
    invalid["records"]["positions"][0]["group_id"] = first["id"]
    assert api.post("/api/v1/profiles/restore-preview", json=invalid).status_code == 422


@pytest.mark.parametrize("version", [1, 2])
def test_legacy_page_archives_and_receipts_keep_creation_order_and_digest(api, version):
    base = profile(api)
    pages = [group(api, base, label) for label in ("A", "B", "C")]
    block = touch(api, base, "Livre")
    place(api, base, block, pages[0]["id"]).raise_for_status()
    old = api.get(base + "/backup").json()
    old["version"] = version
    for g in old["records"]["groups"]:
        g.pop("sort_order")
        g.pop("status")
    if version == 1:
        for item in old["records"]["interpretations"]:
            item.pop("shortcut")
    body = restore_body(old)
    restored = api.post("/api/v1/profiles/restore", json=body)
    assert restored.status_code == 201, restored.text
    target = "/api/v1/profiles/" + restored.json()["id"]
    assert [g["label"] for g in api.get(target + "/keyboard-groups").json()] == ["A", "B", "C"]
    canonical = parse_restore(json.dumps(body).encode()).model_dump(mode="json")
    for g in canonical["snapshot"]["records"]["groups"]:
        g.pop("sort_order")
        g.pop("status")
    if version == 1:
        for item in canonical["snapshot"]["records"]["interpretations"]:
            item.pop("shortcut")
    expected = hashlib.sha256(
        json.dumps(
            canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        ).encode()
    ).hexdigest()
    with api.app.state.pcl_units.factory() as session:
        assert session.get(ProfileRestoreRow, UUID(body["request_id"])).payload_digest == expected
    with api.app.state.pcl_units() as store:
        store.purge(UUID(restored.json()["id"]))
    assert api.post("/api/v1/profiles/restore", json=body).json()["id"] == restored.json()["id"]
    assert api.get(target + "/keyboard-groups").json() == []


def test_migration_preserves_creation_order_and_refuses_lossy_downgrade(postgres_connection):
    config = migration_config(postgres_connection)
    command.downgrade(config, "0009_explicit_phrase_shortcuts")
    profile_id = postgres_connection.exec_driver_sql(
        "INSERT INTO user_communication_profile(id,version,created_at,updated_at) "
        "VALUES(gen_random_uuid(),1,now(),now()) RETURNING id"
    ).scalar()
    ids = []
    for label in ("A", "B"):
        ids.append(
            postgres_connection.exec_driver_sql(
                "INSERT INTO keyboard_group(id,profile_id,label,created_at,updated_at) "
                "VALUES(gen_random_uuid(),%s,%s,now(),now()) RETURNING id",
                (profile_id, label),
            ).scalar()
        )
    previous = (
        postgres_connection.exec_driver_sql("SELECT id FROM keyboard_group ORDER BY created_at,id")
        .scalars()
        .all()
    )
    command.upgrade(config, "head")
    assert (
        postgres_connection.exec_driver_sql(
            "SELECT id FROM keyboard_group ORDER BY sort_order,created_at,id"
        )
        .scalars()
        .all()
        == previous
    )
    assert (
        postgres_connection.exec_driver_sql("SELECT DISTINCT status FROM keyboard_group").scalar()
        == "active"
    )
    postgres_connection.exec_driver_sql(
        "UPDATE keyboard_group SET status='archived' WHERE id=%s", (ids[0],)
    )
    with pytest.raises(RuntimeError, match="Retain chosen"):
        command.downgrade(config, "0009_explicit_phrase_shortcuts")


def test_photo_adaptive_zone_and_semantic_records_survive_removal_without_ai(api, monkeypatch):
    base, _ = fixture_archive(api)
    page = api.get(base + "/keyboard-groups").json()[0]
    profile_id = UUID(base.rsplit("/", 1)[1])
    adaptive = CommunicationBlock(
        profile_id=profile_id,
        canonical_intent="Phrase fictive",
        label="Raccourci fictif",
        origin=BlockOrigin.PCL_SUGGESTION,
        status=ProposalStatus.VALIDATED,
    )
    with api.app.state.pcl_units() as store:
        store.add(profile_id, adaptive)
        store.feedback(
            ValidationEvent(
                profile_id=profile_id,
                target_type=TargetType.COMMUNICATION_BLOCK,
                target_id=adaptive.id,
                action=ValidationAction.CONFIRM,
            )
        )
    place(
        api, base, {"id": str(adaptive.id)}, page["id"], zone="adaptive", position=3
    ).raise_for_status()
    before = state(api, base)

    def forbidden(*args, **kwargs):
        raise AssertionError("Organization must not invoke the provider")

    monkeypatch.setattr(api.app.state.ai_provider, "interpret", forbidden)
    prepared = preview_remove(api, base, page).json()
    adaptive_move = next(m for m in prepared["moves"] if m["block"]["id"] == str(adaptive.id))
    assert adaptive_move["after"]["zone"] == "adaptive"
    remove(api, base, page, prepared).raise_for_status()
    after = state(api, base)
    for collection in (
        "concepts",
        "representations",
        "blocks",
        "relations",
        "sequences",
        "interpretations",
        "gaps",
        "photos",
        "validations",
    ):
        assert after[collection] == before[collection]
    assert all(p["group_id"] is None for p in after["positions"])


def test_unrepresentable_destination_is_rejected_before_any_transfer(api):
    base = profile(api)
    source, destination = group(api, base, "A"), group(api, base, "B")
    block, other = touch(api, base, "Maman"), touch(api, base, "Eau")
    place(api, base, block, source["id"]).raise_for_status()
    place(api, base, other, destination["id"], position=2_147_483_647).raise_for_status()
    before = state(api, base)
    assert preview_move(api, base, block, destination["id"], 2_147_483_648).status_code == 422
    assert preview_remove(api, base, source, destination["id"]).status_code == 409
    assert state(api, base) == before
