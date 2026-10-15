"""Own accepted phrase text is the entire vocabulary; selection is never validation."""

from uuid import uuid4

import pytest

from app.infrastructure.postgres.pcl_repository import PostgresPCLRepository
from tests.integration.test_access import login
from tests.integration.test_access import secured as secured
from tests.integration.test_business_api import api as api
from tests.integration.test_profile_archives import restore_body

pytestmark = pytest.mark.postgres


def call(api, method, path, data=None):
    response = getattr(api, method)(path, **({"json": data} if data is not None else {}))
    response.raise_for_status()
    return None if response.status_code == 204 else response.json()


def sequence(api, base, block_id, complete=True):
    value = call(api, "post", base + "/sequences", {"session_id": str(uuid4())})
    path = base + "/sequences/" + value["id"] + "/selection"
    call(api, "post", path, {"action": "append", "block_id": block_id})
    return call(api, "post", path, {"action": "complete"}) if complete else value


def fixture(api):
    base = "/api/v1/profiles/" + call(api, "post", "/api/v1/profiles")["id"]
    blocks = {}
    for label, drawing in (("Boire", "drink"), ("Eau", "water"), ("Livre", "book")):
        block = call(
            api,
            "post",
            base + "/blocks/personal",
            {
                "request_id": str(uuid4()),
                "label": label,
                "pictogram_key": drawing,
                "actor_role": "user",
            },
        )
        call(
            api,
            "post",
            base + "/blocks/" + block["id"] + "/feedback",
            {
                "action": "confirm",
                "actor_role": "user",
                "confirm_representation": True,
            },
        )
        blocks[label] = block["id"]
    original = sequence(api, base, blocks["Livre"])
    item = call(api, "post", base + "/sequences/" + original["id"] + "/interpret", {})[
        "candidates"
    ][0]
    accepted = call(
        api,
        "post",
        base + "/interpretations/" + item["id"] + "/feedback",
        {
            "action": "correct",
            "actor_role": "user",
            "corrected_value": "Je veux boire de l’eau.",
        },
    )
    target = sequence(api, base, blocks["Boire"])
    return base, blocks, accepted, target


def proposal_path(base, target):
    return base + "/sequences/" + target["id"] + "/memory-proposals"


def body(references):
    return {"request_id": str(uuid4()), "references": references, "actor_role": "user"}


def feedback_path(base, candidate):
    return base + "/interpretations/" + candidate["id"] + "/feedback"


def test_catalog_uses_all_corrected_words_not_selected_touches_or_a_dictionary(api, monkeypatch):
    base, blocks, source, _ = fixture(api)

    def forbidden(*args, **kwargs):
        raise AssertionError("Memory suggestions must never call any provider")

    monkeypatch.setattr(api.app.state.ai_provider, "interpret", forbidden)
    before = call(api, "get", base + "/audit")
    page = call(api, "get", base + "/memory-suggestions?mode=words")
    assert [word["text"] for word in page["words"]] == ["Je", "veux", "boire", "de", "l’", "eau"]
    assert all(word["source_text"] == source["corrected_text"] for word in page["words"])
    water = page["words"][-1]
    assert water["representation"]["asset_reference"] == "pictoflow:pictogram:v1:water"
    assert page["words"][0]["representation"] is None
    assert "Livre" not in [word["text"] for word in page["words"]]
    phrases = call(api, "get", base + "/memory-suggestions?mode=phrases")
    assert [item["text"] for item in phrases["phrases"]] == [source["corrected_text"]]
    assert call(api, "get", base + "/audit") == before
    assert len(call(api, "get", base + "/blocks")) == len(blocks)
    assert call(api, "get", base + "/memory-suggestions?mode=words&q=EAU")["words"][0] == water
    paged = [
        call(api, "get", base + f"/memory-suggestions?mode=words&offset={i}&limit=2")
        for i in (0, 2, 4)
    ]
    assert sum((p["words"] for p in paged), []) == page["words"]


