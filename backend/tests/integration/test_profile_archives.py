"""Backup/restore exercises actual PostgreSQL FK, history and media contracts."""

import base64
import hashlib
import json
from dataclasses import replace
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from alembic import command
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.api.application import create_app
from app.application.profile_archive import parse_archive, remap_archive
from app.config import Settings
from app.domain.pcl.entities import (
    CommunicationSequence,
    Interpretation,
    InterpretationStatus,
    RelationStatus,
    RelationType,
    SemanticRelation,
    TargetType,
    ValidationAction,
    ValidationEvent,
)
from app.domain.pcl.gaps import SemanticGapCandidate, sequence_signature
from app.infrastructure.postgres.models import ProfileRestoreRow, ProfileRow, ValidationRow
from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository, PostgresPCLUnits
from app.infrastructure.postgres.profile_archives import PostgresProfileArchives
from app.infrastructure.postgres.repositories import PostgresProfileRepository
from tests.integration.conftest import migration_config

pytestmark = pytest.mark.postgres


@pytest.fixture
def api(postgres_connection):
    factory = sessionmaker(
        bind=postgres_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    app = create_app(Settings(environment="test", ai_provider="disabled", _env_file=None))
    with TestClient(app) as client:
        app.state.pcl_units = PostgresPCLUnits(factory)
        yield client


def fixture_archive(api):
    source = api.post("/api/v1/profiles", json={"display_name": "Exemple sauvegarde"}).json()
    base = "/api/v1/profiles/" + source["id"]
    output = BytesIO()
    Image.new("RGB", (8, 6), "blue").save(output, "PNG")
    photo = {
        "request_id": str(uuid4()),
        "label": "Maison",
        "actor_role": "user",
        "photo_base64": base64.b64encode(output.getvalue()).decode(),
    }
    block = api.post(base + "/blocks/photo", json=photo).json()
    api.post(
        base + "/blocks/" + block["id"] + "/feedback",
        json={
            "action": "confirm",
            "actor_role": "caregiver",
            "confirm_representation": True,
        },
    ).raise_for_status()
    pending = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Jouet",
            "pictogram_key": "toy",
            "actor_role": "user",
        },
    ).json()
    deleted = api.post(base + "/blocks/photo", json={**photo, "request_id": str(uuid4())}).json()
    api.delete(
        base + "/representations/" + deleted["representation_id"] + "/photo",
        params={"actor_role": "user"},
    ).raise_for_status()
    group = api.post(
        base + "/keyboard-groups", json={"label": "Lieux", "actor_role": "user"}
    ).json()
    api.put(
        base + "/keyboard/" + block["id"],
        json={"zone": "personal", "position": 4, "group_id": group["id"], "actor_role": "user"},
    ).raise_for_status()
    sequence = api.post(
        base + "/sequences", json={"session_id": str(uuid4()), "context_id": str(uuid4())}
    ).json()
    for _ in range(2):
        api.post(
            base + "/sequences/" + sequence["id"] + "/selection",
            json={"action": "append", "block_id": block["id"]},
        ).raise_for_status()
    api.post(
        base + "/sequences/" + sequence["id"] + "/selection", json={"action": "complete"}
    ).raise_for_status()
    profile_id = UUID(source["id"])
    with api.app.state.pcl_units() as store:
        seq = store.get(profile_id, CommunicationSequence, UUID(sequence["id"]))
        corrected = Interpretation(
            profile_id=profile_id,
            sequence_id=seq.id,
            text="Maison",
            corrected_text="Rentrer à la maison",
            confidence=0.7,
            source="pcl",
            status=InterpretationStatus.CORRECTED,
        )
        rejected = replace(corrected, id=uuid4(), status=InterpretationStatus.REJECTED)
        store.add(profile_id, corrected)
        store.add(profile_id, rejected)
        store.feedback(
            ValidationEvent(
                profile_id=profile_id,
                target_type=TargetType.INTERPRETATION,
                target_id=corrected.id,
                action=ValidationAction.CORRECT,
                corrected_value=corrected.corrected_text,
            )
        )
        store.audit(profile_id, "interpretation_corrected", None, corrected, "human:user")
        # Same UUID in two entity tables must be remapped by type, not a global UUID map.
        relation = SemanticRelation(
            id=UUID(block["id"]),
            profile_id=profile_id,
            source_concept_id=UUID(block["concept_id"]),
            target_concept_id=UUID(pending["concept_id"]),
            relation_type=RelationType.ASSOCIATED_WITH,
            confidence=0.8,
            validation_count=1,
            status=RelationStatus.VALIDATED,
        )
        store.add(profile_id, relation)
        store.audit(profile_id, "relation_confirmed", None, relation, "human:user")
        gap = SemanticGapCandidate(
            profile_id=profile_id,
            source_sequence_signature=sequence_signature(seq),
            validated_intent="Rentrer à la maison",
            occurrence_count=5,
            validated_count=4,
        )
        store.add(profile_id, gap)
        store.audit(profile_id, "gap_proposed", None, gap, "pcl")
        # Existing legacy human evidence remains unknown, never fabricated on restore.
        store.session.add(
            ValidationRow(
                profile_id=profile_id,
                target_type="semantic_relation",
                target_id=relation.id,
                semantic_relation_id=relation.id,
                action="confirm",
                actor_role=None,
            )
        )
    download = api.get(base + "/backup")
    assert download.status_code == 200
    return base, download


