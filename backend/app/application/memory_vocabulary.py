"""Words come only from currently accepted profile texts; no provider or dictionary."""

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from uuid import UUID

from app.domain.pcl.entities import CommunicationSequence, Interpretation


class MemorySuggestionConflict(ValueError):
    pass


def tokens(text: str) -> tuple[str, ...]:
    # Keep hyphenated words and attach elision marks to their preceding token.
    return tuple(re.findall(r"[^\W_]+(?:-[^\W_]+)*(?:['’](?=[^\W_]))?", text, re.UNICODE))


def normalized(text: str) -> str:
    return unicodedata.normalize("NFC", text).casefold().replace("’", "'")


def revision(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def join_words(words: tuple[str, ...]) -> str:
    return " ".join(words).replace("' ", "'").replace("’ ", "’")


@dataclass(frozen=True)
class MemoryReference:
    interpretation_id: UUID
    revision: str
    index: int | None = None


def resolve(store, profile_id, reference: MemoryReference, *, require_association=False):
    item = store.get(profile_id, Interpretation, reference.interpretation_id)
    sequence = store.get(profile_id, CommunicationSequence, item.sequence_id)
    text = item.validated_text
    if sequence.status != "completed" or not text or revision(text) != reference.revision:
        raise MemorySuggestionConflict("La phrase source a changé. Actualisez les suggestions.")
    if require_association and not store.accepted_traces(
        profile_id,
        block_ids=sequence.block_ids,
        exclude_sequence_id=UUID(int=0),
        reference_id=item.id,
    ):
        raise MemorySuggestionConflict(
            "Le sens des touches source a changé. Relancez la proposition."
        )
    if reference.index is None:
        return text
    words = tokens(text)
    if not 0 <= reference.index < len(words):
        raise MemorySuggestionConflict("Ce mot n’est plus disponible. Actualisez les suggestions.")
    return words[reference.index]


def check_memory_provenance(store, profile_id, item):
    if item.validated_text is not None:
        return
    events = store.audit_history(
        profile_id, target_type="interpretation", target_id=item.id, limit=100
    )
    origin = next(
        (
            event
            for event in events
            if event.event_type == "memory_proposal"
            or json.loads(event.new_state or "{}")
            .get("presentation", {})
            .get("personal_hypothesis")
        ),
        None,
    )
    if item.source != "pcl-memory" and origin is None:
        return
    sources = (
        json.loads(origin.new_state or "{}").get("presentation", {}).get("memory_sources")
        if origin
        else None
    )
    if not sources:
        raise MemorySuggestionConflict(
            "La provenance doit être vérifiée. Actualisez les suggestions."
        )
    for source in sources:
        resolve(
            store,
            profile_id,
            MemoryReference(
                UUID(source["interpretation_id"]), source["revision"], source.get("index")
            ),
            require_association=item.source != "pcl-memory"
            or bool(
                json.loads(origin.new_state or "{}").get("presentation", {}).get("alignment_memory")
            ),
        )