@pytest.mark.parametrize("kind", ["phrase", "words"])
def test_proposal_is_explicit_atomic_retryable_and_separate_from_source_validation(
    api, monkeypatch, kind
):
    base, blocks, source, target = fixture(api)
    monkeypatch.setattr(
        api.app.state.ai_provider, "interpret", lambda *a, **kw: pytest.fail("Unexpected AI call")
    )
    memory_before = call(api, "get", base + "/memory")
    if kind == "phrase":
        references = [
            call(api, "get", base + "/memory-suggestions?mode=phrases")["phrases"][0]["reference"]
        ]
        expected = source["corrected_text"]
    else:
        words = call(api, "get", base + "/memory-suggestions?mode=words")["words"]
        references = [word["reference"] for word in words]
        expected = "Je veux boire de l’eau"
    payload = body(references)
    result = call(api, "post", proposal_path(base, target), payload)
    item = result["candidates"][0]
    assert (
        item["status"] == "proposed" and item["source"] == "pcl-memory" and item["text"] == expected
    )
    assert call(api, "get", base + "/memory") == memory_before
    before_retry = call(api, "get", base + "/audit")
    assert call(api, "post", proposal_path(base, target), payload) == result
    assert call(api, "get", base + "/audit") == before_retry
    assert (
        api.post(
            proposal_path(base, target), json={**payload, "actor_role": "caregiver"}
        ).status_code
        == 409
    )
    call(api, "post", feedback_path(base, item), {"action": "confirm", "actor_role": "user"})
    memory = call(api, "get", base + "/memory")
    assert len(memory["interpretations"]) == 2
    assert len(call(api, "get", base + "/blocks")) == len(blocks)
    assert memory["relations"] == []
    call(api, "post", feedback_path(base, item), {"action": "reject", "actor_role": "user"})
    assert call(api, "get", base + "/memory") == memory_before
    assert call(api, "get", base + "/interpretations/" + source["id"])["status"] == "corrected"


@pytest.mark.parametrize("change", ["correct", "reject"])
def test_source_changes_are_checked_again_before_proposing_and_before_accepting(api, change):
    base, _, source, target = fixture(api)
    ref = call(api, "get", base + "/memory-suggestions?mode=phrases")["phrases"][0]["reference"]
    item = call(api, "post", proposal_path(base, target), body([ref]))["candidates"][0]
    call(
        api,
        "post",
        feedback_path(base, source),
        {
            "action": change,
            "actor_role": "user",
            **({"corrected_value": "Autre sens."} if change == "correct" else {}),
        },
    )
    assert api.post(proposal_path(base, target), json=body([ref])).status_code == 409
    assert (
        api.post(
            feedback_path(base, item), json={"action": "confirm", "actor_role": "user"}
        ).status_code
        == 409
    )
    assert call(api, "get", base + "/interpretations/" + item["id"])["status"] == "proposed"
    call(api, "post", feedback_path(base, item), {"action": "reject", "actor_role": "user"})
    assert source["corrected_text"] not in [
        v["text"] for v in call(api, "get", base + "/memory-suggestions?mode=phrases")["phrases"]
    ]


def test_empty_foreign_unaccepted_sources_forged_words_and_unfinished_sequences_fail_closed(api):
    base, blocks, source, target = fixture(api)
    foreign = "/api/v1/profiles/" + call(api, "post", "/api/v1/profiles")["id"]
    assert call(api, "get", foreign + "/memory-suggestions")["total"] == 0
    ref = call(api, "get", base + "/memory-suggestions?mode=phrases")["phrases"][0]["reference"]
    other = call(api, "post", foreign + "/sequences", {"session_id": str(uuid4())})
    assert api.post(proposal_path(foreign, target), json=body([ref])).status_code == 404
    assert api.post(proposal_path(base, other), json=body([ref])).status_code == 404
    unfinished = sequence(api, base, blocks["Boire"], complete=False)
    assert api.post(proposal_path(base, unfinished), json=body([ref])).status_code == 409
    assert (
        api.post(proposal_path(base, target), json={**body([ref]), "text": "Inventé"}).status_code
        == 422
    )
    assert (
        api.post(proposal_path(base, target), json=body([{**ref, "index": 999}])).status_code == 409
    )
    assert (
        api.post(proposal_path(base, target), json=body([ref, {**ref, "index": 0}])).status_code
        == 400
    )
    proposed = call(api, "post", base + "/sequences/" + target["id"] + "/interpret", {})[
        "candidates"
    ][0]
    assert (
        api.post(
            proposal_path(base, target), json=body([{**ref, "interpretation_id": proposed["id"]}])
        ).status_code
        == 409
    )


