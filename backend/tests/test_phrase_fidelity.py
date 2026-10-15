import asyncio
from contextlib import contextmanager
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest

from app.ai.contracts import InterpretationProposal, InterpretationRequest, SelectedBlock
from app.ai.errors import ProviderPayloadError, ProviderUnavailableError
from app.application.communication import CommunicationService
from app.application.interpretation import InterpretationService
from app.application.phrase_fidelity import faithful_words
from app.domain.pcl.confidence import ConfidencePolicy
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Interpretation,
    SequenceStatus,
    utc_now,
)


def request(*labels):
    return InterpretationRequest(
        blocks=tuple(
            SelectedBlock(block_id=uuid4(), label=label, meaning=label) for label in labels
        )
    )


@pytest.mark.parametrize(
    "labels,text,expected",
    [
        (("Papa", "Dormir"), "Papa, je voudrais dormir.", True),
        (("Papa", "Dormir"), "Papa, je voudrais un livre.", False),
        (("Papa", "Maison", "Dormir"), "Papa, je voudrais la maison.", False),
        (("Papa", "Maison", "Dormir"), "Papa, je voudrais retourner à la maison dormir.", False),
        (("Papa", "Toilettes"), "Papa, je voudrais les toilettes.", False),
        (("Papa", "Toilettes"), "Papa, j’ai besoin d’aller aux toilettes.", True),
        (("Papa", "Toilettes"), "Papa, où sont les toilettes ?", True),
        (
            ("Papa", "Dormir", "Maison", "Jouet"),
            "Papa, je voudrais dormir à la maison avec le jouet.",
            True,
        ),
        (("Maman", "Manger", "Papa"), "Maman, Papa, je voudrais manger.", True),
        (("Maman", "Manger", "Papa"), "Maman, je voudrais manger.", False),
        (("Boire", "Eau"), "Je voudrais boire de l’eau.", True),
        (("Boire",), "J'ai soif.", False),
        (("Jouet",), "Je suis content.", False),
        (("Content",), "Je suis contente.", True),
        (("Mal", "Aide", "Stop"), "J’ai mal, aidez-moi : stop.", True),
        (("Non", "Manger"), "Je ne veux pas manger.", True),
        (("Non", "Manger"), "Je veux manger.", False),
        (("Manger",), "Je ne veux pas manger.", False),
        (("Boire", "Boire"), "Je voudrais boire.", False),
        (("Boire", "Boire"), "Boire, boire !", True),
        (("NOISE", "STOP", "LEAVE"), "Bruit, stop : je veux partir.", True),
        (("Livre",), "Je voudrais mon livre.", False),
        (("Alex", "Maison", "Papa", "Content"), "Alex, Papa à la maison ?", False),
        (
            ("Alex", "Maison", "Papa", "Dehors"),
            "Alex, Papa, je voudrais aller à la maison, dehors.",
            False,
        ),
        (("Aller", "Maison"), "Je veux aller à la maison.", True),
        (("Alex", "Maison", "Papa", "Dehors"), "Alex, Papa, je voudrais la maison, dehors.", False),
        (("Chat",), "Le château.", False),
        (("Oui",), "Oui.", True),
        (("Stop",), "Arrêtez !", True),
    ],
)
def test_selected_words_coverage_additions_inflections_negation_and_repetition(
    labels, text, expected
):
    assert faithful_words(request(*labels), text) is expected


def test_demo_annotations_are_not_message_words_and_unknown_paraphrases_fail_closed():
    data = request("Papa", "Dormir")
    data = data.model_copy(
        update={
            "blocks": tuple(
                b.model_copy(update={"meaning": b.meaning + " (démonstration)"})
                for b in data.blocks
            )
        }
    )
    assert faithful_words(data, "Papa, je voudrais dormir.")
    assert not faithful_words(data, "Papa, dormir, démonstration.")
    assert not faithful_words(request("Doudou"), "Je voudrais mon ours.")


