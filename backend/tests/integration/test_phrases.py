"""Actual PostgreSQL shortcut ownership, human decisions and archive compatibility."""

import hashlib
import json
from dataclasses import replace
from uuid import UUID

import pytest
from alembic import command
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.application.phrases import PhraseConflict, PhraseService
from app.application.profile_archive import ArchiveError, parse_archive, parse_restore
from app.application.semantic_space import SemanticNotFoundError
from app.domain.pcl.entities import HumanRole, Interpretation, ProposalStatus, ValidationAction
from app.infrastructure.postgres.models import (
    AuditRow,
    InterpretationRow,
    ProfileRestoreRow,
    ValidationRow,
)
from tests.integration import test_communication as communication_scenarios
from tests.integration import test_profile_archives as archive_scenarios
from tests.integration.conftest import migration_config
from tests.integration.test_communication import completed, event, proposal
from tests.integration.test_profile_archives import fixture_archive, restore_body

pytestmark = pytest.mark.postgres


@pytest.fixture
def communication(postgres_connection):
    return communication_scenarios.communication.__wrapped__(postgres_connection)


@pytest.fixture
def api(postgres_connection):
    yield from archive_scenarios.api.__wrapped__(postgres_connection)


def confirmed(communication):
    service, profile, foreign, blocks = communication
    seq = completed(service, profile, (blocks[0], blocks[0], blocks[1]))
    item, _ = proposal(service, profile, seq)
    item = service.validate(event(profile, item, ValidationAction.CORRECT, "Je veux du calme."))
    return service, PhraseService(service.units), profile, foreign, blocks, seq, item


def choose(phrases, profile, item, selected=True, **overrides):
    return phrases.choose(
        profile,
        item.id,
        selected=selected,
        **{
            "expected_selected": item.shortcut,
            "expected_text": item.validated_text,
            "actor_role": HumanRole.CAREGIVER,
            **overrides,
        },
    )


def counts(service, profile):
    with service.units() as store:
        return tuple(
            store.session.scalar(
                select(func.count()).select_from(row).where(row.profile_id == profile)
            )
            for row in (AuditRow, ValidationRow, InterpretationRow)
        )


def test_reuse_is_read_only_corrected_scoped_and_keeps_repeated_historical_touches(communication):
    service, phrases, profile, foreign, blocks, seq, item = confirmed(communication)
    before = counts(service, profile)
    for _ in range(2):
        value = phrases.read(profile, item.id)
        assert value.interpretation == item and value.interpretation.validated_text != item.text
        assert value.sequence == seq and value.sequence.block_ids[:2] == (blocks[0].id,) * 2
    # A historical accepted phrase remains readable without selecting an archived touch again.
    with service.units() as store:
        store.save(profile, replace(blocks[0], status=ProposalStatus.ARCHIVED))
    assert phrases.read(profile, item.id).sequence == seq
    assert counts(service, profile) == before
    with pytest.raises(SemanticNotFoundError):
        phrases.read(foreign, item.id)


def test_shortcut_choice_survives_reload_is_audited_and_does_not_validate_or_infer(communication):
    service, phrases, profile, foreign, _, _, item = confirmed(communication)
    before = counts(service, profile)
    selected = choose(phrases, profile, item)
    assert selected == replace(item, shortcut=True)
    assert PhraseService(service.units).read(profile, item.id).interpretation.shortcut
    assert counts(service, profile) == (before[0] + 1, before[1], before[2])
    assert choose(phrases, profile, item) == selected  # lost response retry
    assert counts(service, profile) == (before[0] + 1, before[1], before[2])
    with service.units() as store:
        last = store.audit_history(
            profile, target_type="interpretation", target_id=item.id, limit=100
        )[-1]
        assert last.event_type == "phrase_shortcut_selected" and last.source == "human:caregiver"
    with pytest.raises(SemanticNotFoundError):
        choose(phrases, foreign, item)
    removed = choose(phrases, profile, selected, False)
    assert not removed.shortcut and removed.validated_text == item.validated_text
    assert counts(service, profile) == (before[0] + 2, before[1], before[2])


