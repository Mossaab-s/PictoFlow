"""Conservative French word coverage, not semantic validation or a second model.

Unknown paraphrases fail closed to the literal selection. This detects added/dropped
content words, repetitions and negation; it cannot establish actors' roles or intent.
"""

import re
import unicodedata
from collections import Counter

from app.ai.contracts import InterpretationRequest

# Inflections of the small communication vocabulary, not inferred needs/emotions.
FORMS = (
    ("boire", "drink", "bois", "boit", "buvons", "buvez", "boivent"),
    ("manger", "eat", "mange", "manges", "mangeons", "mangez", "mangent"),
    ("dormir", "sleep", "dors", "dort", "dormons", "dormez", "dorment"),
    ("partir", "leave", "pars", "part", "partons", "partez", "partent", "sortir"),
    ("aide", "help", "aider", "aidez", "aides", "aident", "aidons"),
    ("aller", "vais", "va", "vas", "allons", "allez", "vont"),
    ("faire", "fais", "fait", "faisons", "faites", "font"),
    ("bruit", "noise", "bruits"),
    ("stop", "arreter", "arrete", "arretez", "arret"),
    ("oui", "yes"),
    ("non", "no", "pas"),
    ("content", "contente", "contents", "contentes"),
    ("aimer", "aime", "aimes", "aimons", "aimez", "aiment"),
    ("toilettes", "toilette", "wc"),
)
CANONICAL = {word: forms[0] for forms in FORMS for word in forms}
GRAMMAR = frozenset(
    "je j tu il elle nous vous ils elles on me m te t se s moi toi lui leur "
    "le la les l un une des du de d au aux a en dans avec pour et ou que qu qui ce cette ces "
    "ici y c est suis es sommes etes sont etre ai as avons avez ont avoir "
    "voudrais voudrait voudrais veux veut voulons voulez veulent vouloir "
    "besoin "
    "ne n svp sil si plait please".split()
)
# An explicitly selected person is content, even when its French form changes
# from a stressed pronoun (Moi) to a subject (je / j'). Other grammar-only labels
# still require the verbatim selection; this is not general sentence analysis.
SELECTED_PERSON = {
    "moi": "je",
    "je": "je",
    "j": "je",
    "toi": "tu",
    "tu": "tu",
    "nous": "nous",
    "vous": "vous",
}


def words(text: str) -> tuple[str, ...]:
    folded = "".join(
        char
        for char in unicodedata.normalize("NFKD", text.casefold())
        if not unicodedata.combining(char)
    )
    return tuple(re.findall(r"[^\W\d_]+|\d+", folded))


def content(text: str) -> Counter[str]:
    return Counter(CANONICAL.get(word, word) for word in words(text) if word not in GRAMMAR)


def faithful_words(request: InterpretationRequest, text: str) -> bool:
    """Accept only covered selections and grounded vocabulary in French output."""
    if request.language.split("-")[0].casefold() != "fr":
        return False
    required: Counter[str] = Counter()
    required_persons: Counter[str] = Counter()
    allowed: set[str] = set()
    for block in request.blocks:
        tokens = words(block.label)
        selected = content(block.label)
        if not selected and not (len(tokens) == 1 and tokens[0] in SELECTED_PERSON):
            # A free-form sentence or non-textual label is safe only verbatim.
            return text == " → ".join(item.label for item in request.blocks)
        required_persons.update(
            SELECTED_PERSON[token] for token in tokens if token in SELECTED_PERSON
        )
        required.update(selected)
        allowed.update(selected)
        # Meanings are validated PCL concept labels, never relation targets/context.
        meaning = re.sub(r"\s*\(démonstration\)", "", block.meaning, flags=re.IGNORECASE)
        allowed.update(content(meaning))
    # An idiomatic request for toilets can use "aller aux toilettes". Other
    # movement/actions are content words and need an explicit selected meaning.
    if "toilettes" in required:
        allowed.add("aller")
    actual = content(text)
    # In "faire pipi/caca", faire can be a support verb rather than an added
    # action. Discount only adjacent occurrences with a selected noun, keeping
    # every explicitly selected faire. Other uses of faire remain content.
    tokens = words(text)
    support = sum(
        CANONICAL.get(verb, verb) == "faire" and noun in {"pipi", "caca"} and noun in required
        for verb, noun in zip(tokens, tokens[1:], strict=False)
    )
    if support and actual["faire"] > required["faire"]:
        actual["faire"] -= min(support, actual["faire"] - required["faire"])
        if not actual["faire"]:
            del actual["faire"]
    if required - actual or set(actual) - allowed:
        return False
    actual_persons = Counter(
        SELECTED_PERSON[token] for token in words(text) if token in SELECTED_PERSON
    )
    if required_persons - actual_persons:
        return False
    # A negative selection must stay negative; do not introduce negation either.
    negatives = {"non", "pas", "ne", "n", "jamais", "aucun", "aucune", "sans"}
    selected_negative = any(negatives.intersection(words(b.label)) for b in request.blocks)
    output_negative = bool(negatives.intersection(words(text))) or "pas" in words(text)
    if selected_negative != output_negative:
        return False
    # Avoid treating a location/need as an object to acquire.
    normalized = " ".join(words(text))
    if re.search(
        r"\b(?:veux|veut|voudrais|voudrait) (?:les|des|un|une|la|le) "
        r"(?:toilettes|wc|maison|dehors)\b",
        normalized,
    ):
        return False
    return True
