import json
from uuid import uuid4

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.api.application import create_app
from app.config import Settings
from app.infrastructure.postgres.pcl_repository import PostgresPCLUnits

pytestmark = pytest.mark.postgres


@pytest.fixture
def api(postgres_connection):
    factory = sessionmaker(
        bind=postgres_connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    # This scenario exercises literal PCL interpretation, independently of the outer stack's mode.
    app = create_app(
        Settings(environment="test", ai_provider="disabled", database_url=None, _env_file=None)
    )
    with TestClient(app) as client:
        app.state.pcl_units = PostgresPCLUnits(factory)
        yield client


def evolution_fixture(api, profile_id=None):
    p = profile_id or api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{p}"
    block = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Eau",
            "pictogram_key": "water",
            "actor_role": "user",
        },
    ).json()
    api.post(
        base + f"/blocks/{block['id']}/feedback",
        json={"action": "confirm", "actor_role": "user", "confirm_representation": True},
    ).raise_for_status()

    def candidate():
        sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
        for body in (
            {"action": "append", "block_id": block["id"]},
            {"action": "append", "block_id": block["id"]},
            {"action": "complete"},
        ):
            api.post(base + f"/sequences/{sequence['id']}/selection", json=body).raise_for_status()
        value = api.post(base + f"/sequences/{sequence['id']}/interpret", json={}).json()[
            "candidates"
        ][0]
        return value

    return base, candidate


def need_fixture(api):
    base, propose = evolution_fixture(api)
    candidates = [propose() for _ in range(7)]
    for item in candidates[:6]:
        api.post(
            base + f"/interpretations/{item['id']}/feedback",
            json={
                "action": "correct",
                "actor_role": "user",
                "corrected_value": "Je voudrais boire de l’eau.",
            },
        ).raise_for_status()
    needs = api.post(base + "/suggestions/detect").json()
    assert len(needs) == 1
    return base, needs[0], candidates


def test_need_evidence_is_current_bounded_and_read_only(api):
    base, need, candidates = need_fixture(api)
    resources = ("audit", "memory", "keyboard", "suggestions")
    before = {name: api.get(base + "/" + name).json() for name in resources}
    response = api.get(base + f"/suggestions/{need['id']}/evidence")
    assert response.status_code == 200
    value = response.json()
    assert (value["occurrence_count"], value["validated_count"]) == (7, 6)
    assert (value["minimum_occurrences"], value["minimum_validated"]) == (5, 4)
    assert value["eligible"] is True and value["existing_block_match"] is False
    assert len(value["examples"]) == 5
    assert all(
        example["interpretation"]["status"] == "corrected"
        and example["sequence"]["id"] == example["interpretation"]["sequence_id"]
        for example in value["examples"]
    )
    assert {name: api.get(base + "/" + name).json() for name in resources} == before
    for item in candidates[:3]:
        api.post(
            base + f"/interpretations/{item['id']}/feedback",
            json={"action": "reject", "actor_role": "user"},
        ).raise_for_status()
    value = api.get(base + f"/suggestions/{need['id']}/evidence").json()
    assert value["validated_count"] == 3 and value["eligible"] is False
    assert len(value["examples"]) == 3
    assert (
        api.post(
            base + f"/suggestions/{need['id']}/decision",
            json={"approve": True, "actor_role": "user", "expected_status": "proposed"},
        ).status_code
        == 400
    )
    assert api.get(base + "/suggestions").json()[0]["status"] == "proposed"


def test_pending_need_decisions_reject_stale_writes_and_keep_legacy_explicit_changes(api):
    base, need, _ = need_fixture(api)
    path = base + f"/suggestions/{need['id']}/decision"
    response = api.post(
        path, json={"approve": True, "actor_role": "professional", "expected_status": "proposed"}
    )
    assert response.status_code == 200 and response.json()["status"] == "approved"
    before = api.get(base + "/audit").json()
    for approve in (True, False):
        assert (
            api.post(
                path,
                json={"approve": approve, "actor_role": "caregiver", "expected_status": "proposed"},
            ).status_code
            == 409
        )
    assert api.get(base + "/audit").json() == before
    assert (
        api.post(
            path, json={"approve": False, "actor_role": "user", "expected_status": "approved"}
        ).status_code
        == 422
    )
    # Omitting the new precondition preserves existing intentional legacy transitions.
    assert (
        api.post(path, json={"approve": False, "actor_role": "caregiver"}).json()["status"]
        == "rejected"
    )
    other = api.post("/api/v1/profiles").json()["id"]
    assert api.get(f"/api/v1/profiles/{other}/suggestions/{need['id']}/evidence").status_code == 404
    assert (
        api.post(
            f"/api/v1/profiles/{other}/suggestions/{need['id']}/decision",
            json={"approve": True, "actor_role": "user", "expected_status": "proposed"},
        ).status_code
        == 404
    )


