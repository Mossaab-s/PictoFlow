import asyncio
import json
from dataclasses import replace
from uuid import uuid4

import httpx2 as httpx
import pytest
from pydantic import SecretStr

from app.ai.personal_evaluation import (
    ALIAS,
    PROBES,
    SIX_TEXT,
    DiagnosticTransport,
    PersonalUnits,
    evaluate,
    main,
    run,
    selected_probes,
)
from app.application.semantic_space import SemanticNotFoundError
from app.config import Settings
from app.domain.pcl.entities import CommunicationBlock, Interpretation


def test_long_compositions_exercise_real_memory_selection_grounding_and_proposal_persistence():
    report = asyncio.run(evaluate())
    assert len(report["scenarios"]) == len(PROBES) == 22
    assert report["summary"] == {"provider_proposal": 18, "unfaithful_words": 4}
    assert report["requires_human_semantic_review"] and report["synthetic_only"]
    assert report["aborted_reason"] is None
    assert {row["touch_count"] for row in report["scenarios"]} == {2, 3, 5, 6, 8, 10}
    assert all(
        row["fixture_passed"] and row["all_unvalidated"] and row["source_memory_unchanged"]
        for row in report["scenarios"]
    )
    rows = {row["scenario"]: row for row in report["scenarios"]}
    assert rows["six_preference"]["personal_hypotheses"] == 1
    assert rows["six_preference"]["memory_examples"][0]["occurrences"] == 4
    assert rows["six_preference"]["candidate_checks"][0]["grounding"] == "personal_reference"
    assert rows["six_no_memory"]["memory_examples"] == []
    for name in ("six_withdrawn_memory", "six_foreign_memory"):
        assert rows[name]["memory_examples"] == []
        assert rows[name]["fallback_reason"] == "unfaithful_words"
    assert (
        rows["five_alias_bear"]["selected_words"]
        == rows["five_alias_blanket"]["selected_words"]
        == list(ALIAS)
    )
    assert (
        rows["five_alias_bear"]["memory_examples"][0]["text"]
        != rows["five_alias_blanket"]["memory_examples"][0]["text"]
    )
    assert len(rows["six_ambiguous_roles"]["proposed_texts"]) == 2
    repeated = rows["repetition_guard"]["candidate_checks"][0]["surface_differences"]
    assert repeated["missing_selected_content"] == {"boire": 1}
    alias = rows["five_alias_bear"]["candidate_checks"][0]
    assert alias["surface_differences"]["missing_selected_content"] == {"doudou": 1}
    assert alias["grounding"] == "personal_reference"  # A surface difference can be legitimate.
    assert alias["confidence"] == 0.85 and alias["retained_confidence"] == 0.65
    budget = rows["memory_budget"]
    assert 0 < len(budget["memory_examples"]) < 50
    assert budget["memory_example_characters"] <= 32_000


def test_synthetic_adapter_never_returns_foreign_or_unaccepted_history():
    probe = next(p for p in PROBES if p.name == "six_foreign_memory")
    units = PersonalUnits(probe)
    assert (
        units.accepted_traces(
            units.profile, block_ids=units.sequence.block_ids, exclude_sequence_id=units.sequence.id
        )
        == ()
    )
    foreign = next(v for v in units.values.values() if v.profile_id != units.profile)
    with pytest.raises(SemanticNotFoundError):
        units.get(units.profile, type(foreign), foreign.id)
    with pytest.raises(SemanticNotFoundError):
        units.get(uuid4(), CommunicationBlock, units.blocks[0].id)
    own = PersonalUnits(next(p for p in PROBES if p.name == "six_preference"))
    for item in own.list(own.profile, Interpretation):
        own.values[item.id] = replace(item, status="proposed")
    assert (
        own.accepted_traces(
            own.profile, block_ids=own.sequence.block_ids, exclude_sequence_id=own.sequence.id
        )
        == ()
    )


