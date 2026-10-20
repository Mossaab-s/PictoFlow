from uuid import UUID, uuid4

import pytest

from app.application.communication import CommunicationService
from app.application.interpretation import InterpretationService
from app.application.profile_archive import RestoreRequest, parse_archive
from app.application.semantic_space import SemanticSpace
from app.domain.pcl.entities import CommunicationBlock, Concept, HumanRole, Representation
from app.domain.pcl.gaps import SemanticGapCandidate
from app.domain.pcl.invariants import DomainInvariantError
from app.infrastructure.postgres.profile_archives import PostgresProfileArchives
from app.infrastructure.postgres.semantic_space import PostgresSemanticUnits
from tests.integration.test_business_api import api as api
from tests.integration.test_business_api import need_fixture

pytestmark = pytest.mark.postgres


def prepare(api, approved=True):
    base, need, candidates = need_fixture(api)
    path = base + f"/suggestions/{need['id']}"
    if approved:
        api.post(
            path + "/decision", json={"approve": True, "actor_role": "user"}
        ).raise_for_status()
    body = {
        "request_id": str(uuid4()),
        "label": "Mon eau",
        "pictogram_key": "water",
        "expected_intent": need["validated_intent"],
        "actor_role": "caregiver",
    }
    return base, path, need, candidates, body


def resources(api, base):
    return {
        name: api.get(base + "/" + name).json()
        for name in (
            "blocks",
            "concepts",
            "representations",
            "suggestions",
            "audit",
            "memory",
            "keyboard",
        )
    }


def test_illustration_is_atomic_proposed_idempotent_and_only_resolves_after_human_validation(api):
    base, path, need, _, body = prepare(api)
    before = resources(api, base)
    result = api.post(path + "/illustrated-block", json=body)
    assert result.status_code == 201
    block = result.json()
    assert block["status"] == "proposed" and block["semantic_gap_id"] == need["id"]
    assert block["canonical_intent"] is None and block["origin"] == "pcl_suggestion"
    after = resources(api, base)
    concept = next(c for c in after["concepts"] if c["id"] == block["concept_id"])
    visual = next(v for v in after["representations"] if v["id"] == block["representation_id"])
    assert concept["label"] == need["validated_intent"]
    assert visual["concept_id"] == concept["id"] and visual["status"] == "proposed"
    assert len(after["audit"]) == len(before["audit"]) + 3
    for resource in ("memory", "keyboard", "suggestions"):
        assert after[resource] == before[resource]
    assert api.post(path + "/illustrated-block", json=body).json() == block
    assert resources(api, base) == after
    for change in (
        {"label": "Autre"},
        {"pictogram_key": "book"},
        {"request_id": str(uuid4())},
        {"expected_intent": "Autre sens"},
    ):
        assert api.post(path + "/illustrated-block", json={**body, **change}).status_code == 409
    assert resources(api, base) == after
    feedback = base + f"/blocks/{block['id']}/feedback"
    assert api.post(feedback, json={"action": "confirm", "actor_role": "user"}).status_code == 400
    assert resources(api, base) == after
    api.post(
        feedback, json={"action": "confirm", "actor_role": "user", "confirm_representation": True}
    ).raise_for_status()
    current = api.get(base + "/blocks").json()[-1]
    assert current["status"] == "validated"
    assert api.get(base + "/suggestions").json()[0]["status"] == "resolved"
    assert api.get(path + "/evidence").json()["existing_block_match"] is True
    assert api.post(base + "/suggestions/detect").json() == []
    assert api.post(path + "/illustrated-block", json=body).json() == current
    assert (
        api.get(base + "/memory").json()["interpretations"] == before["memory"]["interpretations"]
    )
    # The human-selected word can change without rewriting the accepted meaning.
    corrected = api.post(
        feedback, json={"action": "correct", "actor_role": "user", "corrected_value": "Boire"}
    )
    corrected.raise_for_status()
    assert api.get(base + "/concepts").json() == after["concepts"]
    service = SemanticSpace(PostgresSemanticUnits(api.app.state.pcl_units.factory))
    with pytest.raises(DomainInvariantError):
        service.rename_concept(UUID(block["profile_id"]), UUID(concept["id"]), "Autre sens")
    sequence = api.post(base + "/sequences", json={"session_id": str(uuid4())}).json()
    selection = base + f"/sequences/{sequence['id']}/selection"
    api.post(selection, json={"action": "append", "block_id": block["id"]}).raise_for_status()
    api.post(selection, json={"action": "complete"}).raise_for_status()
    units = api.app.state.pcl_units
    request = InterpretationService(
        units, CommunicationService(units), api.app.state.ai_provider
    ).request(UUID(block["profile_id"]), UUID(sequence["id"]))
    assert request.blocks[0].label == "Boire"
    assert request.blocks[0].meaning == need["validated_intent"]