def test_meaning_evolution_filters_and_pages_real_decisions_without_mutating_pcl(api):
    base, candidate = evolution_fixture(api)
    accepted, refused, pending = candidate(), candidate(), candidate()
    feedback = base + f"/interpretations/{accepted['id']}/feedback"
    for body in (
        {"action": "confirm", "actor_role": "user"},
        {
            "action": "correct",
            "actor_role": "professional",
            "corrected_value": "Je voudrais de l’eau.",
        },
        {"action": "reject", "actor_role": "caregiver"},
    ):
        api.post(feedback, json=body).raise_for_status()
    api.post(
        base + f"/interpretations/{refused['id']}/feedback",
        json={"action": "reject", "actor_role": "user"},
    ).raise_for_status()
    resources = ("audit", "memory", "memory?validated=false", "keyboard", "interpretations")
    before = {name: api.get(base + "/" + name).json() for name in resources}
    params = {"newest_first": True, "meaning_changes_only": True, "limit": 20}
    response = api.get(base + "/audit", params=params)
    assert response.status_code == 200
    events = response.json()
    assert [e["event_type"] for e in events] == [
        "interpretation_reject",
        "interpretation_correct",
        "interpretation_confirm",
    ]
    assert all(e["target_id"] == accepted["id"] for e in events)
    assert events[1]["source"] == "human:professional"
    assert json.loads(events[1]["new_state"])["corrected_text"] == "Je voudrais de l’eau."
    assert json.loads(events[0]["previous_state"])["status"] == "corrected"
    first = api.get(base + "/audit", params={**params, "limit": 1}).json()
    assert first == events[:1]
    second = api.get(
        base + "/audit", params={**params, "limit": 1, "before": first[0]["id"]}
    ).json()
    assert second == events[1:2]
    third = api.get(base + "/audit", params={**params, "before": second[0]["id"]}).json()
    assert third == events[2:]
    assert api.get(base + "/audit", params={**params, "before": third[0]["id"]}).json() == []
    assert {name: api.get(base + "/" + name).json() for name in resources} == before
    assert api.get(base + f"/interpretations/{pending['id']}").json()["status"] == "proposed"
    assert api.get(base + "/audit", params={"meaning_changes_only": True}).json() == list(
        reversed(events)
    )


def test_history_cursors_are_profile_target_and_filter_scoped_and_exclude_newer_writes(api):
    base, candidate = evolution_fixture(api)
    item = candidate()
    feedback = base + f"/interpretations/{item['id']}/feedback"
    api.post(feedback, json={"action": "confirm", "actor_role": "user"}).raise_for_status()
    params = {"newest_first": True, "meaning_changes_only": True}
    cursor = api.get(base + "/audit", params=params).json()[0]["id"]
    api.post(
        feedback,
        json={
            "action": "correct",
            "actor_role": "user",
            "corrected_value": "De l’eau, s’il vous plaît.",
        },
    ).raise_for_status()
    assert api.get(base + "/audit", params={**params, "before": cursor}).json() == []
    other, other_candidate = evolution_fixture(api)
    other_item = other_candidate()
    api.post(
        other + f"/interpretations/{other_item['id']}/feedback",
        json={"action": "confirm", "actor_role": "user"},
    ).raise_for_status()
    foreign = api.get(other + "/audit", params=params).json()[0]["id"]
    assert api.get(base + "/audit", params={**params, "before": foreign}).status_code == 404
    assert (
        api.get(
            base + "/audit",
            params={**params, "before": cursor, "target_type": "communication_block"},
        ).status_code
        == 404
    )
    assert api.get(base + "/audit", params={"before": cursor}).status_code == 400
    assert api.get(base + "/audit", params={**params, "before": "invalid"}).status_code == 422
    unfiltered = api.get(base + "/audit").json()
    nondecision = next(e["id"] for e in unfiltered if e["event_type"] == "sequence_started")
    assert api.get(base + "/audit", params={**params, "before": nondecision}).status_code == 404


