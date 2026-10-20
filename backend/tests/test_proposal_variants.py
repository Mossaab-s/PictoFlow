import asyncio
from unittest.mock import AsyncMock

import pytest

from app.ai.contracts import InterpretationProposal
from app.application.communication import CommunicationService
from app.application.interpretation import InterpretationService
from app.application.proposal_variants import surface_key
from tests.test_phrase_fidelity import MemoryUnits


@pytest.mark.parametrize(
    "left,right",
    [
        ("Je veux boire de l’eau.", "Je voudrais boire de l'eau."),
        ("  Papa, je veux dormir.\n", "PAPA, je voudrais dormir."),
        ("Je veux de l’eau à côté.", "Je voudrais de l’eau a\u0300 co\u0302te\u0301."),
    ],
)
def test_otherwise_identical_affirmative_modal_requests_share_a_slot(left, right):
    assert surface_key(left) == surface_key(right)


@pytest.mark.parametrize(
    "left,right",
    [
        ("Maman est à la maison.", "Maman est à la maison ?"),
        ("Maman, mange !", "Maman mange."),
        ("Je bois de l’eau.", "Je veux boire de l’eau."),
        ("J’aime boire de l’eau.", "Je veux boire de l’eau."),
        ("Maman, je veux dormir.", "Papa, je voudrais dormir."),
        ("Je veux dormir.", "Je ne veux pas dormir."),
        ("Je ne veux pas dormir.", "Je ne voudrais pas dormir."),
        ("Je veux pas dormir.", "Je voudrais pas dormir."),
        ("Stop, je veux partir.", "Stop, je voudrais partir."),
        ("Je veux boire, puis manger.", "Je voudrais manger, puis boire."),
        ("Je veux boire.", "Je voudrais boire !"),
    ],
)
def test_surface_equivalence_preserves_distinct_content_negation_roles_and_punctuation(left, right):
    assert surface_key(left) != surface_key(right)


def decide(candidates):
    units = MemoryUnits()
    provider = AsyncMock()
    provider.provider_id = "openai-compatible"
    provider.interpret.return_value = InterpretationProposal.model_validate(
        {"candidates": candidates}
    )
    decision = asyncio.run(
        InterpretationService(units, CommunicationService(units), provider).interpret(
            units.profile, units.sequence.id
        )
    )
    assert all(c.validated_text is None for c in decision.candidates)
    return decision


@pytest.mark.parametrize("score", [0.39, 0.4, 0.65, 0.95])
@pytest.mark.parametrize("reverse", [False, True])
def test_duplicate_request_keeps_best_score_and_respects_refusal_in_either_order(score, reverse):
    candidates = [
        {"intent": "request", "text": "Papa, je veux dormir.", "confidence": 0.1},
        {"intent": "other-label", "text": "Papa, je voudrais dormir.", "confidence": score},
    ]
    decision = decide(candidates[::-1] if reverse else candidates)
    assert len(decision.candidates) == 1
    candidate = decision.candidates[0]
    if score < 0.4:
        assert candidate.source == "pcl" and candidate.text == "Papa → Dormir"
    else:
        assert candidate.source == "openai-compatible"
        assert candidate.text == "Papa, je voudrais dormir." and candidate.confidence == score


def test_same_provider_intent_label_does_not_merge_distinct_sentences_or_allow_unknown_words():
    decision = decide(
        [
            {"intent": "request", "text": "Papa, je veux dormir.", "confidence": 0.9},
            {"intent": "request", "text": "Papa, je dors.", "confidence": 0.8},
            {"intent": "request", "text": "Papa, je suis malade.", "confidence": 0.99},
        ]
    )
    assert [c.text for c in decision.candidates] == ["Papa, je veux dormir.", "Papa, je dors."]


def test_personal_request_variants_stay_capped_and_do_not_change_the_accepted_reference():
    from app.ai.personal_evaluation import PersonalUnits, Probe, Reference

    probe = Probe(
        "personal-variants",
        ("Moi", "Doudou", "Maison"),
        (),
        (Reference(("Moi", "Doudou", "Maison"), "Je voudrais mon ours à la maison."),),
    )
    units = PersonalUnits(probe)
    before = dict(units.values)
    provider = AsyncMock()
    provider.provider_id = "fake"
    provider.interpret.return_value = InterpretationProposal.model_validate(
        {
            "candidates": [
                {"intent": "request", "text": "Je veux mon ours à la maison.", "confidence": 0.1},
                {
                    "intent": "request",
                    "text": "Je voudrais mon ours à la maison.",
                    "confidence": 0.99,
                },
            ]
        }
    )
    decision = asyncio.run(
        InterpretationService(units, CommunicationService(units), provider).interpret(
            units.profile, units.sequence.id
        )
    )
    assert decision.state == "confirmation_required"
    (candidate,) = decision.candidates
    assert candidate.text == "Je voudrais mon ours à la maison." and candidate.confidence == 0.65
    assert candidate.validated_text is None
    assert units.details[candidate.id]["personal_hypothesis"]
    assert all(units.values[key] == value for key, value in before.items())
