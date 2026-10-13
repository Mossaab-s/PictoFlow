import base64
from datetime import datetime
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.api.application import create_app
from app.application.photos import PhotoAsset
from app.config import Settings
from app.infrastructure.postgres.models import PhotoAssetRow
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


def photo_body(color="red", **values):
    output = BytesIO()
    Image.new("RGB", (64, 32), color).save(output, "PNG")
    return {
        "request_id": str(uuid4()),
        "label": "Maman",
        "actor_role": "user",
        "photo_base64": base64.b64encode(output.getvalue()).decode(),
        **values,
    }


def profile(api):
    return "/api/v1/profiles/" + api.post("/api/v1/profiles").json()["id"]


def confirm(api, base, block):
    return api.post(
        base + "/blocks/" + block["id"] + "/feedback",
        json={"action": "confirm", "actor_role": "caregiver", "confirm_representation": True},
    )


def media(base, block):
    return base + "/representations/" + block["representation_id"] + "/photo"


def count_photos(api):
    with api.app.state.pcl_units.factory() as session:
        return session.scalar(select(func.count()).select_from(PhotoAssetRow))


def same_block(actual, expected):
    dates = ("created_at", "updated_at")
    assert {k: v for k, v in actual.items() if k not in dates} == {
        k: v for k, v in expected.items() if k not in dates
    }
    for key in dates:
        assert datetime.fromisoformat(actual[key]) == datetime.fromisoformat(expected[key])


def test_photo_proposal_validation_retries_and_profile_isolation(api):
    base, foreign = profile(api), profile(api)
    body = photo_body()
    created = api.post(base + "/blocks/photo", json=body)
    assert created.status_code == 201
    block = created.json()
    assert block["status"] == "proposed" and api.get(base + "/keyboard").json() == []
    response = api.get(media(base, block))
    assert response.status_code == 200 and response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    with Image.open(BytesIO(response.content)) as image:
        assert image.size == (64, 32)
    assert api.get(media(foreign, block)).status_code == 404
    assert api.delete(media(foreign, block), params={"actor_role": "user"}).status_code == 404
    assert (
        api.put(
            foreign + "/blocks/" + block["id"] + "/photo",
            json={k: v for k, v in body.items() if k != "label"},
        ).status_code
        == 404
    )
    audit_before = api.get(base + "/audit").json()
    same_block(api.post(base + "/blocks/photo", json=body).json(), block)
    assert api.get(base + "/audit").json() == audit_before and count_photos(api) == 1
    assert api.post(base + "/blocks/photo", json={**body, "label": "Papa"}).status_code == 400
    assert confirm(api, base, block).status_code == 200
    visuals = api.get(base + "/representations").json()
    assert visuals[0]["type"] == "photo" and visuals[0]["status"] == "validated"
    assert api.delete(media(base, block), params={"actor_role": "user"}).status_code == 400
    assert count_photos(api) == 1


def test_photo_replacement_preserves_stable_place_and_deletion_keeps_history(api):
    base = profile(api)
    block = api.post(base + "/blocks/photo", json=photo_body()).json()
    assert confirm(api, base, block).status_code == 200
    placement = {"zone": "stable", "position": 3, "actor_role": "user"}
    api.put(base + "/keyboard/" + block["id"], json=placement).raise_for_status()
    keyboard = api.get(base + "/keyboard").json()
    new = photo_body("blue")
    new.pop("label")
    route = base + "/blocks/" + block["id"] + "/photo"
    replacement = api.put(route, json=new)
    assert replacement.status_code == 200
    current = replacement.json()
    assert (current["label"], current["concept_id"], current["stability"]) == (
        block["label"],
        block["concept_id"],
        "stable",
    )
    assert api.get(base + "/keyboard").json() == keyboard
    audit = api.get(base + "/audit").json()
    same_block(api.put(route, json=new).json(), current)
    assert api.get(base + "/audit").json() == audit and count_photos(api) == 2
    assert (
        api.get(media(base, block)).status_code == 200
    )  # Old photo remains until explicit removal.
    assert api.delete(media(base, block), params={"actor_role": "user"}).status_code == 204
    assert api.get(media(base, block)).status_code == 404
    assert api.get(media(base, current)).status_code == 200 and count_photos(api) == 1
    assert len(api.get(base + "/representations").json()) == 2
    assert api.get(base + "/audit").json()[-1]["event_type"] == "photo_removed"
    assert api.delete(base + "/memory").status_code == 204 and count_photos(api) == 0