def test_newest_history_cursor_has_a_stable_id_tiebreaker(api):
    from datetime import timedelta
    from uuid import UUID

    from app.domain.pcl.entities import utc_now
    from app.infrastructure.postgres.models import AuditRow

    base, candidate = evolution_fixture(api)
    item = candidate()
    api.post(
        base + f"/interpretations/{item['id']}/feedback",
        json={"action": "confirm", "actor_role": "user"},
    ).raise_for_status()
    params = {"newest_first": True, "meaning_changes_only": True, "limit": 2}
    template = api.get(base + "/audit", params=params).json()[0]
    at = utc_now() + timedelta(hours=1)
    with api.app.state.pcl_units() as store:
        for number in range(1, 5):
            store.session.add(
                AuditRow(
                    id=UUID(int=number),
                    profile_id=UUID(template["profile_id"]),
                    target_type="interpretation",
                    target_id=UUID(item["id"]),
                    interpretation_id=UUID(item["id"]),
                    event_type="interpretation_confirm",
                    previous_state=json.loads(template["previous_state"]),
                    new_state=json.loads(template["new_state"]),
                    source="human:user",
                    created_at=at,
                )
            )
    first = api.get(base + "/audit", params=params).json()
    second = api.get(base + "/audit", params={**params, "before": first[-1]["id"]}).json()
    assert [e["id"] for e in first + second] == [str(UUID(int=i)) for i in (4, 3, 2, 1)]


def test_pending_review_http_conflicts_preserve_the_human_decision_and_history(api):
    p = api.post("/api/v1/profiles").json()["id"]
    other = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{p}"
    block = api.post(
        base + "/blocks/personal",
        json={
            "request_id": str(uuid4()),
            "label": "Eau",
            "pictogram_key": "water",
            "actor_role": "user",
        },
    ).json()
    api.post(
        base + f"/blocks/{block['id']}/feedback",
        json={"action": "confirm", "actor_role": "user", "confirm_representation": True},
    ).raise_for_status()
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + f"/sequences/{sequence['id']}"
    for body in ({"action": "append", "block_id": block["id"]}, {"action": "complete"}):
        api.post(path + "/selection", json=body).raise_for_status()
    candidate = api.post(path + "/interpret", json={}).json()["candidates"][0]
    feedback = base + f"/interpretations/{candidate['id']}/feedback"
    invalid = api.post(
        feedback,
        json={"action": "confirm", "actor_role": "caregiver", "expected_status": "confirmed"},
    )
    assert invalid.status_code == 422
    corrected = api.post(
        feedback,
        json={
            "action": "correct",
            "actor_role": "caregiver",
            "expected_status": "proposed",
            "corrected_value": "Je voudrais de l’eau.",
        },
    )
    assert corrected.status_code == 200
    evidence = base + f"/feedback?target_type=interpretation&target_id={candidate['id']}"
    history_response = api.get(evidence)
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history["items"]) == 1
    audit = api.get(base + "/audit").json()
    for action in ("confirm", "reject"):
        assert (
            api.post(
                feedback,
                json={
                    "action": action,
                    "actor_role": "professional",
                    "expected_status": "proposed",
                },
            ).status_code
            == 409
        )
    assert api.get(base + f"/interpretations/{candidate['id']}").json() == corrected.json()
    assert api.get(evidence).json() == history
    assert api.get(base + "/audit").json() == audit
    assert (
        api.post(
            f"/api/v1/profiles/{other}/interpretations/{candidate['id']}/feedback",
            json={"action": "reject", "actor_role": "caregiver", "expected_status": "proposed"},
        ).status_code
        == 404
    )
    # Existing intentional withdrawal clients remain compatible.
    assert api.post(feedback, json={"action": "reject", "actor_role": "user"}).status_code == 200


