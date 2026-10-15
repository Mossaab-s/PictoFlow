"""Reproducible synthetic probes of the interpretation pipeline, without a PCL database.

Run: python -m app.ai.evaluation [--live] [--output report.json]
The default runs fixtures only. --live explicitly calls the configured external provider.
Reports describe lexical filtering and fallbacks; human semantic review is still required.
"""

import argparse
import asyncio
import json
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from app.ai.contracts import InterpretationProposal
from app.ai.errors import ProviderConfigurationError, ProviderPayloadError, ProviderUnavailableError
from app.ai.manager import create_provider
from app.ai.providers.fake import FakeProvider
from app.application.communication import CommunicationService
from app.application.interpretation import InterpretationService
from app.config import Settings
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    SequenceStatus,
    utc_now,
)


@dataclass(frozen=True)
class Scenario:
    name: str
    labels: tuple[str, ...]
    text: str = ""
    confidence: float = 0.8
    expected_reason: str | None = None
    live_probe: bool = True
    correction: str | None = None
    review_focus: str = "Le message exprime-t-il le sens voulu, sans ajout ni omission ?"


SCENARIOS = (
    Scenario("action_seule", ("Boire",), "Je voudrais boire."),
    Scenario("personne_besoin", ("Maman", "Boire", "Eau"), "Maman, je voudrais boire de l’eau."),
    Scenario("lieu", ("Papa", "Toilettes"), "Papa, j’ai besoin d’aller aux toilettes."),
    Scenario("negation", ("Non", "Manger"), "Je ne veux pas manger."),
    Scenario("repetition", ("Boire", "Boire"), "Boire, boire !"),
    Scenario(
        "deux_personnes",
        ("Maman", "Manger", "Papa"),
        "Maman, manger, Papa.",
        review_focus="Qui mange ? Les mots seuls ne permettent pas d'attribuer ce rôle.",
    ),
    Scenario("arret", ("Stop",), "Stop."),
    Scenario("aide", ("Mal", "Aide", "Stop"), "J’ai mal, aidez-moi : stop."),
    Scenario("emotion_choisie", ("Content",), "Je suis content."),
    Scenario("demande_moi", ("Moi", "Boire", "Eau"), "Je voudrais boire de l’eau."),
    Scenario("refus_seul", ("Non",), "Non."),
    Scenario("accord_action", ("Oui", "Manger"), "Oui, je voudrais manger."),
    Scenario(
        "ambiguite_relation",
        ("Maman", "Aimer", "Papa"),
        "Maman, aimer, Papa.",
        review_focus="Qui aime qui ? Une phrase grammaticalement correcte peut imposer un rôle.",
    ),
    Scenario(
        "correction_bornee",
        ("Papa", "Dormir"),
        "Papa, je voudrais dormir.",
        correction="Papa, dormir.",
    ),
    Scenario(
        "mot_oublie",
        ("Papa", "Dormir"),
        "Je voudrais dormir.",
        expected_reason="unfaithful_words",
        live_probe=False,
    ),
    Scenario(
        "emotion_inventee",
        ("Jouet",),
        "Je suis content.",
        expected_reason="unfaithful_words",
        live_probe=False,
    ),
    Scenario(
        "negation_oubliee",
        ("Non", "Manger"),
        "Je veux manger.",
        expected_reason="unfaithful_words",
        live_probe=False,
    ),
    Scenario(
        "repetition_oubliee",
        ("Boire", "Boire"),
        "Je voudrais boire.",
        expected_reason="unfaithful_words",
        live_probe=False,
    ),
    Scenario("refus", ("Livre",), expected_reason="model_refusal", live_probe=False),
    Scenario(
        "confiance_faible",
        ("Boire",),
        "Je voudrais boire.",
        confidence=0.1,
        expected_reason="low_confidence",
        live_probe=False,
    ),
    Scenario("json_invalide", ("Boire",), expected_reason="invalid_payload", live_probe=False),
    Scenario("indisponibilite", ("Boire",), expected_reason="unavailable", live_probe=False),
)


class SyntheticUnits:
    """One fresh synthetic profile per scenario; no production storage access."""

    def accepted_traces(self, profile, **kwargs):
        return ()

    def __init__(self, scenario):
        self.profile = uuid5(NAMESPACE_URL, "pictoflow:evaluation:" + scenario.name)
        self.blocks = tuple(
            CommunicationBlock(
                profile_id=self.profile,
                id=uuid5(self.profile, word),
                label=word,
                canonical_intent=word,
                status="validated",
            )
            for word in scenario.labels
        )
        now = utc_now()
        self.sequence = CommunicationSequence(
            profile_id=self.profile,
            session_id=uuid5(self.profile, "session"),
            id=uuid5(self.profile, "sequence"),
            block_ids=tuple(b.id for b in self.blocks),
            status=SequenceStatus.COMPLETED,
            created_at=now,
            completed_at=now,
        )
        self.values = {item.id: item for item in (*self.blocks, self.sequence)}
        self.receipts = []
        self.examples = (scenario.correction,) if scenario.correction else ()

    @contextmanager
    def __call__(self):
        yield self

    def get(self, profile, kind, identifier):
        assert profile == self.profile
        result = self.values[identifier]
        assert isinstance(result, kind)
        return result

    def list(self, profile, kind):
        assert profile == self.profile
        return tuple(item for item in self.values.values() if isinstance(item, kind))

    def add(self, profile, item):
        assert profile == item.profile_id == self.profile
        self.values[item.id] = item

    def correction_examples(self, profile, **kwargs):
        assert profile == self.profile
        return self.examples

    def audit(self, profile, event_type, *args, new_details=None):
        assert profile == self.profile
        if event_type == "interpretation_attempt":
            self.receipts.append(new_details["ai_quality"])