def test_repeated_words_and_atomic_rollback_keep_the_actual_composition(api, monkeypatch):
    base, _, _, target = fixture(api)
    word = next(
        word
        for word in call(api, "get", base + "/memory-suggestions?mode=words")["words"]
        if word["text"] == "boire"
    )
    payload = body([word["reference"], word["reference"]])
    before = {name: call(api, "get", base + "/" + name) for name in ("interpretations", "audit")}
    original = PostgresPCLRepository.audit

    def fail(self, profile, event_type, *args, **kwargs):
        if event_type == "memory_proposal":
            raise RuntimeError("Late memory audit failure")
        return original(self, profile, event_type, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(PostgresPCLRepository, "audit", fail)
        with pytest.raises(RuntimeError, match="Late memory"):
            api.post(proposal_path(base, target), json=payload)
    assert {name: call(api, "get", base + "/" + name) for name in before} == before
    item = call(api, "post", proposal_path(base, target), payload)["candidates"][0]
    assert item["text"] == "boire boire"
    assert call(api, "get", base + "/sequences/" + target["id"])["block_ids"] == target["block_ids"]


def test_restore_remaps_pending_provenance_and_keeps_it_validatable(api):
    base, _, source, target = fixture(api)
    ref = call(api, "get", base + "/memory-suggestions?mode=phrases")["phrases"][0]["reference"]
    item = call(api, "post", proposal_path(base, target), body([ref]))["candidates"][0]
    snapshot = call(api, "get", base + "/backup")
    restored = call(api, "post", "/api/v1/profiles/restore", restore_body(snapshot))
    new_base = "/api/v1/profiles/" + restored["id"]
    pending = next(
        v for v in call(api, "get", new_base + "/interpretations") if v["source"] == "pcl-memory"
    )
    assert pending["id"] != item["id"]
    call(api, "post", feedback_path(new_base, pending), {"action": "confirm", "actor_role": "user"})
    assert len(call(api, "get", new_base + "/memory")["interpretations"]) == 2
    assert call(api, "get", base + "/interpretations/" + source["id"])["status"] == "corrected"


def test_communicator_can_use_own_memory_without_preparation_or_foreign_access(secured):
    client, accounts, _ = secured
    login(client).raise_for_status()
    base, _, _, target = fixture(client)
    foreign = "/api/v1/profiles/" + call(client, "post", "/api/v1/profiles")["id"]
    account = accounts.create("speaker", "Personne fictive", "Une longue phrase fictive 2026 !")
    profile_id = base.rsplit("/", 1)[1]
    call(
        client,
        "put",
        f"/api/v1/auth/users/{account.id}/profiles/{profile_id}",
        {
            "role": "communicator",
            "expected_role": None,
        },
    )
    login(client, "speaker").raise_for_status()
    ref = call(client, "get", base + "/memory-suggestions?mode=phrases")["phrases"][0]["reference"]
    result = call(client, "post", proposal_path(base, target), body([ref]))
    call(
        client,
        "post",
        feedback_path(base, result["candidates"][0]),
        {"action": "confirm", "actor_role": "user"},
    )
    assert client.get(foreign + "/memory-suggestions").status_code == 404
    assert (
        client.post(
            foreign + "/sequences/" + target["id"] + "/memory-proposals", json=body([ref])
        ).status_code
        == 404
    )
    assert client.post(base + "/blocks/personal", json={}).status_code == 403