def test_intent_probes_preserve_supported_choices_and_expose_labels_without_semantic_claims():
    names = tuple(p.name for p in PROBES if p.name.startswith("intent_"))
    report = asyncio.run(evaluate(scenario_names=names))
    assert report["requires_human_semantic_review"]
    assert "not semantic accuracy" in report["intent_label_limit"]
    rows = {row["scenario"]: row for row in report["scenarios"]}
    pair = rows["intent_request_and_statement"]
    assert pair["provider_intent_labels"] == ["request", "statement"]
    assert set(pair["retained_intent_labels"]) == {"request", "statement"}
    assert pair["retained_candidates"] == 2
    personal = rows["intent_personal_preference_and_request"]
    assert set(personal["retained_intent_labels"]) == {"preference", "request"}
    assert personal["personal_hypotheses"] == 1
    assert personal["proposed_texts"][0] == "J’aime manger à la maison."
    assert set(rows["intent_question_and_statement"]["retained_intent_labels"]) == {
        "question",
        "statement",
    }
    assert rows["intent_explicit_refusal"]["retained_intent_labels"] == ["refusal"]
    variants = rows["intent_modal_request_variants"]
    assert variants["received_candidates"] == 3 and variants["retained_candidates"] == 2
    assert set(variants["retained_intent_labels"]) == {"request", "statement"}
    unsupported = rows["intent_label_cannot_justify_preference"]
    assert unsupported["provider_intent_labels"] == ["preference"]
    assert unsupported["retained_intent_labels"] == []
    assert unsupported["fallback_reason"] == "unfaithful_words"
    assert all(row["fixture_passed"] and row["source_memory_unchanged"] for row in rows.values())


def test_offline_mode_does_not_read_provider_or_storage_configuration(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Offline probes cannot load credentials or construct an HTTP client")

    monkeypatch.setattr("app.ai.personal_evaluation.Settings", forbidden)
    monkeypatch.setattr("app.ai.personal_evaluation.DiagnosticTransport", forbidden)
    assert asyncio.run(run(False))["mode"] == "fixtures"
    with pytest.raises(ValueError, match="Unknown"):
        asyncio.run(run(False, scenario_names=("unknown",)))
    with pytest.raises(ValueError, match="No applicable"):
        asyncio.run(run(True, scenario_names=("memory_budget",)))


@pytest.mark.parametrize("interval", [-1, 61, float("nan"), float("inf")])
def test_invalid_pacing_is_rejected_before_any_provider_request(interval):
    with pytest.raises(ValueError, match="Interval"):
        asyncio.run(evaluate(interval_seconds=interval))


def configured():
    return Settings(
        _env_file=None,
        ai_provider="openai-compatible",
        provider_base_url="https://synthetic.invalid/v1",
        provider_model="synthetic-model",
        provider_api_key=SecretStr("synthetic-secret-never-publish"),
    )


@pytest.mark.parametrize(
    "status,reason,abort",
    [
        (400, "invalid_payload", None),
        (401, "unavailable", "authentication_failed"),
        (403, "unavailable", "authentication_failed"),
        (429, "unavailable", "rate_limited"),
    ],
)
def test_live_diagnostics_distinguish_transport_causes_without_retaining_secrets(
    monkeypatch,
    status,
    reason,
    abort,
):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            status,
            json={
                "error": {
                    "code": "json_validate_failed",
                    "message": "synthetic-secret-never-publish",
                }
            },
            headers={
                "retry-after": "12.5",
                "x-ratelimit-limit-tokens": "8000",
                "x-ratelimit-remaining-tokens": "0",
                "x-private-secret": "do-not-record",
            },
        )

    transport = DiagnosticTransport(httpx.MockTransport(handler))
    monkeypatch.setattr("app.ai.personal_evaluation.DiagnosticTransport", lambda: transport)
    report = asyncio.run(
        run(
            True,
            settings=configured(),
            interval_seconds=0,
            scenario_names=("six_no_memory",) if abort is None else (),
        )
    )
    assert report["aborted_reason"] == abort
    assert len(calls) == len(report["scenarios"]) == 1
    row = report["scenarios"][0]
    assert row["fallback_reason"] == reason and row["http"][0]["status"] == status
    assert row["http"][0]["retry_after_seconds"] == 12.5
    assert row["http"][0]["token_limit_per_minute"] == 8000
    assert row["source_memory_unchanged"] and row["all_unvalidated"]
    encoded = json.dumps(report)
    assert "synthetic-secret-never-publish" not in encoded and "do-not-record" not in encoded
    assert "Authorization" not in encoded and "message" not in row["http"][0]