def restore_body(snapshot, **values):
    return {
        "request_id": str(uuid4()),
        "confirm": True,
        "actor_role": "caregiver",
        "display_name": "Copie exemple",
        "snapshot": snapshot,
        **values,
    }


def comparable(records):
    result = {}
    for name, values in records.collections().items():
        result[name] = {}
        for value in values:
            if name == "audit":
                value = replace(
                    value,
                    previous_state=json.dumps(json.loads(value.previous_state), sort_keys=True)
                    if value.previous_state
                    else None,
                    new_state=json.dumps(json.loads(value.new_state), sort_keys=True)
                    if value.new_state
                    else None,
                )
            result[name][value.id] = value
    return result


def test_roundtrip_preserves_pages_photos_memory_history_and_source(api):
    base, download = fixture_archive(api)
    source = parse_archive(download.content)
    assert "attachment" in download.headers["content-disposition"]
    assert download.headers["cache-control"] == "no-store"
    assert source.records.photos[0].content()
    preview = api.post(
        "/api/v1/profiles/restore-preview",
        content=download.content,
        headers={"content-type": "application/json"},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["counts"]["photos"] == 1
    assert preview.json()["proposed_blocks"] == 2
    assert len(api.get("/api/v1/profiles").json()) == 1
    restored = api.post("/api/v1/profiles/restore", json=restore_body(download.json()))
    assert restored.status_code == 201, restored.text
    identity = PostgresProfileRepository
    with api.app.state.pcl_units.factory() as session:
        profile = identity(session).get_by_id(UUID(restored.json()["id"]))
    target = "/api/v1/profiles/" + str(profile.id)
    actual = parse_archive(api.get(target + "/backup").content)
    expected = remap_archive(source, profile)
    assert comparable(actual.records) == comparable(expected.records)
    assert comparable(parse_archive(api.get(base + "/backup").content).records) == comparable(
        source.records
    )
    assert profile.id != source.profile.id and profile.display_name == "Copie exemple"
    assert actual.records.relations[0].id not in {b.id for b in actual.records.blocks}
    assert any(v.actor_role is None for v in actual.records.validations)
    assert {p.id for p in actual.records.blocks}.isdisjoint(p.id for p in source.records.blocks)
    seq = actual.records.sequences[0]
    assert len(seq.block_ids) == 2 and seq.block_ids[0] == seq.block_ids[1]
    assert actual.records.gaps[0].source_sequence_signature == sequence_signature(seq)
    assert (
        api.get(target + "/representations/" + str(actual.records.photos[0].id) + "/photo").content
        == source.records.photos[0].content()
    )
    assert (
        api.get(
            base + "/representations/" + str(actual.records.photos[0].id) + "/photo"
        ).status_code
        == 404
    )
    assert len(api.get(target + "/keyboard").json()) == 1
    assert (
        api.get(target + "/memory").json()["interpretations"][0]["corrected_text"]
        == "Rentrer à la maison"
    )


def test_retry_is_idempotent_conflicts_are_redacted_and_purge_never_replays_memory(api):
    base, download = fixture_archive(api)
    body = restore_body(download.json())
    first = api.post("/api/v1/profiles/restore", json=body)
    assert first.status_code == 201, first.text
    retry = api.post("/api/v1/profiles/restore", json=body)
    assert retry.status_code == 201 and retry.json()["id"] == first.json()["id"]
    assert len(api.get("/api/v1/profiles").json()) == 2
    conflict = api.post(
        "/api/v1/profiles/restore", json={**body, "display_name": "Private conflict"}
    )
    assert conflict.status_code == 409 and "Private conflict" not in conflict.text
    with api.app.state.pcl_units() as store:
        store.purge(UUID(first.json()["id"]))
    assert api.post("/api/v1/profiles/restore", json=body).json()["id"] == first.json()["id"]
    assert api.get("/api/v1/profiles/" + first.json()["id"] + "/keyboard").json() == []
    assert api.get(base + "/keyboard").json()


def test_restore_rolls_back_profile_rows_photos_and_receipt_on_late_failure(api, monkeypatch):
    _, download = fixture_archive(api)
    original = PostgresPCLRepository.add

    def fail(self, profile_id, value):
        original(self, profile_id, value)
        if isinstance(value, CommunicationSequence):
            raise RuntimeError("Injected interruption")

    monkeypatch.setattr(PostgresPCLRepository, "add", fail)
    from app.application.profile_archive import parse_restore

    service = PostgresProfileArchives(api.app.state.pcl_units.factory)
    with pytest.raises(RuntimeError, match="Injected interruption"):
        service.restore(parse_restore(json.dumps(restore_body(download.json())).encode()))
    with service.factory() as session:
        assert session.scalar(select(func.count()).select_from(ProfileRow)) == 1
        assert session.scalar(select(func.count()).select_from(ProfileRestoreRow)) == 0
    assert len(api.get("/api/v1/profiles").json()) == 1


def test_restore_migration_matches_models_and_preserves_existing_profiles(postgres_connection):
    command.check(migration_config(postgres_connection))
    command.downgrade(migration_config(postgres_connection), "0007_profile_display_names")
    command.upgrade(migration_config(postgres_connection), "head")
    command.check(migration_config(postgres_connection))


@pytest.mark.parametrize(
    "damage",
    [
        "missing-photo",
        "bad-photo-hash",
        "bad-photo-size",
        "corrupt-photo",
        "cross-profile",
        "missing-concept",
        "changed-history-profile",
        "changed-history-target",
        "bad-confirmation",
        "invalid-actor",
        "missing-placement-block",
    ],
)
def test_damaged_restore_never_creates_partial_profile_or_changes_source(api, damage):
    base, download = fixture_archive(api)
    value = download.json()
    body = restore_body(value)
    if damage == "missing-photo":
        value["records"]["photos"] = []
    elif damage == "bad-photo-hash":
        value["records"]["photos"][0]["digest"] = "0" * 64
    elif damage == "bad-photo-size":
        value["records"]["photos"][0]["width"] += 1
    elif damage == "corrupt-photo":
        value["records"]["photos"][0].update(
            content_base64="bm90LWEtcGhvdG8=", digest=hashlib.sha256(b"not-a-photo").hexdigest()
        )
    elif damage == "cross-profile":
        value["records"]["positions"][0]["profile_id"] = str(uuid4())
    elif damage == "missing-concept":
        value["records"]["blocks"][0]["concept_id"] = str(uuid4())
    elif damage in ("changed-history-profile", "changed-history-target"):
        event = value["records"]["audit"][0]
        key = "profile_id" if damage == "changed-history-profile" else "id"
        event["new_state"] = json.dumps({key: str(uuid4())})
    elif damage == "bad-confirmation":
        body["confirm"] = 1
    elif damage == "invalid-actor":
        body["actor_role"] = "provider"
    elif damage == "missing-placement-block":
        value["records"]["positions"][0]["block_id"] = str(uuid4())
    response = api.post("/api/v1/profiles/restore", json=body)
    assert response.status_code == 422, response.text
    assert "Maison" not in response.text
    assert len(api.get("/api/v1/profiles").json()) == 1
    actual = parse_archive(api.get(base + "/backup").content)
    assert comparable(actual.records) == comparable(parse_archive(download.content).records)


def test_source_identity_used_as_request_id_still_creates_a_separate_profile(api):
    profile = api.post("/api/v1/profiles", json={"display_name": "Original"}).json()
    download = api.get("/api/v1/profiles/" + profile["id"] + "/backup")
    response = api.post(
        "/api/v1/profiles/restore",
        json=restore_body(download.json(), request_id=profile["id"], display_name=None),
    )
    assert response.status_code == 201, response.text
    assert response.json()["id"] != profile["id"]
    assert response.json()["display_name"] is None


def test_restore_receipt_blocks_downgrade_without_erasing_profiles(api, postgres_connection):
    source = api.post("/api/v1/profiles").json()
    download = api.get("/api/v1/profiles/" + source["id"] + "/backup")
    api.post("/api/v1/profiles/restore", json=restore_body(download.json())).raise_for_status()
    with pytest.raises(RuntimeError, match="Retain restore receipts"):
        command.downgrade(migration_config(postgres_connection), "0007_profile_display_names")
    assert len(api.get("/api/v1/profiles").json()) == 2


def test_export_stops_at_size_limit_without_mutating_profile(api, monkeypatch):
    base, download = fixture_archive(api)
    import app.infrastructure.postgres.profile_archives as archives

    monkeypatch.setattr(archives, "MAX_ARCHIVE_BYTES", 2048)
    response = api.get(base + "/backup")
    assert response.status_code == 413 and "Maison" not in response.text
    assert len(api.get("/api/v1/profiles").json()) == 1


def test_archiving_an_attached_visual_remains_exportable_without_revalidating_it(api):
    base, download = fixture_archive(api)
    photo = download.json()["records"]["photos"][0]
    api.post(base + "/representations/" + photo["id"] + "/archive").raise_for_status()
    archived = api.get(base + "/backup")
    assert archived.status_code == 200, archived.text
    restored = api.post("/api/v1/profiles/restore", json=restore_body(archived.json()))
    assert restored.status_code == 201, restored.text
    visuals = api.get("/api/v1/profiles/" + restored.json()["id"] + "/representations").json()
    assert sum(v["status"] == "archived" for v in visuals) == 2
