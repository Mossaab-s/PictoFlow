import asyncio
from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

import pytest

from app.ai.contracts import InterpretationProposal
from app.application.ai_context import context_for
from app.application.interpretation_reuse import TTL_SECONDS, InterpretationReuse
from app.application.memory_vocabulary import MemorySuggestionConflict
from app.application.transient import TransientStoreUnavailable
from app.domain.pcl.entities import Concept, Interpretation, ValidationAction, utc_now
from tests.integration.test_ai_quality import interpreter
from tests.integration.test_business_api import api as api
from tests.integration.test_business_api import evolution_fixture
from tests.integration.test_communication import communication as communication
from tests.integration.test_communication import completed, event
from tests.integration.test_redis import redis_url as redis_url

pytestmark = pytest.mark.postgres
LITERAL = "Bruit, stop : je veux partir."
OTHER = "Stop, bruit : je veux partir."
PERSONAL = "Ce bruit me fatigue : stop, je veux partir."


class Cache:
    """TTL is checked by the application too; reads deliberately never expire here."""

    def __init__(self):
        self.values, self.puts, self.gets = {}, [], []
        self.fail = False

    async def get(self, profile, kind, key):
        self.gets.append((profile, kind, key))
        if self.fail:
            raise TransientStoreUnavailable()
        return self.values.get((profile, kind, key))

    async def put(self, profile, kind, key, value, *, ttl_seconds):
        if self.fail:
            raise TransientStoreUnavailable()
        self.puts.append((profile, kind, key, value, ttl_seconds))
        self.values[profile, kind, key] = value


def setup(service, cache=None):
    ai = interpreter(service)
    ai.provider.interpret.return_value = InterpretationProposal.model_validate(
        {
            "candidates": [
                {"intent": "request", "text": LITERAL, "confidence": 0.98},
                {"intent": "request", "text": OTHER, "confidence": 0.8},
            ]
        }
    )
    return InterpretationReuse(ai, cache if cache is not None else Cache(), {"version": 1})


def run(reuse, profile, sequence, **options):
    return asyncio.run(reuse.interpret(profile, sequence.id, **options))


def test_pending_replay_preserves_choices_provenance_and_original_expiry(communication):
    service, profile, _, blocks = communication
    reuse = setup(service)
    first = run(reuse, profile, completed(service, profile, blocks))
    assert reuse.interpreter.provider.interpret.await_count == 1
    assert reuse.transient.puts[0][-1] == TTL_SECONDS
    assert set(reuse.transient.puts[0][-2]) == {"version", "expires_at", "candidate_ids"}
    for _ in range(2):
        target = completed(service, profile, blocks)
        copied = run(reuse, profile, target)
        assert [c.text for c in copied.candidates] == [c.text for c in first.candidates]
        assert not {c.id for c in copied.candidates} & {c.id for c in first.candidates}
        assert all(
            c.sequence_id == target.id and c.validated_text is None for c in copied.candidates
        )
        assert context_for(service.units, profile, copied.candidates[0].id).reuse == "cache"
    assert len(reuse.transient.puts) == 1
    assert reuse.interpreter.provider.interpret.await_count == 1
    assert not service.memory(profile, validated=True).interpretations


def test_rejecting_original_or_copy_removes_only_its_cached_lineage(communication):
    service, profile, _, blocks = communication
    reuse = setup(service)
    original = run(reuse, profile, completed(service, profile, blocks))
    copy = run(reuse, profile, completed(service, profile, blocks))
    service.validate(event(profile, copy.candidates[0], ValidationAction.REJECT))
    remaining = run(reuse, profile, completed(service, profile, blocks))
    assert [c.text for c in remaining.candidates] == [OTHER]
    # A partial hit must retain the second root, even though the first was skipped.
    service.validate(event(profile, remaining.candidates[0], ValidationAction.REJECT))
    run(reuse, profile, completed(service, profile, blocks))
    assert reuse.interpreter.provider.interpret.await_count == 2
    assert not service.memory(profile, validated=True).interpretations
    # Rejecting an original also invalidates its otherwise unreviewed copies.
    service.validate(event(profile, original.candidates[1], ValidationAction.REJECT))
    assert not service.memory(profile, validated=True).interpretations