def test_photo_upload_is_atomic_when_media_storage_fails(api, monkeypatch):
    base = profile(api)
    from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository

    original = PostgresPCLRepository.add

    def fail_asset(self, profile_id, value):
        if isinstance(value, PhotoAsset):
            raise RuntimeError("injected media write failure")
        return original(self, profile_id, value)

    monkeypatch.setattr(PostgresPCLRepository, "add", fail_asset)
    with pytest.raises(RuntimeError, match="injected"):
        api.post(base + "/blocks/photo", json=photo_body())
    for resource in ("concepts", "blocks", "representations", "audit"):
        assert api.get(base + "/" + resource).json() == []
    assert count_photos(api) == 0


def test_photo_uses_existing_scoped_concept_and_rejects_forged_references(api):
    base, foreign = profile(api), profile(api)
    concept = api.post(
        base + "/concepts", json={"canonical_key": "MOTHER", "label": "Maman"}
    ).json()
    body = photo_body(concept_id=concept["id"])
    assert api.post(foreign + "/blocks/photo", json=body).status_code == 404
    assert api.get(foreign + "/blocks").json() == []
    block = api.post(base + "/blocks/photo", json=body).json()
    assert block["concept_id"] == concept["id"] and len(api.get(base + "/concepts").json()) == 1
    assert (
        api.patch(
            base + "/representations/" + block["representation_id"],
            json={"asset_reference": "https://external.test/private.jpg"},
        ).status_code
        == 400
    )
    assert (
        api.post(
            base + "/representations",
            json={
                "concept_id": concept["id"],
                "type": "photo",
                "source": "personal-photo",
                "asset_reference": "photo:" + str(uuid4()),
            },
        ).status_code
        == 400
    )
    assert api.get(media(base, block)).status_code == 200


def test_photo_replacement_rolls_back_pixels_and_attachment_when_validation_fails(api, monkeypatch):
    from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository

    base = profile(api)
    block = api.post(base + "/blocks/photo", json=photo_body()).json()
    assert confirm(api, base, block).status_code == 200
    audit = api.get(base + "/audit").json()
    visuals = api.get(base + "/representations").json()

    def fail_validation(self, event):
        raise RuntimeError("injected validation failure")

    monkeypatch.setattr(PostgresPCLRepository, "feedback", fail_validation)
    body = photo_body("blue")
    body.pop("label")
    with pytest.raises(RuntimeError, match="injected validation"):
        api.put(base + "/blocks/" + block["id"] + "/photo", json=body)
    assert count_photos(api) == 1
    assert api.get(base + "/representations").json() == visuals
    assert api.get(base + "/audit").json() == audit
    assert api.get(base + "/blocks").json()[0]["representation_id"] == block["representation_id"]


def test_photo_errors_are_redacted_and_do_not_create_semantics(api):
    schema = api.get("/openapi.json").json()["paths"]["/api/v1/profiles/{profile_id}/blocks/photo"][
        "post"
    ]["requestBody"]["content"]["application/json"]["schema"]
    assert schema["properties"]["actor_role"]["enum"] == ["user", "caregiver", "professional"]
    base = profile(api)
    body = photo_body(photo_base64="PRIVATE_INVALID_DATA!")
    response = api.post(base + "/blocks/photo", json=body)
    assert response.status_code == 422 and "PRIVATE_INVALID_DATA" not in response.text
    assert api.get(base + "/concepts").json() == [] and count_photos(api) == 0
    oversized = api.post(
        base + "/blocks/photo",
        content=b"a" * (7 * 1024 * 1024),
        headers={"Content-Type": "application/json"},
    )
    assert oversized.status_code == 413
    absent = photo_body()
    assert (
        api.post("/api/v1/profiles/" + str(uuid4()) + "/blocks/photo", json=absent).status_code
        == 404
    )
    assert count_photos(api) == 0


def test_downgrade_refuses_to_discard_stored_photo_pixels(api, postgres_connection):
    from alembic import command

    from tests.integration.conftest import migration_config

    base = profile(api)
    block = api.post(base + "/blocks/photo", json=photo_body()).json()
    with (
        pytest.raises(RuntimeError, match="Remove personal photos explicitly"),
        postgres_connection.begin_nested(),
    ):
        command.downgrade(migration_config(postgres_connection), "0004_gap_blocks_keyboard")
    assert api.get(media(base, block)).status_code == 200 and count_photos(api) == 1


def test_repository_scopes_binary_media_reads(api):
    base, foreign = profile(api), profile(api)
    block = api.post(base + "/blocks/photo", json=photo_body()).json()
    from app.application.semantic_space import SemanticNotFoundError

    with api.app.state.pcl_units() as store:
        assert store.get(UUID(base.rsplit("/", 1)[1]), PhotoAsset, UUID(block["representation_id"]))
    with api.app.state.pcl_units() as store:
        with pytest.raises(SemanticNotFoundError):
            store.get(UUID(foreign.rsplit("/", 1)[1]), PhotoAsset, UUID(block["representation_id"]))
