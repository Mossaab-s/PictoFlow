"""Narrow surface equivalence; never infer semantic similarity from intent labels."""

import re
import unicodedata


def surface_key(text: str) -> str:
    """Group identical text and otherwise identical affirmative je veux/voudrais forms.

    Keep punctuation, accents, people, actions and negation. In particular, a
    statement and a question do not become equivalent just by sharing words.
    """
    normalized = " ".join(unicodedata.normalize("NFC", text).casefold().replace("’", "'").split())
    if re.search(r"\b(?:ne|n|non|pas|jamais|aucun|aucune|sans|stop)\b", normalized):
        return normalized
    return re.sub(r"\bje (?:veux|voudrais)\b", "je <request>", normalized)