def test_correction_becomes_first_choice_without_ai_and_withdrawal_blocks_acceptance(communication):
    service, profile, _, blocks = communication
    reuse = setup(service)
    source = run(reuse, profile, completed(service, profile, blocks)).candidates[0]
    service.validate(event(profile, source, ValidationAction.CORRECT, PERSONAL))
    reuse.transient.fail = True
    remembered = run(reuse, profile, completed(service, profile, blocks)).candidates[0]
    assert remembered.text == PERSONAL and remembered.source == "pcl-memory"
    assert remembered.confidence == service.policy.confirmation
    assert remembered.status == "proposed" and remembered.validated_text is None
    context = context_for(service.units, profile, remembered.id)
    assert context.reuse == "memory" and context.references[0].interpretation_id == source.id
    assert reuse.interpreter.provider.interpret.await_count == 1
    service.validate(event(profile, source, ValidationAction.REJECT))
    with pytest.raises(MemorySuggestionConflict):
        service.validate(event(profile, remembered, ValidationAction.CONFIRM))
    run(reuse, profile, completed(service, profile, blocks))
    assert reuse.interpreter.provider.interpret.await_count == 2


def test_changed_meaning_blocks_memory_proposal_first_acceptance(communication):
    service, profile, _, blocks = communication
    reuse = setup(service)
    source = run(reuse, profile, completed(service, profile, blocks)).candidates[0]
    service.validate(event(profile, source, ValidationAction.CONFIRM))
    copied = run(reuse, profile, completed(service, profile, blocks)).candidates[0]
    with service.units() as store:
        before = store.get(profile, Concept, blocks[0].concept_id)
        after = replace(before, label="Un autre bruit")
        store.save(profile, after)
        store.audit(profile, "concept_renamed", before, after, "human:user")
    with pytest.raises(MemorySuggestionConflict):
        service.validate(event(profile, copied, ValidationAction.CONFIRM))
    assert service.validate(event(profile, copied, ValidationAction.REJECT)).status == "rejected"


def test_expiry_is_fixed_and_refresh_bypasses_pending_and_accepted_results(communication):
    service, profile, _, blocks = communication
    reuse = setup(service)
    start = utc_now()
    reuse.clock = lambda: start
    source = run(reuse, profile, completed(service, profile, blocks)).candidates[0]
    reuse.clock = lambda: start + timedelta(hours=23)
    run(reuse, profile, completed(service, profile, blocks))
    assert len(reuse.transient.puts) == 1
    reuse.clock = lambda: start + timedelta(hours=24)
    run(reuse, profile, completed(service, profile, blocks))
    assert reuse.interpreter.provider.interpret.await_count == 2
    run(reuse, profile, completed(service, profile, blocks), refresh=True)
    assert reuse.interpreter.provider.interpret.await_count == 3
    service.validate(event(profile, source, ValidationAction.CORRECT, PERSONAL))
    run(reuse, profile, completed(service, profile, blocks), refresh=True)
    assert reuse.interpreter.provider.interpret.await_count == 4
    assert run(reuse, profile, completed(service, profile, blocks)).candidates[0].text == PERSONAL
    assert reuse.interpreter.provider.interpret.await_count == 4


@pytest.mark.parametrize(
    "change", ["order", "repeat", "meaning", "context", "configuration", "policy"]
)
def test_cache_identity_tracks_selection_meaning_context_and_runtime_configuration(
    communication, change
):
    from app.domain.pcl.confidence import ConfidencePolicy

    service, profile, _, blocks = communication
    reuse = setup(service)
    run(reuse, profile, completed(service, profile, blocks))
    options = {}
    if change == "order":
        blocks = blocks[::-1]
    elif change == "repeat":
        blocks = (*blocks, blocks[0])
    elif change == "context":
        options["declared_context"] = ("Un autre lieu",)
    elif change == "configuration":
        reuse.configuration = {"version": 2}
    elif change == "policy":
        reuse.policy = ConfidencePolicy(refusal=0.45)
    else:
        with service.units() as store:
            before = store.get(profile, Concept, blocks[0].concept_id)
            after = replace(before, label="Autre sens")
            store.save(profile, after)
            store.audit(profile, "concept_renamed", before, after, "human:user")
    run(reuse, profile, completed(service, profile, blocks), **options)
    assert reuse.interpreter.provider.interpret.await_count == 2