def test_http_communication_and_correction_are_profile_scoped(api, monkeypatch):
    signals = []
    monkeypatch.setattr(
        api.app.state.telemetry, "signal", lambda name, **fields: signals.append((name, fields))
    )
    a = api.post("/api/v1/profiles").json()["id"]
    b = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{a}"
    foreign = f"/api/v1/profiles/{b}"
    concept = api.post(base + "/concepts", json={"canonical_key": "NOISE", "label": "Bruit"}).json()
    assert api.get(foreign + "/concepts").json() == []
    assert (
        api.patch(foreign + "/concepts/" + concept["id"], json={"label": "Intrusion"}).status_code
        == 404
    )
    block = api.post(base + "/blocks", json={"concept_id": concept["id"], "label": "Bruit"}).json()
    assert api.get(base + "/keyboard").json() == []
    feedback = {"action": "confirm", "actor_role": "user"}
    assert api.post(base + "/blocks/" + block["id"] + "/feedback", json=feedback).status_code == 200
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + "/sequences/" + sequence["id"]
    assert api.get(path).json()["status"] == "in_progress"
    assert api.get(foreign + "/sequences/" + sequence["id"]).status_code == 404
    assert (
        api.post(
            path + "/selection", json={"action": "append", "block_id": block["id"]}
        ).status_code
        == 200
    )
    assert api.post(path + "/selection", json={"action": "complete"}).status_code == 200
    assert api.get(path).json()["block_ids"] == [block["id"]]
    decision = api.post(path + "/interpret", json={}).json()
    assert decision["state"] == "multiple_hypotheses"
    assert ("interpretation.result", {"result_state": "multiple_hypotheses"}) in signals
    interpretation = decision["candidates"][0]
    reference = "/interpretations/" + interpretation["id"]
    assert api.get(base + reference).json()["status"] == "proposed"
    assert api.get(foreign + reference).status_code == 404
    assert api.get(base + "/memory").json()["interpretations"] == []
    endpoint = "/interpretations/" + interpretation["id"] + "/feedback"
    assert api.post(foreign + endpoint, json=feedback).status_code == 404
    corrected = api.post(
        base + endpoint,
        json={"action": "correct", "actor_role": "user", "corrected_value": "Le bruit me gêne."},
    ).json()
    assert corrected["text"] == "Bruit" and corrected["corrected_text"] == "Le bruit me gêne."
    assert api.get(base + reference).json()["corrected_text"] == "Le bruit me gêne."
    assert len(api.get(base + "/memory").json()["interpretations"]) == 1
    assert api.get(foreign + "/memory").json()["interpretations"] == []
    assert api.get(base + "/audit").json()[-1]["event_type"] == "interpretation_correct"
    assert api.delete(base + "/memory").status_code == 204
    assert api.get(base + "/concepts").json() == []
    assert api.get(path).status_code == 404
    assert api.get(base + reference).status_code == 404
    assert api.get(foreign + "/audit").json() == []


def test_http_rejects_implicit_validation_and_keeps_secrets_server_side(api):
    profile = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    response = api.post(
        base + "/concepts",
        json={"canonical_key": "KEY", "label": "Private text", "status": "validated"},
    )
    assert response.status_code == 422 and "Private text" not in response.text
    assert api.get("/api/v1/providers").json() == {
        "provider_id": "disabled",
        "status": "disabled",
        "capabilities": [],
        "error_code": None,
        "metadata": None,
    }


