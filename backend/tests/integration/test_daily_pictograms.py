from uuid import UUID, uuid4

import pytest

from app.application.profile_archive import RestoreRequest, parse_archive
from app.domain.pcl.entities import HumanRole
from app.infrastructure.postgres.profile_archives import PostgresProfileArchives
from tests.integration.test_business_api import api as api

pytestmark = pytest.mark.postgres


def test_new_daily_drawings_remain_proposals_until_chosen_and_survive_backup(api):
    profile = api.post("/api/v1/profiles").json()["id"]
    foreign = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    original = api.get(base + "/keyboard").json()
    chosen = []
    for key, label in [
        ("me", "Moi"),
        ("apple", "Pomme"),
        ("wash_hands", "Laver les mains"),
        ("socks", "Chaussettes"),
        ("stomach", "Ventre"),
        ("bus", "Bus"),
        ("tomorrow", "Demain"),
    ]:
        body = {
            "request_id": str(uuid4()),
            "label": label,
            "pictogram_key": key,
            "actor_role": "user",
        }
        response = api.post(base + "/blocks/personal", json=body)
        assert response.status_code == 201
        block = response.json()
        assert block["status"] == "proposed"
        assert api.get(base + "/keyboard").json() == original
        retried = api.post(base + "/blocks/personal", json=body).json()
        assert retried["id"] == block["id"]
        assert retried["representation_id"] == block["representation_id"]
        chosen.append(block)
    for block in chosen:
        api.post(
            base + "/blocks/" + block["id"] + "/feedback",
            json={
                "action": "confirm",
                "actor_role": "user",
                "confirm_representation": True,
            },
        ).raise_for_status()
    assert len(api.get(base + "/keyboard").json()) == len(chosen)
    visuals = api.get(base + "/representations").json()
    refs = {item["asset_reference"] for item in visuals}
    assert refs == {
        f"pictoflow:pictogram:v1:{key}"
        for key in ("me", "apple", "wash_hands", "socks", "stomach", "bus", "tomorrow")
    }
    assert all(
        item["source"] == "pictoflow-builtin-v1" and item["status"] == "validated"
        for item in visuals
    )
    assert api.get(f"/api/v1/profiles/{foreign}/representations").json() == []
    assert api.get(base + "/memory").json()["interpretations"] == []
    snapshot = api.get(base + "/communication-snapshot").json()
    assert {r["asset_reference"] for r in snapshot["representations"]} == refs
    archives = PostgresProfileArchives(api.app.state.pcl_units.factory)
    restored = archives.restore(
        RestoreRequest(
            request_id=uuid4(),
            actor_role=HumanRole.USER,
            confirm=True,
            display_name="Pictogrammes fictifs restaurés",
            snapshot=parse_archive(archives.export(UUID(profile))),
        )
    )
    restored_visuals = api.get(f"/api/v1/profiles/{restored.id}/representations").json()
    assert {r["asset_reference"] for r in restored_visuals} == refs
    assert all(r["profile_id"] == str(restored.id) for r in restored_visuals)