def test_accepted_alignment_preserves_repetitions_order_and_declared_context(communication):
    service, profile, _, blocks = communication
    reuse = setup(service)
    source = run(
        reuse, profile, completed(service, profile, blocks), declared_context=("Maison",)
    ).candidates[0]
    service.validate(event(profile, source, ValidationAction.CORRECT, PERSONAL))
    assert (
        run(reuse, profile, completed(service, profile, blocks), declared_context=("Maison",))
        .candidates[0]
        .source
        == "pcl-memory"
    )
    run(reuse, profile, completed(service, profile, blocks))
    run(reuse, profile, completed(service, profile, blocks[::-1]), declared_context=("Maison",))
    run(
        reuse,
        profile,
        completed(service, profile, (*blocks, blocks[0])),
        declared_context=("Maison",),
    )
    assert reuse.interpreter.provider.interpret.await_count == 4


@pytest.mark.parametrize(
    "payload", [None, {}, {"version": 1, "expires_at": "bad"}, "not-an-object"]
)
def test_malformed_or_missing_cache_is_a_miss(communication, payload):
    service, profile, _, blocks = communication
    reuse = setup(service)
    run(reuse, profile, completed(service, profile, blocks))
    key = next(iter(reuse.transient.values))
    reuse.transient.values[key] = payload
    run(reuse, profile, completed(service, profile, blocks))
    assert reuse.interpreter.provider.interpret.await_count == 2


def test_redis_outage_does_not_fail_normal_generation_or_learn_proposals(communication):
    service, profile, _, blocks = communication
    reuse = setup(service)
    reuse.transient.fail = True
    for _ in range(2):
        assert (
            run(reuse, profile, completed(service, profile, blocks)).candidates[0].text == LITERAL
        )
    assert reuse.interpreter.provider.interpret.await_count == 2
    assert not reuse.transient.puts
    assert not service.memory(profile, validated=True).interpretations


def test_unrecorded_cache_candidates_are_not_trusted(communication):
    service, profile, foreign, blocks = communication
    reuse = setup(service)
    run(reuse, profile, completed(service, profile, blocks))
    key = next(iter(reuse.transient.values))
    # A Redis payload cannot authorize an arbitrary PostgreSQL proposal ID.
    target = completed(service, profile, blocks)
    unrecorded = Interpretation(
        profile_id=profile,
        sequence_id=target.id,
        text=PERSONAL,
        confidence=0.99,
        source="openai-compatible",
    )
    with service.units() as store:
        store.add(profile, unrecorded)
    reuse.transient.values[key]["candidate_ids"] = [str(uuid4()), str(unrecorded.id)]
    assert run(reuse, profile, completed(service, profile, blocks)).candidates[0].text == LITERAL
    assert reuse.interpreter.provider.interpret.await_count == 2
    assert all(scope[0] == profile and scope[0] != foreign for scope in reuse.transient.values)


def test_cache_cannot_cross_profiles_even_with_injected_foreign_ids(communication):
    from app.domain.pcl.entities import CommunicationBlock

    service, profile, foreign, blocks = communication
    reuse = setup(service)
    original = run(reuse, profile, completed(service, profile, blocks))
    other_blocks = tuple(
        CommunicationBlock(
            profile_id=foreign, label=b.label, canonical_intent=b.label, status="validated"
        )
        for b in blocks
    )
    with service.units() as store:
        for block in other_blocks:
            store.add(foreign, block)
    run(reuse, foreign, completed(service, foreign, other_blocks))
    assert reuse.interpreter.provider.interpret.await_count == 2
    key = next(key for key in reuse.transient.values if key[0] == foreign)
    reuse.transient.values[key]["candidate_ids"] = [str(i.id) for i in original.candidates]
    run(reuse, foreign, completed(service, foreign, other_blocks))
    assert reuse.interpreter.provider.interpret.await_count == 3
    assert not service.memory(foreign, validated=True).interpretations


def test_prompt_and_provider_fixture_revisions_invalidate_pending_cache(communication, monkeypatch):
    import app.application.interpretation_reuse as module

    service, profile, _, blocks = communication
    reuse = setup(service)
    run(reuse, profile, completed(service, profile, blocks))
    monkeypatch.setattr(module, "system_instruction", lambda operation: "A changed instruction")
    run(reuse, profile, completed(service, profile, blocks))
    assert reuse.interpreter.provider.interpret.await_count == 2
    reuse.interpreter.provider.cache_revision = "changed-fixture-revision"
    run(reuse, profile, completed(service, profile, blocks))
    assert reuse.interpreter.provider.interpret.await_count == 3