def test_pictogram_and_word_are_validated_together_and_remain_profile_scoped(api):
    profile = api.post("/api/v1/profiles").json()["id"]
    foreign = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    concept = api.post(
        base + "/concepts", json={"canonical_key": "TOILETS", "label": "Toilettes"}
    ).json()
    block = api.post(
        base + "/blocks",
        json={"concept_id": concept["id"], "label": "Toilettes", "pictogram_key": "toilets"},
    ).json()
    assert block["status"] == "proposed" and block["representation_id"]
    assert api.get(base + "/keyboard").json() == []
    visuals = api.get(base + "/representations").json()
    assert len(visuals) == 1 and visuals[0]["status"] == "proposed"
    feedback = {"action": "confirm", "actor_role": "caregiver"}
    endpoint = base + "/blocks/" + block["id"]
    assert api.post(endpoint + "/feedback", json=feedback).status_code == 400
    assert api.get(base + "/representations").json() == visuals
    accepted = api.post(endpoint + "/feedback", json={**feedback, "confirm_representation": True})
    assert accepted.status_code == 200 and accepted.json()["status"] == "validated"
    assert api.get(base + "/representations").json()[0]["status"] == "validated"
    place = {"zone": "stable", "position": 5, "actor_role": "caregiver"}
    assert api.put(base + "/keyboard/" + block["id"], json=place).status_code == 200
    keyboard = api.get(base + "/keyboard").json()
    selection = {"pictogram_key": "book", "actor_role": "caregiver"}
    foreign_endpoint = f"/api/v1/profiles/{foreign}/blocks/{block['id']}/pictogram"
    assert api.put(foreign_endpoint, json=selection).status_code == 404
    assert api.get(f"/api/v1/profiles/{foreign}/representations").json() == []
    changed = api.put(endpoint + "/pictogram", json=selection)
    assert changed.status_code == 200
    current = changed.json()
    assert current["label"] == "Toilettes" and current["concept_id"] == concept["id"]
    assert (
        current["stability"] == "stable"
        and current["representation_id"] != block["representation_id"]
    )
    assert current["visual_reference"] == "pictoflow:pictogram:v1:book"
    assert api.get(base + "/keyboard").json() == keyboard
    visuals = api.get(base + "/representations").json()
    assert len(visuals) == 2 and all(item["status"] == "validated" for item in visuals)
    assert all(item["concept_id"] == concept["id"] for item in visuals)
    assert api.get(base + "/relations").json() == []
    audit = api.get(base + "/audit").json()
    assert audit[-1]["event_type"] == "block_representation_changed"
    assert audit[-1]["source"] == "human:caregiver"
    # An uncertain network response can be reconciled and retried without duplicating a visual.
    assert api.put(endpoint + "/pictogram", json=selection).status_code == 200
    assert api.get(base + "/representations").json() == visuals
    assert api.get(base + "/audit").json() == audit


def test_invalid_or_implicit_pictogram_actions_leave_no_partial_changes(api, monkeypatch):
    from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository

    profile = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    concept = api.post(base + "/concepts", json={"canonical_key": "YES", "label": "Oui"}).json()
    for key in ("../../secret", "https://example.com/tracker.svg", "unknown"):
        assert (
            api.post(
                base + "/blocks",
                json={"concept_id": concept["id"], "label": "Oui", "pictogram_key": key},
            ).status_code
            == 422
        )
    assert api.get(base + "/blocks").json() == []
    assert api.get(base + "/representations").json() == []
    block = api.post(
        base + "/blocks", json={"concept_id": concept["id"], "label": "Oui", "pictogram_key": "yes"}
    ).json()
    endpoint = base + "/blocks/" + block["id"]
    assert (
        api.put(
            endpoint + "/pictogram", json={"pictogram_key": "no", "actor_role": "user"}
        ).status_code
        == 400
    )
    assert (
        api.post(
            endpoint + "/feedback",
            json={"action": "reject", "actor_role": "user", "confirm_representation": True},
        ).status_code
        == 400
    )
    before = {
        name: api.get(base + "/" + name).json() for name in ("blocks", "representations", "audit")
    }
    original = PostgresPCLRepository.audit

    def failing_audit(self, profile_id, event_type, *args, **kwargs):
        if event_type == "block_confirm":
            raise RuntimeError("Injected failure after visual validation")
        return original(self, profile_id, event_type, *args, **kwargs)

    with monkeypatch.context() as context:
        context.setattr(PostgresPCLRepository, "audit", failing_audit)
        with pytest.raises(RuntimeError, match="Injected failure"):
            api.post(
                endpoint + "/feedback",
                json={"action": "confirm", "actor_role": "user", "confirm_representation": True},
            )
    assert {name: api.get(base + "/" + name).json() for name in before} == before
    assert api.get(base + "/keyboard").json() == []


