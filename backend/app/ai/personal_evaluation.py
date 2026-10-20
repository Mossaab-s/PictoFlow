"""Synthetic intent and 5–10-touch probes of the real interpretation pipeline.

Offline fixtures never load configuration or call a provider. --live is explicit,
uses only generated profiles, and never opens PostgreSQL or Redis. A retained
hypothesis is not evidence that the model understood the person's intention.
"""

import argparse
import asyncio
import hashlib
import json
import math
import time
from collections import Counter
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from uuid import uuid5

import httpx2 as httpx

from app.ai.contracts import InterpretationProposal
from app.ai.errors import ProviderConfigurationError
from app.ai.evaluation import RecordingProvider, Scenario, SyntheticUnits
from app.ai.manager import ProviderManager
from app.ai.providers.fake import FakeProvider
from app.ai.providers.http import system_instruction
from app.ai.providers.openai_compatible import OpenAICompatibleProvider
from app.application.communication import CommunicationService
from app.application.interpretation import InterpretationService
from app.application.pcl_repository import AcceptedTrace
from app.application.personal_hypotheses import grounding
from app.application.phrase_fidelity import content, faithful_words
from app.application.semantic_space import SemanticNotFoundError
from app.config import Settings
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Interpretation,
    TargetType,
    ValidationEvent,
    utc_now,
)

SIX = ("Maman", "Papa", "Manger", "Maison", "Moi", "Content")
SIX_TEXT = "Maman, Papa, je voudrais manger à la maison. Je suis content."
MEAL = ("Moi", "Manger", "Maison")
ALIAS = ("Moi", "Doudou", "Maison", "Maman", "Content")


@dataclass(frozen=True)
class Reference:
    labels: tuple[str, ...]
    text: str
    occurrences: int = 1
    age_days: int = 1
    status: str = "confirmed"
    foreign: bool = False


@dataclass(frozen=True)
class Probe:
    name: str
    labels: tuple[str, ...]
    texts: tuple[str, ...]
    references: tuple[Reference, ...] = ()
    expected_reason: str | None = None
    live_probe: bool = True
    comparison: str | None = None
    review_focus: str = (
        "Vérifier les actions, les personnes et le sens voulu, pas seulement les mots."
    )
    intents: tuple[str, ...] = ()
    expected_candidates: int | None = None


