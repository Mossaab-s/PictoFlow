import json
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.application import create_app
from app.application.profile_archive import (
    MAX_ARCHIVE_BYTES,
    ArchiveError,
    ArchiveTooLarge,
    ProfileArchive,
    Records,
    parse_archive,
    parse_restore,
    remap_archive,
)
from app.config import Settings
from app.domain.pcl.audit import SemanticAuditEvent
from app.domain.pcl.entities import (
    Concept,
    Representation,
    RepresentationType,
    TargetType,
    UserCommunicationProfile,
    utc_now,
)


@pytest.fixture
def archive():
    profile = UserCommunicationProfile(display_name="Fictif")
    concept = Concept(
        profile_id=profile.id, label="Mot " + str(profile.id), canonical_key="EXAMPLE"
    )
    event = SemanticAuditEvent(
        id=uuid4(),
        profile_id=profile.id,
        target_type=TargetType.CONCEPT,
        target_id=concept.id,
        event_type="concept_created",
        source="human:user",
        created_at=utc_now(),
        previous_state=None,
        new_state=json.dumps(
            {"id": str(concept.id), "profile_id": str(profile.id), "label": concept.label}
        ),
    )
    records = {key: () for key in Records.model_fields}
    records.update(concepts=(concept,), audit=(event,))
    return ProfileArchive(
        format="pictoflow-profile",
        version=1,
        exported_at=utc_now(),
        profile=profile,
        records=Records(**records),
    )


def test_remap_preserves_uuid_looking_user_words_but_changes_typed_references(archive):
    profile = UserCommunicationProfile()
    restored = remap_archive(archive, profile)
    assert restored.records.concepts[0].label == archive.records.concepts[0].label
    state = json.loads(restored.records.audit[0].new_state)
    assert state["label"] == archive.records.concepts[0].label
    assert state["id"] == str(restored.records.concepts[0].id)
    assert state["profile_id"] == str(profile.id)


@pytest.mark.parametrize(
    "reference", ["photo:external-reference", "https://external.test/image.jpg"]
)
def test_external_asset_references_are_preserved_without_becoming_managed_photos(
    archive, reference
):
    visual = Representation(
        profile_id=archive.profile.id,
        concept_id=archive.records.concepts[0].id,
        type=RepresentationType.PHOTO,
        source="external",
        asset_reference=reference,
    )
    records = archive.records.model_copy(update={"representations": (visual,)})
    source = parse_archive(
        archive.model_copy(update={"records": records}).model_dump_json().encode()
    )
    assert (
        remap_archive(source, UserCommunicationProfile()).records.representations[0].asset_reference
        == reference
    )


@pytest.mark.parametrize(
    "mutation",
    [
        lambda x: x.update(version=4),
        lambda x: x.update(version=True),
        lambda x: x.update(api_key="Private input"),
        lambda x: x["records"].pop("blocks"),
        lambda x: x["records"]["concepts"][0].update(profile_id=str(uuid4())),
        lambda x: x["records"]["concepts"][0].update(api_key="Private input"),
        lambda x: x["records"]["concepts"][0].pop("status"),
        lambda x: x["profile"].pop("version"),
        lambda x: x["records"]["concepts"].append(x["records"]["concepts"][0]),
        lambda x: x["records"]["audit"][0].update(target_id=str(uuid4())),
    ],
)
def test_invalid_snapshots_are_rejected_before_writes(archive, mutation):
    value = archive.model_dump(mode="json")
    mutation(value)
    with pytest.raises(ArchiveError):
        parse_archive(json.dumps(value).encode())


@pytest.mark.parametrize(
    "body",
    [
        b'{"format":"pictoflow-profile","format":"other"}',
        b'{"bad":NaN}',
        b'{"bad":Infinity}',
        b'{"bad":"\xff"}',
        b"[]",
        b"{" + b'"x":[' * 70 + b"0",
    ],
)
def test_untrusted_json_never_silently_reinterprets_input(body):
    with pytest.raises(ArchiveError):
        parse_archive(body)


@pytest.mark.parametrize("confirmation", [False, 1, "true", None])
def test_restore_requires_boolean_human_confirmation(archive, confirmation):
    body = {
        "request_id": str(uuid4()),
        "actor_role": "user",
        "confirm": confirmation,
        "display_name": None,
        "snapshot": archive.model_dump(mode="json"),
    }
    with pytest.raises(ArchiveError):
        parse_restore(json.dumps(body).encode())


def test_corrupt_historical_references_are_rejected(archive):
    event = archive.records.audit[0]
    changed = replace(event, new_state=json.dumps({"profile_id": str(uuid4())}))
    records = archive.records.model_copy(update={"audit": (changed,)})
    with pytest.raises(ArchiveError):
        remap_archive(archive.model_copy(update={"records": records}), UserCommunicationProfile())


def test_preview_is_read_only_without_database_ai_or_redis_and_errors_are_redacted(archive):
    with TestClient(
        create_app(
            Settings(
                environment="test",
                database_url=None,
                redis_url=None,
                ai_provider="disabled",
                _env_file=None,
            )
        )
    ) as client:
        response = client.post(
            "/api/v1/profiles/restore-preview",
            content=archive.model_dump_json(),
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 200
        assert "Mot" not in response.text and "photo_base64" not in response.text
        assert (
            client.get("/api/v1/profiles/" + str(archive.profile.id) + "/backup").status_code == 503
        )
        for content in (b'{"Private input":42}', b'{"Private input":NaN}'):
            response = client.post(
                "/api/v1/profiles/restore-preview",
                content=content,
                headers={"content-type": "application/json"},
            )
            assert response.status_code == 422 and "Private input" not in response.text
        assert client.post("/api/v1/profiles/restore-preview", content="text").status_code == 415


def test_request_limits_apply_without_a_trustworthy_content_length(monkeypatch):
    import app.api.profile_archives as routes

    monkeypatch.setattr(routes, "MAX_ARCHIVE_BYTES", 8)
    with TestClient(
        create_app(
            Settings(
                environment="test",
                database_url=None,
                redis_url=None,
                ai_provider="disabled",
                _env_file=None,
            )
        )
    ) as client:
        for headers in ({}, {"content-length": "1"}):
            response = client.post(
                "/api/v1/profiles/restore-preview",
                content=(chunk for chunk in (b"12345", b"67890")),
                headers={"content-type": "application/json", **headers},
            )
            assert response.status_code == 413
            assert response.headers["connection"] == "close"
    with pytest.raises(ArchiveTooLarge):
        parse_archive(b" " * (MAX_ARCHIVE_BYTES + 1))
