"""Synthetic regressions for natural television phrases and declared word senses."""

from uuid import uuid4

import pytest

from app.ai.contracts import MemoryExample
from app.application.personal_hypotheses import grounding
from app.application.phrase_fidelity import ambiguous_meaning, faithful_words, inferred_linking
from tests.test_phrase_fidelity import request


def personal_couche(meaning):
    current = request("Couche", "Maman", "Dormir")
    return current.model_copy(
        update={
            "blocks": (
                current.blocks[0].model_copy(update={"meaning": meaning}),
                *current.blocks[1:],
            )
        }
    )


@pytest.mark.parametrize(
    "labels,text,expected",
    [
        (("Maman", "Télévision"), "Maman, je voudrais regarder la télévision.", True),
        (("Maman", "Télévision"), "Maman regarde la télévision ?", True),
        (("Moi", "Télévision"), "Je regarde la télévision.", True),
        (("Toi", "Télévision"), "Tu regardes la télévision ?", True),
        (("Nous", "Télévision"), "Nous regardons la télévision.", True),
        (("Vous", "Télévision"), "Vous regardez la télévision ?", True),
        (("Maman", "Papa", "Télévision"), "Maman et Papa regardent la télévision.", True),
        (("Moi", "Télé"), "Je voudrais regarder la télé.", True),
        (("Non", "Télévision"), "Je ne veux pas regarder la télévision.", True),
        (("Regarder", "Maman"), "Maman regarde.", True),
        (("Maman", "Télévision"), "Maman regarde le livre.", False),
        (("Maman", "Livre"), "Maman regarde le livre.", False),
        (("Maman", "Télévision"), "Maman achète la télévision.", False),
        (("Maman", "Télévision"), "Maman regarde la télévision à la maison.", False),
        (("Moi", "Télévision"), "Tu regardes la télévision.", False),
        (("Non", "Télévision"), "Je regarde la télévision.", False),
        (("Stop", "Télévision"), "Je regarde la télévision.", False),
        (("Télévision", "Télévision"), "Je regarde la télévision.", False),
        (("Boire", "Télévision"), "Je regarde la télévision.", False),
        (("Maman", "Télévision"), "Maman est triste, elle regarde la télévision.", False),
    ],
)
def test_television_link_is_bounded_and_preserves_explicit_content(labels, text, expected):
    assert faithful_words(request(*labels), text) is expected


def test_watch_link_depends_on_personal_meaning_and_explicit_actions_are_protected():
    current = request("Maman", "Télévision")
    assert inferred_linking(current, "Maman regarde la télévision.")
    changed = current.model_copy(
        update={
            "blocks": (current.blocks[0], current.blocks[1].model_copy(update={"meaning": "Pause"}))
        }
    )
    assert not faithful_words(changed, "Maman regarde la télévision.")
    explicit = request("Regarder", "Télévision")
    assert not inferred_linking(explicit, "Regarder la télévision.")
    reference = MemoryExample(reference_id=uuid4(), blocks=explicit.blocks, text="La télévision.")
    assert (
        grounding(explicit.model_copy(update={"memory_examples": (reference,)}), reference.text)
        is None
    )


@pytest.mark.parametrize("meaning", ["Protection hygiénique", "Couche pour bébé", "Couche-culotte"])
def test_declared_diaper_cannot_be_turned_into_a_sleep_verb_even_by_a_reference(meaning):
    current = personal_couche(meaning)
    valid = "Maman, je voudrais une couche pour dormir."
    assert faithful_words(current, valid)
    assert not ambiguous_meaning(current)
    assert faithful_words(current, "Couche → Maman → Dormir")
    for text in (
        "Maman, je me couche pour dormir.",
        "Maman couche pour dormir.",
        "Maman, je voudrais me coucher pour dormir.",
        "Maman, une couche, je me couche pour dormir.",
        "Maman est couchée pour dormir.",
    ):
        reference = MemoryExample(reference_id=uuid4(), blocks=current.blocks, text=text)
        assert not faithful_words(current, text)
        assert grounding(current.model_copy(update={"memory_examples": (reference,)}), text) is None


def test_generic_couche_stays_ambiguous_and_declared_action_is_respected():
    generic = personal_couche("Couche")
    assert ambiguous_meaning(generic)
    assert faithful_words(generic, "Maman, je me couche pour dormir.")
    action = personal_couche("Se coucher")
    assert not ambiguous_meaning(action)
    assert faithful_words(action, "Maman, je me couche pour dormir.")
    # A noun meaning does not prohibit a separately selected coucher action.
    noun = personal_couche("Protection hygiénique")
    action_block = request("Coucher").blocks[0]
    both = noun.model_copy(update={"blocks": (*noun.blocks, action_block)})
    assert faithful_words(both, "Maman, une couche pour me coucher et dormir.")
