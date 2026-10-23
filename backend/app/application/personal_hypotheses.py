"""Bounded lexical grounding for personal hypotheses, never semantic validation.

Human acceptance can establish an association that generic vocabulary does not
know. One sufficiently close personal reference may support a paraphrase or an
omission. Vocabulary from unrelated references is never pooled together.
"""

from collections import Counter

from app.application.phrase_fidelity import (
    SELECTED_PERSON,
    conflicts_with_meaning,
    content,
    faithful_words,
    words,
)
from app.application.reference_alignment import applicable_reference

NEGATIVE = {"non", "pas", "ne", "n", "jamais", "aucun", "aucune", "sans"}
EXPLICIT_ACTIONS = {
    "boire",
    "manger",
    "dormir",
    "partir",
    "aide",
    "aller",
    "faire",
    "aimer",
    "venir",
    "rentrer",
    "retourner",
    "regarder",
}


def grounding(request, text):
    """Return None for unsupported text, () for literal coverage, or one reference.

    This is an eligibility check, not a claim that a sentence means what the
    person intended. Selected negation, Stop, actions and pronouns remain guarded.
    """
    if conflicts_with_meaning(request, text):
        return None
    if faithful_words(request, text):
        return ()
    if request.language.split("-")[0].casefold() != "fr":
        return None
    selected = tuple(w for b in request.blocks for w in words(b.label))
    output = words(text)
    if bool(NEGATIVE.intersection(selected)) != bool(NEGATIVE.intersection(output)):
        return None
    persons = Counter(SELECTED_PERSON[w] for w in selected if w in SELECTED_PERSON)
    actual_persons = Counter(SELECTED_PERSON[w] for w in output if w in SELECTED_PERSON)
    if persons - actual_persons:
        return None
    required = content(" ".join(b.label for b in request.blocks))
    actual = content(text)
    if not actual:
        return None
    protected = Counter(
        {
            word: count
            for word, count in required.items()
            if word in EXPLICIT_ACTIONS | {"stop", "oui", "non"} or count > 1
        }
    )
    if protected - actual:
        return None
    allowed = set(required)
    for block in request.blocks:
        allowed.update(content(block.meaning))
    current_ids = tuple(b.block_id for b in request.blocks)
    for example in request.memory_examples:
        source_ids = tuple(b.block_id for b in example.blocks)
        if not applicable_reference(current_ids, source_ids):
            continue
        if set(actual) - (allowed | set(content(example.text))):
            continue
        if not (set(actual) & set(required)) and Counter(source_ids) != Counter(current_ids):
            continue
        return (example,)
    return None