def test_pending_refused_withdrawn_and_foreign_needs_never_create_partial_records(api):
    base, path, _, candidates, body = prepare(api, approved=False)
    before = resources(api, base)
    assert api.post(path + "/illustrated-block", json=body).status_code == 409
    assert resources(api, base) == before
    foreign = api.post("/api/v1/profiles").json()["id"]
    foreign_path = path.replace(base, f"/api/v1/profiles/{foreign}")
    assert api.post(foreign_path + "/illustrated-block", json=body).status_code == 404
    api.post(path + "/decision", json={"approve": False, "actor_role": "user"}).raise_for_status()
    before = resources(api, base)
    assert api.post(path + "/illustrated-block", json=body).status_code == 409
    assert resources(api, base) == before
    api.post(path + "/decision", json={"approve": True, "actor_role": "user"}).raise_for_status()
    for candidate in candidates[:3]:
        api.post(
            base + f"/interpretations/{candidate['id']}/feedback",
            json={"action": "reject", "actor_role": "user"},
        ).raise_for_status()
    before = resources(api, base)
    assert api.post(path + "/illustrated-block", json=body).status_code == 409
    assert resources(api, base) == before


@pytest.mark.parametrize("withdraw", [False, True])
def test_validation_rechecks_approval_and_evidence_before_confirming_the_drawing(api, withdraw):
    base, path, _, candidates, body = prepare(api)
    block = api.post(path + "/illustrated-block", json=body).json()
    if withdraw:
        for candidate in candidates[:3]:
            api.post(
                base + f"/interpretations/{candidate['id']}/feedback",
                json={"action": "reject", "actor_role": "user"},
            ).raise_for_status()
    else:
        api.post(
            path + "/decision", json={"approve": False, "actor_role": "user"}
        ).raise_for_status()
    before = resources(api, base)
    assert (
        api.post(
            base + f"/blocks/{block['id']}/feedback",
            json={
                "action": "confirm",
                "actor_role": "user",
                "confirm_representation": True,
            },
        ).status_code
        == 409
    )
    assert resources(api, base) == before


def test_refused_touch_remains_unique_and_can_be_reconsidered_explicitly(api):
    base, path, _, _, body = prepare(api)
    block = api.post(path + "/illustrated-block", json=body).json()
    feedback = base + f"/blocks/{block['id']}/feedback"
    rejected = api.post(feedback, json={"action": "reject", "actor_role": "user"}).json()
    assert api.post(path + "/illustrated-block", json=body).json() == rejected
    assert api.get(base + "/suggestions").json()[0]["status"] == "approved"
    assert (
        api.post(path + "/illustrated-block", json={**body, "request_id": str(uuid4())}).status_code
        == 409
    )
    api.post(
        feedback, json={"action": "confirm", "actor_role": "user", "confirm_representation": True}
    ).raise_for_status()
    assert api.get(base + "/suggestions").json()[0]["status"] == "resolved"


def test_existing_legacy_candidate_is_preserved_instead_of_silently_converted(api):
    base, path, _, _, body = prepare(api)
    old = api.post(path + "/block", json={"label": "Boire"}).json()
    before = resources(api, base)
    assert api.post(path + "/illustrated-block", json=body).status_code == 409
    assert resources(api, base) == before
    assert next(b for b in before["blocks"] if b["id"] == old["id"])["concept_id"] is None


def test_backup_restore_remaps_the_need_concept_and_drawing_without_losing_the_link(api):
    base, path, need, _, body = prepare(api)
    block = api.post(path + "/illustrated-block", json=body).json()
    units = api.app.state.pcl_units
    archives = PostgresProfileArchives(units.factory)
    source = UUID(block["profile_id"])
    snapshot = parse_archive(archives.export(source))
    restored = archives.restore(
        RestoreRequest(
            request_id=uuid4(),
            actor_role=HumanRole.USER,
            confirm=True,
            display_name="Besoin illustré restauré",
            snapshot=snapshot,
        )
    )
    with units() as store:
        copied = next(b for b in store.list(restored.id, CommunicationBlock) if b.semantic_gap_id)
        gap = store.get(restored.id, SemanticGapCandidate, copied.semantic_gap_id)
        concept = store.get(restored.id, Concept, copied.concept_id)
        drawing = store.get(restored.id, Representation, copied.representation_id)
    assert copied.id != UUID(block["id"]) and copied.semantic_gap_id != UUID(need["id"])
    assert copied.status == "proposed" and gap.status == "approved"
    assert concept.label == gap.validated_intent == need["validated_intent"]
    assert drawing.concept_id == concept.id and drawing.status == "proposed"
    assert parse_archive(archives.export(restored.id)).records.blocks
