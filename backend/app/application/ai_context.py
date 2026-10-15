"""Read recorded references without reconstructing or silently updating an old AI prompt."""

import json
from dataclasses import dataclass
from uuid import UUID

from app.application.memory_vocabulary import MemoryReference, MemorySuggestionConflict, resolve
from app.application.semantic_space import SemanticNotFoundError
from app.domain.pcl.entities import Interpretation


@dataclass(frozen=True)
class ContextReference:
    interpretation_id: UUID
    available: bool
    text: str | None


@dataclass(frozen=True)
class AIContext:
    personal_hypothesis: bool
    references: tuple[ContextReference, ...]


def context_for(units, profile_id, interpretation_id):
    with units() as store:
        store.get(profile_id, Interpretation, interpretation_id)
        history = store.audit_history(
            profile_id, target_type="interpretation", target_id=interpretation_id, limit=100
        )
        origin = next(
            (
                e
                for e in history
                if e.event_type.startswith("interpretation_")
                and e.event_type
                not in ("interpretation_confirm", "interpretation_correct", "interpretation_reject")
            ),
            None,
        )
        data = json.loads(origin.new_state or "{}").get("presentation", {}) if origin else {}
        refs = []
        for source in data.get("memory_sources", []):
            reference = MemoryReference(UUID(source["interpretation_id"]), source["revision"])
            try:
                text = resolve(store, profile_id, reference, require_association=True)
            except (MemorySuggestionConflict, SemanticNotFoundError):
                text = None
            refs.append(ContextReference(reference.interpretation_id, text is not None, text))
        return AIContext(bool(data.get("personal_hypothesis")), tuple(refs))