class MemoryUnits:
    """Minimal scoped unit for exercising the actual interpreter/persistence pipeline."""

    def __init__(self):
        self.profile = uuid4()
        self.blocks = tuple(
            CommunicationBlock(
                profile_id=self.profile, canonical_intent=word, label=word, status="validated"
            )
            for word in ("Papa", "Dormir")
        )
        self.sequence = CommunicationSequence(
            profile_id=self.profile,
            session_id=uuid4(),
            status=SequenceStatus.COMPLETED,
            created_at=(completed_at := utc_now()),
            completed_at=completed_at,
            block_ids=tuple(b.id for b in self.blocks),
        )
        self.values = {b.id: b for b in (*self.blocks, self.sequence)}

    @contextmanager
    def __call__(self):
        yield self

    def get(self, profile_id, kind, identifier):
        assert profile_id == self.profile
        item = self.values[identifier]
        assert isinstance(item, kind)
        return item

    def list(self, profile_id, kind):
        assert profile_id == self.profile
        return tuple(v for v in self.values.values() if isinstance(v, kind))

    def add(self, profile_id, item):
        assert profile_id == item.profile_id == self.profile
        self.values[item.id] = item

    def correction_examples(self, profile_id, **kwargs):
        assert profile_id == self.profile
        return ()

    def audit(self, *args, **kwargs):
        pass


@pytest.mark.parametrize(
    "failure,reason",
    [
        ("refusal", "model_refusal"),
        ("missing", "unfaithful_words"),
        ("low", "low_confidence"),
        ("payload", "invalid_payload"),
        ("unavailable", "unavailable"),
    ],
)
def test_bad_or_absent_provider_result_preserves_literal_words_and_provenance(failure, reason):
    units = MemoryUnits()
    before = dict(units.values)
    service = CommunicationService(
        units, ConfidencePolicy(refusal=0.6, confirmation=0.7, direct=0.9)
    )
    provider = AsyncMock()
    provider.provider_id = "openai-compatible"
    if failure in ("payload", "unavailable"):
        provider.interpret.side_effect = (
            ProviderPayloadError("invalid")
            if failure == "payload"
            else ProviderUnavailableError("unavailable")
        )
    else:
        provider.interpret.return_value = InterpretationProposal.model_validate(
            {
                "status": "not_understood" if failure == "refusal" else "proposal",
                "candidates": []
                if failure == "refusal"
                else [
                    {
                        "intent": "request",
                        "text": "Papa, je voudrais un livre."
                        if failure == "missing"
                        else "Papa, je voudrais dormir.",
                        "confidence": 0.1 if failure == "low" else 1.0,
                    }
                ],
            }
        )
    # signal is synchronous; use a plain recorder rather than an unawaited mock.
    telemetry = Mock()
    interpreter = InterpretationService(units, service, provider, telemetry=telemetry)
    decision = asyncio.run(interpreter.interpret(units.profile, units.sequence.id))
    assert len(decision.candidates) == 1
    candidate = decision.candidates[0]
    assert candidate.text == "Papa → Dormir" and candidate.source == "pcl"
    assert candidate.validated_text is None and candidate.status == "proposed"
    assert [v for v in units.values.values() if isinstance(v, Interpretation)] == [candidate]
    assert all(units.values[key] == value for key, value in before.items())
    telemetry.signal.assert_called_once_with(
        "interpretation.fallback", provider="openai-compatible", result_state=reason
    )


def test_fidelity_filter_keeps_better_alternative_despite_wrong_high_confidence():
    units = MemoryUnits()
    provider = AsyncMock()
    provider.provider_id = "openai-compatible"
    provider.interpret.return_value = InterpretationProposal.model_validate(
        {
            "candidates": [
                {"intent": "request", "text": "Papa, je voudrais un livre.", "confidence": 1.0},
                {"intent": "request", "text": "Papa, je voudrais dormir.", "confidence": 0.7},
                {"intent": "request", "text": "Papa, dormir.", "confidence": 0.5},
            ],
        }
    )
    interpreter = InterpretationService(units, CommunicationService(units), provider)
    decision = asyncio.run(interpreter.interpret(units.profile, units.sequence.id))
    assert [c.text for c in decision.candidates] == ["Papa, je voudrais dormir.", "Papa, dormir."]
    assert all(
        c.source == "openai-compatible" and c.validated_text is None for c in decision.candidates
    )
