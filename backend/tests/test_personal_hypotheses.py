from uuid import uuid4

from app.ai.contracts import MemoryExample
from app.application.personal_hypotheses import grounding
from tests.test_phrase_fidelity import request


def grounded(labels, text, source_labels=None):
    current = request(*labels)
    blocks = (
        current.blocks
        if source_labels is None
        else tuple(b for b in current.blocks if b.label in source_labels)
    )
    reference = MemoryExample(reference_id=uuid4(), blocks=blocks, text=text)
    return current.model_copy(update={"memory_examples": (reference,)})


def test_six_touches_form_a_natural_message_and_personal_memory_supports_a_preference():
    labels = ("Maman", "Papa", "Manger", "Maison", "MOI", "Content")
    current = request(*labels)
    assert grounding(current, "Maman, Papa, je voudrais manger à la maison. Je suis content.") == ()
    assert grounding(current, "Maman, Papa, je voudrais manger à la maison.") is None
    personal = grounded(labels, "J’aime manger à la maison.", ("MOI", "Manger", "Maison"))
    assert (
        grounding(personal, "Maman, Papa, j’aime manger à la maison.") == personal.memory_examples
    )
    assert (
        grounding(personal, "Maman, Papa, je voudrais manger à la maison.")
        == personal.memory_examples
    )
    assert grounding(current, "Maman, Papa, j’aime manger à la maison.") is None


def test_personal_alias_is_specific_to_accepted_reference_and_not_a_global_mapping():
    labels = ("Doudou",)
    personal = grounded(labels, "Je voudrais mon ours.")
    assert grounding(personal, "Je voudrais mon ours.") == personal.memory_examples
    assert grounding(request(*labels), "Je voudrais mon ours.") is None


def test_reference_cannot_override_negation_stop_action_or_selected_person():
    for labels, reference, proposed in (
        (("Moi", "Non", "Manger"), "Je veux manger.", "Je veux manger."),
        (("Moi", "Manger"), "Je ne veux pas manger.", "Je ne veux pas manger."),
        (("Moi", "Stop", "Boire"), "J’ai soif.", "J’ai soif."),
        (("Moi", "Boire"), "Je voudrais dormir.", "Je voudrais dormir."),
        (("Toi", "Manger"), "Je voudrais manger du pain.", "Je voudrais manger du pain."),
    ):
        assert grounding(grounded(labels, reference), proposed) is None


def test_unrelated_memory_vocabulary_cannot_be_pooled_into_one_hypothesis():
    personal = grounded(("Moi", "Manger", "Maison"), "Je voudrais manger du pain à la maison.")
    second = MemoryExample(
        reference_id=uuid4(), blocks=personal.blocks, text="Je voudrais manger du riz à la maison."
    )
    both = personal.model_copy(update={"memory_examples": (*personal.memory_examples, second)})
    assert grounding(both, "Je voudrais manger du pain et du riz à la maison.") is None
    assert grounding(both, "Je voudrais manger du pain à la maison.") == personal.memory_examples


def test_small_overlap_cannot_import_a_long_old_message():
    personal = grounded(("Moi", "Manger", "Maison"), "Je voudrais manger du gâteau.", ("Manger",))
    assert grounding(personal, "Je voudrais manger du gâteau.") is None