def test_personal_touch_creation_is_atomic_retryable_and_profile_scoped(api, monkeypatch):
    from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository

    profile = api.post("/api/v1/profiles").json()["id"]
    foreign = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    payload = {
        "request_id": str(uuid4()),
        "label": "  Mon téléphone  ",
        "pictogram_key": "phone",
        "actor_role": "caregiver",
    }
    original = PostgresPCLRepository.audit

    def failing_audit(self, profile_id, event_type, *args, **kwargs):
        if event_type == "block_proposed":
            raise RuntimeError("Injected failure after concept, visual and block creation")
        return original(self, profile_id, event_type, *args, **kwargs)

    with monkeypatch.context() as context:
        context.setattr(PostgresPCLRepository, "audit", failing_audit)
        with pytest.raises(RuntimeError, match="Injected failure"):
            api.post(base + "/blocks/personal", json=payload)
    for name in ("concepts", "representations", "blocks", "audit", "keyboard"):
        assert api.get(base + "/" + name).json() == []

    response = api.post(base + "/blocks/personal", json=payload)
    assert response.status_code == 201
    block = response.json()
    assert block["label"] == "Mon téléphone"
    assert block["status"] == "proposed" and block["origin"] == "caregiver"
    concept = api.get(base + "/concepts").json()[0]
    visual = api.get(base + "/representations").json()[0]
    assert concept["label"] == "Mon téléphone" and concept["id"] == block["concept_id"]
    assert visual["concept_id"] == concept["id"] and visual["id"] == block["representation_id"]
    assert visual["asset_reference"] == "pictoflow:pictogram:v1:phone"
    assert visual["status"] == "proposed" and api.get(base + "/keyboard").json() == []
    before = {
        name: api.get(base + "/" + name).json()
        for name in ("concepts", "representations", "blocks", "audit")
    }
    assert all(event["source"] == "human:caregiver" for event in before["audit"])
    assert api.post(base + "/blocks/personal", json=payload).json() == before["blocks"][0]
    for change in ({"label": "Autre sens"}, {"pictogram_key": "book"}):
        assert api.post(base + "/blocks/personal", json={**payload, **change}).status_code == 400
    assert {name: api.get(base + "/" + name).json() for name in before} == before

    feedback = {"action": "confirm", "actor_role": "caregiver", "confirm_representation": True}
    accepted = api.post(base + "/blocks/" + block["id"] + "/feedback", json=feedback).json()
    audit = api.get(base + "/audit").json()
    assert accepted["status"] == "validated"
    stored = api.get(base + "/blocks").json()[0]
    assert api.post(base + "/blocks/personal", json=payload).json() == stored
    assert api.get(base + "/audit").json() == audit

    foreign_base = f"/api/v1/profiles/{foreign}"
    assert api.get(foreign_base + "/concepts").json() == []
    other = api.post(foreign_base + "/blocks/personal", json=payload).json()
    assert other["profile_id"] == foreign and other["id"] != block["id"]
    assert other["concept_id"] != concept["id"] and other["status"] == "proposed"
    assert api.post(f"/api/v1/profiles/{uuid4()}/blocks/personal", json=payload).status_code == 404


@pytest.mark.parametrize(
    "change, status",
    [
        ({"label": " "}, 400),
        ({"label": ""}, 422),
        ({"label": "a" * 257}, 422),
        ({"pictogram_key": "https://example.test/photo.svg"}, 422),
        ({"pictogram_key": "unknown"}, 422),
        ({"actor_role": "ai"}, 422),
        ({"status": "validated"}, 422),
    ],
)
def test_invalid_personal_touch_creates_nothing(api, change, status):
    profile = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    payload = {
        "request_id": str(uuid4()),
        "label": "Manger",
        "pictogram_key": "eat",
        "actor_role": "user",
    }
    assert api.post(base + "/blocks/personal", json={**payload, **change}).status_code == status
    for name in ("concepts", "blocks", "representations", "audit"):
        assert api.get(base + "/" + name).json() == []


