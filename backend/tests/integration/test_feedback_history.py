"""Human evidence reads never promote state or infer missing historical roles."""

from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.api.application import create_app
from app.config import Settings
from app.domain.pcl.entities import (
    CommunicationBlock,
    Concept,
    RelationType,
    SemanticRelation,
    TargetType,
    ValidationAction,
    ValidationEvent,
    utc_now,
)
from app.infrastructure.postgres.models import ValidationRow
from app.infrastructure.postgres.pcl_repository import PostgresPCLUnits

pytestmark = pytest.mark.postgres


@pytest.fixture
def api(postgres_connection):
    factory = sessionmaker(
        bind=postgres_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    app = create_app(
        Settings(
            environment="test",
            database_url=None,
            redis_url=None,
            ai_provider="disabled",
            _env_file=None,
        )
    )
    with TestClient(app) as client:
        app.state.pcl_units = PostgresPCLUnits(factory)
        yield client


def target(api):
    profile = api.post("/api/v1/profiles").json()
    base = "/api/v1/profiles/" + profile["id"]
    block = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Livre",
            "pictogram_key": "book",
            "actor_role": "user",
        },
    ).json()
    return UUID(profile["id"]), base, UUID(block["id"])


def query(base, object_id, **values):
    return base + "/feedback", {
        "target_type": "communication_block",
        "target_id": str(object_id),
        **values,
    }


def test_actual_feedback_is_read_only_redacted_and_keeps_unknown_role(api):
    profile_id, base, block_id = target(api)
    resources = ("memory", "memory?validated=false", "audit", "blocks", "representations")
    with api.app.state.pcl_units() as store:
        store.session.add(
            ValidationRow(
                profile_id=profile_id,
                target_type="communication_block",
                target_id=block_id,
                communication_block_id=block_id,
                action="correct",
                corrected_value={"text": "Mon livre"},
                actor_role=None,
                actor_reference="Private actor reference",
            )
        )
    before = {resource: api.get(base + "/" + resource).json() for resource in resources}
    path, params = query(base, block_id)
    response = api.get(path, params=params)
    assert response.status_code == 200
    event = response.json()["items"][0]
    assert event["actor_role"] is None and event["corrected_value"] == "Mon livre"
    assert "actor_reference" not in event and "Private actor reference" not in response.text
    assert response.json()["next_cursor"] is None
    assert {resource: api.get(base + "/" + resource).json() for resource in resources} == before
    assert api.get(base + "/keyboard").json() == []


def test_pagination_ties_are_stable_and_newer_decisions_do_not_repeat_old_pages(api):
    profile_id, base, block_id = target(api)
    at = utc_now()
    with api.app.state.pcl_units() as store:
        for number in range(1, 8):
            store.feedback(
                ValidationEvent(
                    id=UUID(int=number),
                    profile_id=profile_id,
                    target_type=TargetType.COMMUNICATION_BLOCK,
                    target_id=block_id,
                    action=ValidationAction.CONFIRM,
                    created_at=at,
                )
            )
    path, params = query(base, block_id, limit=3)
    first = api.get(path, params=params).json()
    assert [UUID(v["id"]).int for v in first["items"]] == [7, 6, 5]
    with api.app.state.pcl_units() as store:
        store.feedback(
            ValidationEvent(
                id=UUID(int=8),
                profile_id=profile_id,
                target_type=TargetType.COMMUNICATION_BLOCK,
                target_id=block_id,
                action=ValidationAction.CONFIRM,
                created_at=at + timedelta(seconds=1),
            )
        )
    second = api.get(path, params={**params, "before": first["next_cursor"]}).json()
    assert [UUID(v["id"]).int for v in second["items"]] == [4, 3, 2]
    third = api.get(path, params={**params, "before": second["next_cursor"]}).json()
    assert [UUID(v["id"]).int for v in third["items"]] == [1]
    assert third["next_cursor"] is None


def test_scope_includes_target_type_and_cursor_not_just_a_shared_uuid(api):
    profile_id, base, block_id = target(api)
    foreign_id, foreign, foreign_block = target(api)
    with api.app.state.pcl_units() as store:
        concept = store.get(profile_id, CommunicationBlock, block_id).concept_id
        other = Concept(profile_id=profile_id, label="Lire", canonical_key="READ")
        store.add(profile_id, other)
        relation = SemanticRelation(
            id=block_id,
            profile_id=profile_id,
            source_concept_id=concept,
            target_concept_id=other.id,
            relation_type=RelationType.ASSOCIATED_WITH,
            confidence=0.7,
        )
        store.add(profile_id, relation)
        relation_event = ValidationEvent(
            profile_id=profile_id,
            target_type=TargetType.SEMANTIC_RELATION,
            target_id=block_id,
            action=ValidationAction.CONFIRM,
        )
        store.feedback(relation_event)
    path, params = query(base, block_id)
    assert api.get(path, params=params).json() == {"items": [], "next_cursor": None}
    response = api.get(path, params={**params, "target_type": "semantic_relation"})
    assert response.json()["items"][0]["id"] == str(relation_event.id)
    assert api.get(path, params={**params, "before": str(relation_event.id)}).status_code == 404
    assert api.get(foreign + "/feedback", params=params).status_code == 404
    assert api.get(path, params={**params, "before": str(uuid4())}).status_code == 404
    # A cursor from another target/profile must never grant access to its evidence.
    foreign_path, foreign_params = query(foreign, foreign_block)
    assert (
        api.get(
            foreign_path, params={**foreign_params, "before": str(relation_event.id)}
        ).status_code
        == 404
    )


def test_confirmed_corrected_message_evidence_uses_the_real_human_roles(api):
    profile_id, base, block_id = target(api)
    api.post(
        base + "/blocks/" + str(block_id) + "/feedback",
        json={"action": "confirm", "actor_role": "caregiver", "confirm_representation": True},
    ).raise_for_status()
    seq = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    selection = base + "/sequences/" + seq["id"] + "/selection"
    api.post(selection, json={"action": "append", "block_id": str(block_id)}).raise_for_status()
    api.post(selection, json={"action": "complete"}).raise_for_status()
    result = api.post(base + "/sequences/" + seq["id"] + "/interpret", json={}).json()
    item = result["candidates"][0]
    feedback = base + "/interpretations/" + item["id"] + "/feedback"
    api.post(
        feedback,
        json={
            "action": "correct",
            "corrected_value": "Lire mon livre",
            "actor_role": "professional",
        },
    ).raise_for_status()
    memory = api.get(base + "/memory").json()
    assert memory["interpretations"][0]["corrected_text"] == "Lire mon livre"
    response = api.get(
        base + "/feedback", params={"target_type": "interpretation", "target_id": item["id"]}
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["actor_role"] == "professional"
    assert response.json()["items"][0]["action"] == "correct"
    assert api.get(base + "/memory").json() == memory


@pytest.mark.parametrize(
    "values",
    [
        {"limit": 0},
        {"limit": 101},
        {"limit": "bad"},
        {"target_type": "concept"},
        {"target_id": "Private invalid ID"},
        {"before": "Private invalid cursor"},
    ],
)
def test_invalid_queries_are_bounded_and_do_not_echo_input(api, values):
    _, base, block_id = target(api)
    path, params = query(base, block_id, **values)
    response = api.get(path, params=params)
    assert response.status_code == 422 and "Private" not in response.text