def test_timeout_is_redacted_and_is_not_counted_as_a_semantic_failure(monkeypatch):
    def handler(request):
        raise httpx.ReadTimeout("private-secret-error", request=request)

    transport = DiagnosticTransport(httpx.MockTransport(handler))
    monkeypatch.setattr("app.ai.personal_evaluation.DiagnosticTransport", lambda: transport)
    report = asyncio.run(
        run(True, settings=configured(), interval_seconds=0, scenario_names=("six_no_memory",))
    )
    row = report["scenarios"][0]
    assert row["fallback_reason"] == "unavailable"
    assert row["http"][0]["error_class"] == "ReadTimeout"
    assert "private-secret-error" not in json.dumps(report)


@pytest.mark.parametrize(
    "headers",
    [
        {"retry-after": "private-secret"},
        {"retry-after": "nan"},
        {"retry-after": "-1"},
        {"x-ratelimit-remaining-tokens": "inf"},
    ],
)
def test_diagnostic_headers_are_bounded_numbers_only(headers):
    async def inspect():
        transport = DiagnosticTransport(
            httpx.MockTransport(lambda request: httpx.Response(200, headers=headers))
        )
        try:
            await transport.handle_async_request(httpx.Request("GET", "https://synthetic.invalid"))
            return transport.events
        finally:
            await transport.aclose()

    assert set(asyncio.run(inspect())[0]) == {"status", "elapsed_ms"}


@pytest.mark.parametrize("response_format", ["json_object", "json_schema"])
def test_real_adapter_reports_received_candidates_separately_from_filtering(
    monkeypatch, response_format
):
    def handler(request):
        body = json.loads(request.content)
        assert body["response_format"]["type"] == response_format
        proposal = {
            "status": "proposal",
            "candidates": [
                {"intent": "synthetic", "text": SIX_TEXT, "confidence": 0.8},
                {"intent": "synthetic", "text": "Je suis en colère.", "confidence": 0.9},
            ],
        }
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps(
                                {"result": proposal}
                                if response_format == "json_schema"
                                else proposal
                            ),
                        },
                    }
                ],
                "usage": {"prompt_tokens": 1234, "completion_tokens": 123},
            },
        )

    transport = DiagnosticTransport(httpx.MockTransport(handler))
    monkeypatch.setattr("app.ai.personal_evaluation.DiagnosticTransport", lambda: transport)
    report = asyncio.run(
        run(
            True,
            settings=configured(),
            response_format=response_format,
            interval_seconds=0,
            scenario_names=("six_no_memory",),
        )
    )
    row = report["scenarios"][0]
    assert row["provider_texts"] == [SIX_TEXT, "Je suis en colère."]
    assert row["proposed_texts"] == [SIX_TEXT]
    assert [c["retained"] for c in row["candidate_checks"]] == [True, False]
    assert [c["grounding"] for c in row["candidate_checks"]] == ["strict_words", "unsupported"]
    assert row["token_usage"] == {"input": 1234, "output": 123}
    assert report["requires_human_semantic_review"] and row["fixture_passed"] is None


def test_cli_writes_a_synthetic_report_and_never_selects_offline_stress_probes_for_live(
    monkeypatch, tmp_path
):
    target = tmp_path / "report.json"
    monkeypatch.setattr("sys.argv", ["personal-evaluation", "--output", str(target)])
    assert main() == 0
    assert json.loads(target.read_text(encoding="utf-8"))["mode"] == "fixtures"
    assert len(selected_probes(live=True)) == 20