@pytest.mark.parametrize(
    "kind", ["invalid", "refusal", "proposal", "unfaithful", "alternatives", "generation_failure"]
)
def test_strict_phrase_responses_never_promote_invalid_or_unconfirmed_meaning(api, kind):
    from app.ai.manager import ProviderManager
    from app.ai.providers.openai_compatible import OpenAICompatibleProvider

    requests = []
    output = {"status": "proposal", "candidates": []}
    if kind == "refusal":
        output["status"] = "not_understood"
    elif kind == "proposal":
        output["candidates"] = [
            {"intent": "DRINK", "text": "Je voudrais boire.", "confidence": 0.99}
        ]
    elif kind in ("unfaithful", "alternatives"):
        output["candidates"] = [
            {"intent": "REQUEST", "text": "Je voudrais un livre.", "confidence": 1.0}
        ]
        if kind == "alternatives":
            output["candidates"].extend(
                [
                    {"intent": "DRINK", "text": "Je voudrais boire.", "confidence": 0.7},
                    {"intent": "DRINK", "text": "Je veux boire.", "confidence": 0.5},
                ]
            )

    def respond(request):
        requests.append(request)
        assert json.loads(request.content)["response_format"]["type"] == "json_schema"
        if kind == "generation_failure":
            return httpx.Response(
                400,
                json={
                    "error": {
                        "code": "json_validate_failed",
                        "failed_generation": "private malformed generation",
                    }
                },
            )
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": json.dumps({"result": output})},
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
    profile = api.post("/api/v1/profiles").json()["id"]
    foreign = api.post("/api/v1/profiles").json()["id"]
    base = f"/api/v1/profiles/{profile}"
    concept = api.post(base + "/concepts", json={"canonical_key": "DRINK", "label": "Boire"}).json()
    block = api.post(base + "/blocks", json={"concept_id": concept["id"], "label": "Boire"}).json()
    api.post(
        base + "/blocks/" + block["id"] + "/feedback",
        json={"action": "confirm", "actor_role": "user"},
    ).raise_for_status()
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    path = base + "/sequences/" + sequence["id"]
    api.post(
        path + "/selection", json={"action": "append", "block_id": block["id"]}
    ).raise_for_status()
    api.post(path + "/selection", json={"action": "complete"}).raise_for_status()
    assert (
        api.post(
            f"/api/v1/profiles/{foreign}/sequences/{sequence['id']}/interpret", json={}
        ).status_code
        == 404
    )
    assert requests == []
    response = api.post(path + "/interpret", json={})
    assert len(requests) == 1
    assert api.get(path).json()["block_ids"] == [block["id"]]
    assert api.get(path).json()["status"] == "completed"
    assert api.get(base + "/memory").json()["interpretations"] == []
    if kind in ("invalid", "refusal", "unfaithful", "generation_failure"):
        assert response.status_code == 200
        candidate = response.json()["candidates"][0]
        assert candidate["text"] == "Boire" and candidate["source"] == "pcl"
        assert candidate["status"] == "proposed"
        from datetime import datetime

        stored = api.get(base + "/interpretations").json()
        assert len(stored) == 1
        assert datetime.fromisoformat(stored[0]["created_at"]) == datetime.fromisoformat(
            candidate["created_at"]
        )
        assert stored[0] == {**candidate, "created_at": stored[0]["created_at"]}
        if kind == "generation_failure":
            quality = api.get(base + "/ai-quality").json()
            assert quality["fallbacks"]["invalid_payload"] == 1
            assert quality["fallbacks"].get("unavailable", 0) == 0
            assert "private malformed generation" not in json.dumps(quality)
            assert "private malformed generation" not in json.dumps(api.get(base + "/audit").json())
    elif kind == "alternatives":
        assert response.status_code == 200
        candidates = response.json()["candidates"]
        assert [c["text"] for c in candidates] == ["Je voudrais boire.", "Je veux boire."]
        assert all(c["source"] == "openai-compatible" for c in candidates)
        assert {c["id"] for c in api.get(base + "/interpretations").json()} == {
            c["id"] for c in candidates
        }
    else:
        assert response.status_code == 200
        candidate = response.json()["candidates"][0]
        assert candidate["text"] == "Je voudrais boire." and candidate["status"] == "proposed"
        api.post(
            base + "/interpretations/" + candidate["id"] + "/feedback",
            json={"action": "confirm", "actor_role": "user"},
        ).raise_for_status()
        assert len(api.get(base + "/memory").json()["interpretations"]) == 1