def test_api_wires_pending_cache_and_explicit_refresh(api):
    from unittest.mock import AsyncMock

    base, make_candidate = evolution_fixture(api)
    provider = AsyncMock()
    provider.provider_id = "fake"
    provider.interpret.return_value = InterpretationProposal.model_validate(
        {"candidates": [{"intent": "literal", "text": "Eau, eau.", "confidence": 0.8}]}
    )
    api.app.state.ai_provider = provider
    api.app.state.transient_store = Cache()
    candidate = make_candidate()
    path = f"{base}/sequences/{candidate['sequence_id']}/interpret"
    assert api.post(path, json={}).status_code == 200
    assert provider.interpret.await_count == 1
    assert api.post(path, json={"refresh": True}).status_code == 200
    assert provider.interpret.await_count == 2
    assert api.post(path, json={"refresh": "true"}).status_code == 422


def test_acceptance_while_reading_redis_takes_precedence_over_pending_cache(communication):
    service, profile, _, blocks = communication
    reuse = setup(service)
    source = run(reuse, profile, completed(service, profile, blocks)).candidates[0]
    previous_get = reuse.transient.get

    async def concurrent_acceptance(*args):
        value = await previous_get(*args)
        service.validate(event(profile, source, ValidationAction.CORRECT, PERSONAL))
        return value

    reuse.transient.get = concurrent_acceptance
    result = run(reuse, profile, completed(service, profile, blocks))
    assert result.candidates[0].source == "pcl-memory"
    assert result.candidates[0].text == PERSONAL
    assert reuse.interpreter.provider.interpret.await_count == 1


def test_restore_remaps_cache_lineage_without_recreating_transient_entries(communication):
    import json
    from uuid import UUID

    from app.application.profile_archive import RestoreRequest, parse_archive
    from app.domain.pcl.entities import HumanRole
    from app.infrastructure.postgres.profile_archives import PostgresProfileArchives

    service, profile, _, blocks = communication
    reuse = setup(service)
    original = run(reuse, profile, completed(service, profile, blocks))
    run(reuse, profile, completed(service, profile, blocks))
    archives = PostgresProfileArchives(service.units.factory)
    restored = archives.restore(
        RestoreRequest(
            request_id=uuid4(),
            actor_role=HumanRole.USER,
            confirm=True,
            display_name="Cache fictif restauré",
            snapshot=parse_archive(archives.export(profile)),
        )
    )
    with service.units() as store:
        markers = [
            e
            for e in store.audit_history(
                restored.id, target_type="interpretation", target_id=None, limit=100
            )
            if e.event_type == "interpretation_reuse"
        ]
        assert len(markers) == 4
        for marker in markers:
            root = UUID(json.loads(marker.new_state)["presentation"]["cache_root_id"])
            assert root not in {i.id for i in original.candidates}
            assert store.get(restored.id, Interpretation, root).profile_id == restored.id
    assert all(key[0] == profile for key in reuse.transient.values)


@pytest.mark.redis
def test_real_redis_contains_only_ids_and_reads_do_not_extend_ttl(communication, redis_url):
    from app.application.transient import TransientKind
    from tests.integration.test_redis import stores

    service, profile, _, blocks = communication

    async def scenario():
        async with stores(redis_url) as (store, raw):
            reuse = setup(service, store)
            try:
                result = await reuse.interpret(profile, completed(service, profile, blocks).id)
                key = [key async for key in raw.scan_iter(match=f"pcl:cache:semantic:{profile}:*")][
                    0
                ]
                assert TTL_SECONDS - 5 <= await raw.ttl(key) <= TTL_SECONDS
                payload = await store.get(
                    profile, TransientKind.SEMANTIC_CACHE, key.rsplit(":", 1)[1]
                )
                assert payload["candidate_ids"] == [str(i.id) for i in result.candidates]
                assert set(payload) == {"version", "expires_at", "candidate_ids"}
                await raw.expire(key, 60)
                copy = await reuse.interpret(profile, completed(service, profile, blocks).id)
                assert copy.candidates[0].text == LITERAL
                assert 0 < await raw.ttl(key) <= 60
                assert reuse.interpreter.provider.interpret.await_count == 1
                await raw.delete(key)
                await reuse.interpret(profile, completed(service, profile, blocks).id)
                assert reuse.interpreter.provider.interpret.await_count == 2
            finally:
                await store.delete_profile(profile)

    asyncio.run(scenario())