PROBES = (
    Probe(
        "five_no_memory",
        ("Moi", "Boire", "Eau", "Maman", "Maison"),
        ("Maman, je voudrais boire de l’eau à la maison.",),
    ),
    Probe("six_no_memory", SIX, (SIX_TEXT,), comparison="meal_memory"),
    Probe(
        "six_preference",
        SIX,
        ("Maman, Papa, j’aime manger à la maison.",),
        (Reference(MEAL, "J’aime manger à la maison.", occurrences=4),),
        comparison="meal_memory",
    ),
    Probe(
        "six_request",
        SIX,
        ("Maman, Papa, je voudrais manger chez moi. Je suis content.",),
        (Reference(MEAL, "Je voudrais manger chez moi.", occurrences=4),),
        comparison="meal_memory",
    ),
    Probe(
        "eight_no_memory",
        (*SIX[:4], "Moi", "Boire", "Eau", "Content"),
        ("Maman, Papa, je voudrais manger à la maison et boire de l’eau. Je suis content.",),
    ),
    Probe(
        "ten_no_memory",
        (*SIX[:4], "Moi", "Boire", "Eau", "Lire", "Livre", "Content"),
        (
            "Maman, Papa, je voudrais manger à la maison et boire de l’eau et lire un livre. "
            "Je suis content.",
        ),
    ),
    Probe(
        "five_alias_no_memory",
        ALIAS,
        ("Maman, je voudrais Doudou à la maison. Je suis content.",),
        comparison="personal_alias",
    ),
    Probe(
        "five_alias_bear",
        ALIAS,
        ("Maman, je voudrais mon ours à la maison. Je suis content.",),
        (Reference(("Moi", "Doudou", "Maison"), "Je voudrais mon ours à la maison."),),
        comparison="personal_alias",
    ),
    Probe(
        "five_alias_blanket",
        ALIAS,
        ("Maman, je voudrais ma couverture à la maison. Je suis content.",),
        (Reference(("Moi", "Doudou", "Maison"), "Je voudrais ma couverture à la maison."),),
        comparison="personal_alias",
    ),
    Probe(
        "eight_negation",
        ("Moi", "Non", "Manger", "Maison", "Maman", "Papa", "Boire", "Eau"),
        ("Maman, Papa, je ne veux pas manger à la maison. Je voudrais boire de l’eau.",),
        (
            Reference(
                ("Moi", "Manger", "Maison", "Boire"),
                "Je voudrais manger à la maison et boire de l’eau.",
            ),
        ),
        review_focus="Le souvenir positif ne doit pas effacer le Non choisi aujourd’hui.",
    ),
    Probe(
        "ten_repetition_stop",
        ("Moi", "Maman", "Papa", "Boire", "Eau", "Boire", "Maison", "Manger", "Content", "Stop"),
        (
            "Maman, Papa, je voudrais boire de l’eau, boire à la maison et manger. "
            "Je suis content. Stop.",
        ),
        review_focus="Vérifier les deux Boire et Stop, sans émotion déduite du rythme.",
    ),
    Probe(
        "six_withdrawn_memory",
        SIX,
        ("Maman, Papa, j’aime manger à la maison.",),
        (Reference(MEAL, "J’aime manger à la maison.", status="rejected"),),
        expected_reason="unfaithful_words",
        comparison="meal_memory",
    ),
    Probe(
        "six_foreign_memory",
        SIX,
        ("Maman, Papa, j’aime manger à la maison.",),
        (Reference(MEAL, "J’aime manger à la maison.", foreign=True),),
        expected_reason="unfaithful_words",
        comparison="meal_memory",
    ),
    Probe(
        "six_ambiguous_roles",
        SIX,
        (SIX_TEXT, "Maman et Papa mangent à la maison. Moi, je suis content."),
        review_focus="Plusieurs rôles sont possibles : une phrase grammaticale n’en prouve aucun.",
    ),
    Probe(
        "repetition_guard",
        ("Moi", "Maman", "Boire", "Boire", "Eau"),
        ("Maman, je voudrais boire de l’eau.",),
        expected_reason="unfaithful_words",
        live_probe=False,
    ),
    Probe(
        "memory_budget",
        SIX,
        (SIX_TEXT,),
        tuple(
            Reference(
                SIX, f"Souvenir fictif {i} : Maman, Papa, j’aime manger à la maison.", age_days=i
            )
            for i in range(70)
        ),
        live_probe=False,
        review_focus="Mesurer les limites de 50 références et 32 000 caractères, sans appel IA.",
    ),
    Probe(
        "intent_request_and_statement",
        ("Moi", "Boire", "Eau"),
        ("Je voudrais boire de l’eau.", "Je bois de l’eau."),
        intents=("request", "statement"),
        expected_candidates=2,
        review_focus="La demande et le constat restent deux hypothèses à choisir.",
    ),
    Probe(
        "intent_personal_preference_and_request",
        MEAL,
        ("J’aime manger à la maison.", "Je voudrais manger à la maison."),
        (Reference(MEAL, "J’aime manger à la maison.", occurrences=3),),
        intents=("preference", "request"),
        expected_candidates=2,
        review_focus="La préférence repose sur ce profil ; une demande reste aussi possible.",
    ),
    Probe(
        "intent_question_and_statement",
        ("Maman", "Maison"),
        ("Maman est à la maison ?", "Maman est à la maison."),
        intents=("question", "statement"),
        expected_candidates=2,
        review_focus="La ponctuation interrogative ne doit pas disparaître comme un doublon.",
    ),
    Probe(
        "intent_explicit_refusal",
        ("Moi", "Non", "Manger"),
        ("Je ne veux pas manger.",),
        intents=("refusal",),
        expected_candidates=1,
        review_focus="Un refus explicite n’exige pas d’inventer une lecture affirmative.",
    ),
    Probe(
        "intent_modal_request_variants",
        ("Moi", "Boire", "Eau"),
        ("Je veux boire de l’eau.", "Je voudrais boire de l’eau.", "Je bois de l’eau."),
        intents=("request", "request", "statement"),
        expected_candidates=2,
        review_focus="Deux variantes de politesse ne doivent pas occuper deux choix.",
    ),
    Probe(
        "intent_label_cannot_justify_preference",
        ("Moi", "Boire", "Eau"),
        ("J’aime boire de l’eau.",),
        intents=("preference",),
        expected_candidates=0,
        expected_reason="unfaithful_words",
        review_focus="Une étiquette du modèle ne remplace pas une référence personnelle absente.",
    ),
)