def test_changed_correction_clears_choice_and_stale_text_cannot_bookmark_another_meaning(
    communication,
):
    service, phrases, profile, _, _, _, item = confirmed(communication)
    selected = choose(phrases, profile, item)
    identical = service.validate(
        event(profile, item, ValidationAction.CORRECT, item.validated_text)
    )
    assert identical.shortcut
    updated = service.validate(
        event(profile, item, ValidationAction.CORRECT, "Je veux rester ici.")
    )
    assert not updated.shortcut
    assert phrases.read(profile, item.id).interpretation.validated_text == updated.corrected_text
    with pytest.raises(PhraseConflict):
        choose(phrases, profile, selected)
    assert not phrases.read(profile, item.id).interpretation.shortcut
    assert choose(phrases, profile, updated).shortcut


def test_rejection_removes_shortcut_and_reconfirmation_never_reselects_it(communication):
    service, phrases, profile, _, _, _, item = confirmed(communication)
    choose(phrases, profile, item)
    rejected = service.validate(event(profile, item, ValidationAction.REJECT))
    assert not rejected.shortcut
    with pytest.raises(PhraseConflict):
        phrases.read(profile, item.id)
    with pytest.raises(PhraseConflict):
        choose(phrases, profile, item)
    restored = service.validate(event(profile, item, ValidationAction.CONFIRM))
    assert restored.validated_text == item.corrected_text and not restored.shortcut


def test_unvalidated_and_refusal_messages_cannot_be_reused_or_chosen_even_with_full_confidence(
    communication,
):
    service, profile, _, blocks = communication
    seq = completed(service, profile, blocks)
    item, _ = proposal(service, profile, seq, 1.0)
    phrases = PhraseService(service.units)
    with pytest.raises(PhraseConflict):
        phrases.read(profile, item.id)
    with pytest.raises(PhraseConflict):
        choose(phrases, profile, item, expected_text=item.text)
    with service.units() as store:
        with pytest.raises(IntegrityError), store.session.begin_nested():
            store.session.execute(
                InterpretationRow.__table__.update()
                .where(InterpretationRow.id == item.id)
                .values(shortcut=True)
            )
    proposal(service, profile, seq, 0.0)
    with service.units() as store:
        refusal = next(
            v for v in store.list(profile, Interpretation) if v.status == "not_understood"
        )
    with pytest.raises(PhraseConflict):
        phrases.read(profile, refusal.id)


def test_http_choices_are_typed_scoped_redacted_and_reuse_does_not_call_provider(api, monkeypatch):
    base, download = fixture_archive(api)
    item = next(
        v for v in download.json()["records"]["interpretations"] if v["status"] == "corrected"
    )
    path = base + "/phrases/" + item["id"]
    foreign = "/api/v1/profiles/" + api.post("/api/v1/profiles").json()["id"]

    def unavailable(*args, **kwargs):
        raise AssertionError("Phrase reuse must not call the provider")

    monkeypatch.setattr(api.app.state.ai_provider, "interpret", unavailable)
    assert api.get(path).json()["interpretation"]["corrected_text"] == item["corrected_text"]
    assert api.get(foreign + "/phrases/" + item["id"]).status_code == 404
    body = {
        "selected": True,
        "expected_selected": False,
        "expected_text": item["corrected_text"],
        "actor_role": "professional",
    }
    assert api.patch(path + "/shortcut", json=body).json()["shortcut"] is True
    assert api.patch(foreign + "/phrases/" + item["id"] + "/shortcut", json=body).status_code == 404
    for bad in (
        {**body, "selected": "true"},
        {**body, "actor_role": None},
        {**body, "confidence": 1},
    ):
        response = api.patch(path + "/shortcut", json=bad)
        assert response.status_code == 422 and item["corrected_text"] not in response.text
    response = api.patch(path + "/shortcut", json={**body, "expected_text": "Private stale input"})
    assert response.status_code == 409 and "Private stale input" not in response.text
    api.post(
        base + "/interpretations/" + item["id"] + "/feedback",
        json={"action": "reject", "actor_role": "user"},
    ).raise_for_status()
    assert api.get(path).status_code == 409