class FailureFixture(FakeProvider):
    def __init__(self, reason):
        super().__init__()
        self.reason = reason

    async def interpret(self, request):
        if self.reason == "invalid_payload":
            raise ProviderPayloadError("Synthetic invalid response")
        raise ProviderUnavailableError("Synthetic unavailable provider")


def fixture(scenario, request):
    if scenario.expected_reason in ("invalid_payload", "unavailable"):
        return FailureFixture(scenario.expected_reason)
    response = InterpretationProposal.model_validate(
        {
            "status": "not_understood"
            if scenario.expected_reason == "model_refusal"
            else "proposal",
            "candidates": []
            if scenario.expected_reason == "model_refusal"
            else [
                {
                    "intent": "synthetic",
                    "text": scenario.text,
                    "confidence": scenario.confidence,
                }
            ],
        }
    )
    return FakeProvider({"interpretations": [{"request": request, "response": response}]})


class RecordingProvider:
    """Keep only synthetic response texts for diagnosing filtered probes."""

    def __init__(self, provider):
        self.provider = provider
        self.provider_id = provider.provider_id
        self.texts = []

    async def interpret(self, request):
        result = await self.provider.interpret(request)
        self.texts = [item.text for item in result.candidates]
        return result


async def evaluate(provider=None, *, interval_seconds: float = 0, scenario_names=()) -> dict:
    unknown = set(scenario_names) - {item.name for item in SCENARIOS}
    if unknown:
        raise ValueError("Unknown evaluation scenario")
    results = []
    for scenario in SCENARIOS:
        if scenario_names and scenario.name not in scenario_names:
            continue
        if provider is not None and not scenario.live_probe:
            continue
        units = SyntheticUnits(scenario)
        communication = CommunicationService(units)
        # Build the same bounded request and exercise actual persistence/fallback decisions.
        ai = InterpretationService(units, communication, provider)
        if provider is None:
            ai.provider = fixture(scenario, ai.request(units.profile, units.sequence.id))
        recorder = RecordingProvider(ai.provider)
        ai.provider = recorder
        if provider is not None and results and interval_seconds:
            await asyncio.sleep(interval_seconds)
        decision = await ai.interpret(units.profile, units.sequence.id)
        receipt = units.receipts[0]
        results.append(
            {
                "scenario": scenario.name,
                "selected_words": list(scenario.labels),
                "review_focus": scenario.review_focus,
                "decision_state": decision.state.value,
                "fallback_reason": receipt["fallback_reason"],
                "received_candidates": receipt["received_candidates"],
                "retained_candidates": receipt["retained_candidates"],
                "correction_examples": receipt["correction_examples"],
                "proposed_texts": [item.text for item in decision.candidates],
                "provider_texts": recorder.texts,
                "candidate_sources": [item.source for item in decision.candidates],
                "all_unvalidated": all(item.validated_text is None for item in decision.candidates),
                "fixture_passed": (receipt["fallback_reason"] == scenario.expected_reason)
                if provider is None
                else None,
            }
        )
    reasons = Counter(item["fallback_reason"] or "provider_proposal" for item in results)
    return {
        "version": 1,
        "mode": "live" if provider else "fixtures",
        "synthetic_only": True,
        "provider": provider.provider_id if provider else "fake",
        "requires_human_semantic_review": True,
        "summary": dict(reasons),
        "scenarios": results,
    }


async def run(live: bool, *, interval_seconds: float = 10, scenario_names=()):
    if not live:
        return await evaluate(scenario_names=scenario_names)
    if scenario_names and not any(
        item.name in scenario_names and item.live_probe for item in SCENARIOS
    ):
        raise ValueError("No live scenario selected")
    settings = Settings()
    if settings.ai_provider not in ("openai-compatible", "prism"):
        raise ProviderConfigurationError("Live evaluation requires a configured external provider")
    provider = create_provider(settings)
    try:
        return await evaluate(
            provider, interval_seconds=interval_seconds, scenario_names=scenario_names
        )
    finally:
        await provider.aclose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live", action="store_true", help="Call the configured provider for live scenarios"
    )
    parser.add_argument(
        "--scenario",
        action="append",
        choices=[item.name for item in SCENARIOS],
        default=[],
        help="Select a scenario (repeatable); default: all applicable scenarios",
    )
    parser.add_argument("--output", type=Path, help="Save the synthetic report as JSON")
    parser.add_argument(
        "--interval",
        type=float,
        default=10,
        help="Seconds between live probes (0 to 60; default 10)",
    )
    args = parser.parse_args()
    if not 0 <= args.interval <= 60:
        parser.error("Interval must be finite and between 0 and 60 seconds")
    if (
        args.live
        and args.scenario
        and not any(item.name in args.scenario and item.live_probe for item in SCENARIOS)
    ):
        parser.error("Select at least one live scenario")
    try:
        report = asyncio.run(
            run(args.live, interval_seconds=args.interval, scenario_names=args.scenario)
        )
    except ProviderConfigurationError:
        parser.exit(2, "External provider configuration is invalid or missing.\n")
    encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")
    return int(
        any(
            not row["all_unvalidated"] or row["fixture_passed"] is False
            for row in report["scenarios"]
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