class PersonalUnits(SyntheticUnits):
    """Generated typed human history; SQL eligibility has separate integration tests."""

    def __init__(self, probe):
        super().__init__(Scenario(probe.name, probe.labels))
        self.feedbacks = []
        self.details = {}
        for index, reference in enumerate(probe.references):
            profile = uuid5(self.profile, "other-profile") if reference.foreign else self.profile
            ids = []
            for label in reference.labels:
                block = CommunicationBlock(
                    id=uuid5(profile, label),
                    profile_id=profile,
                    label=label,
                    canonical_intent=label,
                    status="validated",
                )
                self.values.setdefault(block.id, block)
                ids.append(block.id)
            for use in range(reference.occurrences):
                at = utc_now() - timedelta(days=reference.age_days, seconds=use)
                sequence = CommunicationSequence(
                    id=uuid5(profile, f"reference:{index}:{use}"),
                    profile_id=profile,
                    session_id=uuid5(profile, f"session:{index}:{use}"),
                    block_ids=tuple(ids),
                    status="completed",
                    created_at=at,
                    completed_at=at,
                )
                item = Interpretation(
                    id=uuid5(sequence.id, "interpretation"),
                    profile_id=profile,
                    sequence_id=sequence.id,
                    text=reference.text,
                    confidence=0.8,
                    source="synthetic-human-history",
                    status=reference.status,
                    created_at=at,
                )
                self.values[sequence.id] = sequence
                self.values[item.id] = item
                if reference.status in ("confirmed", "rejected"):
                    self.feedbacks.append(
                        ValidationEvent(
                            profile_id=profile,
                            target_type=TargetType.INTERPRETATION,
                            target_id=item.id,
                            action="confirm" if item.validated_text else "reject",
                            actor_role="user",
                            created_at=at,
                        )
                    )

    def get(self, profile, kind, identifier):
        value = self.values.get(identifier)
        if profile != self.profile or not isinstance(value, kind) or value.profile_id != profile:
            raise SemanticNotFoundError("Synthetic object outside this profile")
        return value

    def list(self, profile, kind):
        assert profile == self.profile
        return tuple(
            v for v in self.values.values() if isinstance(v, kind) and v.profile_id == profile
        )

    def accepted_traces(self, profile, *, block_ids, exclude_sequence_id, reference_id=None):
        assert profile == self.profile
        result = []
        for item in self.list(profile, Interpretation):
            if not item.validated_text or (reference_id is not None and item.id != reference_id):
                continue
            history = [
                e for e in self.feedbacks if e.profile_id == profile and e.target_id == item.id
            ]
            if not history or history[-1].action not in ("confirm", "correct"):
                continue
            sequence = self.get(profile, CommunicationSequence, item.sequence_id)
            if sequence.status != "completed" or sequence.id == exclude_sequence_id:
                continue
            if not set(sequence.block_ids).intersection(block_ids):
                continue
            result.append(
                AcceptedTrace(
                    item.id,
                    sequence.id,
                    sequence.block_ids,
                    item.validated_text,
                    history[-1].created_at,
                )
            )
        return tuple(result)

    def audit(self, profile, event_type, *args, new_details=None):
        super().audit(profile, event_type, *args, new_details=new_details)
        if new_details and event_type != "interpretation_attempt":
            self.details[args[1].id] = new_details


class DiagnosticTransport(httpx.AsyncBaseTransport):
    """Allowlisted numeric diagnostics only; never retain credentials or response bodies."""

    def __init__(self, inner=None):
        self.inner = inner or httpx.AsyncHTTPTransport()
        self.events = []

    async def handle_async_request(self, request):
        start = time.monotonic()
        event = {}
        try:
            response = await self.inner.handle_async_request(request)
            event["status"] = response.status_code
            for header, key in (
                ("retry-after", "retry_after_seconds"),
                ("x-ratelimit-limit-tokens", "token_limit_per_minute"),
                ("x-ratelimit-remaining-tokens", "tokens_remaining"),
            ):
                try:
                    value = float(response.headers[header])
                    if math.isfinite(value) and 0 <= value <= 1_000_000_000:
                        event[key] = value
                except (ValueError, KeyError):
                    pass
            return response
        except httpx.HTTPError as error:
            event["error_class"] = type(error).__name__
            raise
        finally:
            event["elapsed_ms"] = round((time.monotonic() - start) * 1000)
            self.events.append(event)

    async def aclose(self):
        await self.inner.aclose()