def test_v2_backup_preserves_shortcuts_and_v1_restoration_does_not_invent_them(api):
    base, download = fixture_archive(api)
    item = next(
        v for v in download.json()["records"]["interpretations"] if v["status"] == "corrected"
    )
    response = api.patch(
        base + "/phrases/" + item["id"] + "/shortcut",
        json={
            "selected": True,
            "expected_selected": False,
            "expected_text": item["corrected_text"],
            "actor_role": "user",
        },
    )
    assert response.status_code == 200
    snapshot = api.get(base + "/backup").json()
    assert snapshot["version"] == 2
    restored = api.post("/api/v1/profiles/restore", json=restore_body(snapshot))
    assert restored.status_code == 201, restored.text
    target = "/api/v1/profiles/" + restored.json()["id"]
    actual = api.get(target + "/memory").json()["interpretations"][0]
    assert actual["shortcut"] is True and actual["id"] != item["id"]
    assert api.get(target + "/phrases/" + actual["id"]).status_code == 200
    assert api.get(base + "/memory").json()["interpretations"][0]["shortcut"] is True
    # Existing complete v1 snapshots have no shortcut field; compatibility is deliberate.
    old = download.json()
    old["version"] = 1
    for record in old["records"]["interpretations"]:
        record.pop("shortcut")
    old_body = restore_body(old)
    legacy = api.post("/api/v1/profiles/restore", json=old_body)
    assert legacy.status_code == 201, legacy.text
    legacy_base = "/api/v1/profiles/" + legacy.json()["id"]
    assert not api.get(legacy_base + "/memory").json()["interpretations"][0]["shortcut"]
    # Reproduce the canonical v1 envelope used by receipts before this migration.
    old_payload = parse_restore(json.dumps(old_body).encode()).model_dump(mode="json")
    for record in old_payload["snapshot"]["records"]["interpretations"]:
        record.pop("shortcut")
    old_digest = hashlib.sha256(
        json.dumps(
            old_payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        ).encode()
    ).hexdigest()
    with api.app.state.pcl_units.factory() as session:
        receipt = session.get(ProfileRestoreRow, UUID(old_body["request_id"]))
        assert receipt.payload_digest == old_digest
    retry = api.post("/api/v1/profiles/restore", json=old_body)
    assert retry.status_code == 201 and retry.json()["id"] == legacy.json()["id"]
    incomplete = api.get(base + "/backup").json()
    incomplete["records"]["interpretations"][0].pop("shortcut")
    with pytest.raises(ArchiveError):
        parse_archive(json.dumps(incomplete).encode())
    with api.app.state.pcl_units() as store:
        store.purge(UUID(restored.json()["id"]))
    assert api.get(target + "/phrases/" + actual["id"]).status_code == 404
    assert api.get(base + "/memory").json()["interpretations"][0]["shortcut"]


def test_shortcut_migration_preserves_old_messages_and_refuses_lossy_downgrade(postgres_connection):
    config = migration_config(postgres_connection)
    command.downgrade(config, "0008_profile_restore_receipts")
    # SQL construction deliberately represents an application predating the new column.
    profile = postgres_connection.exec_driver_sql(
        "INSERT INTO user_communication_profile(id,version,created_at,updated_at) "
        "VALUES(gen_random_uuid(),1,now(),now()) RETURNING id"
    ).scalar()
    sequence = postgres_connection.exec_driver_sql(
        "INSERT INTO communication_sequence"
        "(id,profile_id,session_id,status,created_at,completed_at) "
        "VALUES(gen_random_uuid(),%s,gen_random_uuid(),'completed',now(),now()) RETURNING id",
        (profile,),
    ).scalar()
    item = postgres_connection.exec_driver_sql(
        "INSERT INTO interpretation"
        "(id,profile_id,sequence_id,text,confidence,source,status,created_at) "
        "VALUES(gen_random_uuid(),%s,%s,'Texte historique',0.9,'fake','confirmed',now()) "
        "RETURNING id",
        (profile, sequence),
    ).scalar()
    command.upgrade(config, "head")
    assert postgres_connection.exec_driver_sql(
        "SELECT text,shortcut FROM interpretation WHERE id=%s", (item,)
    ).one() == ("Texte historique", False)
    postgres_connection.exec_driver_sql(
        "UPDATE interpretation SET shortcut=true WHERE id=%s", (item,)
    )
    with pytest.raises(RuntimeError, match="Retain explicitly chosen"):
        command.downgrade(config, "0008_profile_restore_receipts")