class RecordingResult(RecordingProvider):
    """Only validated structured results from synthetic requests are retained."""

    def __init__(self, provider):
        super().__init__(provider)
        self.result = None

    async def interpret(self, request):
        self.result = await super().interpret(request)
        return self.result


def selected_probes(names=(), *, live=False):
    if set(names) - {p.name for p in PROBES}:
        raise ValueError("Unknown personal evaluation scenario")
    selected = tuple(
        p for p in PROBES if (not names or p.name in names) and (not live or p.live_probe)
    )
    if not selected:
        raise ValueError("No applicable personal evaluation scenario")
    return selected


def surface_differences(request, text):
    """Review clues, not a replacement for grounding or its per-reference rules."""
    required = content(" ".join(b.label for b in request.blocks))
    actual = content(text)
    allowed = set(required)
    for block in request.blocks:
        allowed.update(content(block.meaning))
    for reference in request.memory_examples:
        allowed.update(content(reference.text))
    return {
        "missing_selected_content": dict(required - actual),
        "content_outside_selected_meanings_and_references": {
            word: count for word, count in actual.items() if word not in allowed
        },
    }


async def evaluate(
    provider=None, *, scenario_names=(), interval_seconds=0, diagnostics=None, progress=None
):
    if not math.isfinite(interval_seconds) or not 0 <= interval_seconds <= 60:
        raise ValueError("Interval must be finite and between 0 and 60 seconds")
    results = []
    aborted = None
    for probe in selected_probes(scenario_names, live=provider is not None):
        if results and provider is not None and interval_seconds:
            await asyncio.sleep(interval_seconds)
        units = PersonalUnits(probe)
        original = dict(units.values)
        feedbacks = tuple(units.feedbacks)
        communication = CommunicationService(units)
        ai = InterpretationService(units, communication, provider)
        request = ai.request(units.profile, units.sequence.id)
        if provider is None:
            response = InterpretationProposal.model_validate(
                {
                    "candidates": [
                        {
                            "intent": probe.intents[index] if probe.intents else "synthetic",
                            "text": text,
                            "confidence": 0.85,
                        }
                        for index, text in enumerate(probe.texts)
                    ]
                }
            )
            ai.provider = FakeProvider(
                {"interpretations": [{"request": request, "response": response}]}
            )
        recorder = RecordingResult(ai.provider)
        ai.provider = recorder
        before_http = len(diagnostics.events) if diagnostics else 0
        start = time.monotonic()
        decision = await ai.interpret(units.profile, units.sequence.id)
        receipt = units.receipts[0]
        row = {
            "scenario": probe.name,
            "comparison": probe.comparison,
            "selected_words": list(probe.labels),
            "touch_count": len(probe.labels),
            "review_focus": probe.review_focus,
            "memory_examples": [e.model_dump(mode="json") for e in request.memory_examples],
            "memory_example_characters": sum(
                len(e.model_dump_json()) for e in request.memory_examples
            ),
            "request_characters": len(request.model_dump_json()),
            "provider_texts": recorder.texts,
            "provider_status": recorder.result.status if recorder.result else None,
            "provider_intent_labels": [c.intent for c in recorder.result.candidates]
            if recorder.result
            else [],
            "retained_intent_labels": [
                units.details[c.id]["provider_intent"]
                for c in decision.candidates
                if c.source != "pcl"
            ],
            "token_usage": {
                "input": recorder.result.metadata.input_tokens,
                "output": recorder.result.metadata.output_tokens,
            }
            if recorder.result and recorder.result.metadata
            else None,
            "candidate_checks": [
                {
                    "text": text,
                    "provider_intent_label": recorder.result.candidates[index].intent,
                    "confidence": recorder.result.candidates[index].confidence,
                    "retained": any(
                        c.source != "pcl" and c.text == text for c in decision.candidates
                    ),
                    "retained_confidence": next(
                        (
                            c.confidence
                            for c in decision.candidates
                            if c.source != "pcl" and c.text == text
                        ),
                        None,
                    ),
                    "strict_word_coverage": faithful_words(request, text),
                    "surface_differences": surface_differences(request, text),
                    "grounding": "unsupported"
                    if grounding(request, text) is None
                    else "personal_reference"
                    if grounding(request, text)
                    else "strict_words",
                }
                for index, text in enumerate(recorder.texts)
            ],
            "proposed_texts": [c.text for c in decision.candidates],
            "candidate_sources": [c.source for c in decision.candidates],
            "decision_state": decision.state.value,
            "fallback_reason": receipt["fallback_reason"],
            "received_candidates": receipt["received_candidates"],
            "retained_candidates": receipt["retained_candidates"],
            "personal_hypotheses": sum(
                bool(units.details.get(c.id, {}).get("personal_hypothesis"))
                for c in decision.candidates
            ),
            "all_unvalidated": all(c.validated_text is None for c in decision.candidates),
            "source_memory_unchanged": all(units.values[k] == v for k, v in original.items())
            and tuple(units.feedbacks) == feedbacks,
            "elapsed_ms": round((time.monotonic() - start) * 1000),
            "http": diagnostics.events[before_http:] if diagnostics else [],
            "fixture_passed": (
                receipt["fallback_reason"] == probe.expected_reason
                and (
                    probe.expected_candidates is None
                    or receipt["retained_candidates"] == probe.expected_candidates
                )
            )
            if provider is None
            else None,
        }
        results.append(row)
        if progress:
            progress(row)
        if any(e.get("status") in (401, 403) for e in row["http"]):
            aborted = "authentication_failed"
            break
        if any(e.get("status") == 429 for e in row["http"]):
            aborted = "rate_limited"
            break
    return {
        "version": 1,
        "mode": "live" if provider else "fixtures",
        "synthetic_only": True,
        "provider": provider.provider_id if provider else "fake",
        "generated_at": utc_now().isoformat(),
        "prompt_sha256": hashlib.sha256(system_instruction("interpret").encode()).hexdigest(),
        "requires_human_semantic_review": True,
        "intent_label_limit": (
            "Provider intent labels are unverified hints, not semantic accuracy or PCL facts."
        ),
        "aborted_reason": aborted,
        "summary": dict(Counter(r["fallback_reason"] or "provider_proposal" for r in results)),
        "scenarios": results,
    }


async def run(
    live=False,
    *,
    scenario_names=(),
    interval_seconds=10,
    response_format=None,
    settings=None,
    progress=None,
):
    selected_probes(scenario_names, live=live)
    if not live:
        return await evaluate(scenario_names=scenario_names)
    settings = settings or Settings()
    if settings.ai_provider != "openai-compatible":
        raise ProviderConfigurationError("Live probes require an OpenAI-compatible provider")
    transport = DiagnosticTransport()
    chosen_format = response_format or settings.provider_response_format
    provider = ProviderManager(
        OpenAICompatibleProvider(
            settings.provider_base_url,
            settings.provider_model,
            api_key=settings.provider_api_key,
            response_format=chosen_format,
            temperature=settings.provider_temperature,
            timeout_seconds=settings.provider_timeout_seconds,
            transport=transport,
        )
    )
    try:
        report = await evaluate(
            provider,
            scenario_names=scenario_names,
            interval_seconds=interval_seconds,
            diagnostics=transport,
            progress=progress,
        )
        report["configuration"] = {
            "model": settings.provider_model,
            "response_format": chosen_format,
            "temperature": settings.provider_temperature,
        }
        return report
    finally:
        await provider.aclose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--scenario", action="append", default=[], choices=[p.name for p in PROBES])
    parser.add_argument("--response-format", choices=["json_object", "json_schema"])
    parser.add_argument("--interval", type=float, default=10)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not math.isfinite(args.interval) or not 0 <= args.interval <= 60:
        parser.error("Interval must be finite and between 0 and 60 seconds")
    try:
        report = asyncio.run(
            run(
                args.live,
                scenario_names=args.scenario,
                interval_seconds=args.interval,
                response_format=args.response_format,
            )
        )
    except (ProviderConfigurationError, ValueError):
        parser.exit(2, "Invalid provider configuration or scenario selection.\n")
    encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")
    return int(
        bool(report["aborted_reason"])
        or any(
            not row["all_unvalidated"]
            or not row["source_memory_unchanged"]
            or row["fixture_passed"] is False
            for row in report["scenarios"]
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
