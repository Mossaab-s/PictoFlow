"""Reuse accepted messages and choose personal shortcuts without inference or new validation."""

from dataclasses import dataclass, replace
from uuid import UUID

from app.application.pcl_repository import PCLUnits
from app.domain.pcl.entities import CommunicationSequence, HumanRole, Interpretation, SequenceStatus
from app.domain.pcl.invariants import DomainInvariantError, identifier, text


class PhraseConflict(ValueError):
    pass


@dataclass(frozen=True)
class ReusablePhrase:
    interpretation: Interpretation
    sequence: CommunicationSequence


class PhraseService:
    def __init__(self, units: PCLUnits):
        self.units = units

    @staticmethod
    def accepted(store, profile_id, interpretation_id):
        item = store.get(profile_id, Interpretation, interpretation_id)
        sequence = store.get(profile_id, CommunicationSequence, item.sequence_id)
        if item.validated_text is None or sequence.status != SequenceStatus.COMPLETED:
            raise PhraseConflict("Message is no longer accepted")
        return ReusablePhrase(item, sequence)

    def read(self, profile_id: UUID, interpretation_id: UUID) -> ReusablePhrase:
        with self.units() as store:
            return self.accepted(store, profile_id, interpretation_id)

    def choose(
        self,
        profile_id: UUID,
        interpretation_id: UUID,
        *,
        selected: bool,
        expected_selected: bool,
        expected_text: str,
        actor_role: HumanRole,
    ) -> Interpretation:
        identifier(profile_id, "profile_id")
        identifier(interpretation_id, "interpretation_id")
        text(expected_text, "expected_text")
        if (
            type(selected) is not bool
            or type(expected_selected) is not bool
            or type(actor_role) is not HumanRole
        ):
            raise DomainInvariantError("Explicit human shortcut choice required")
        with self.units() as store:
            previous = self.accepted(store, profile_id, interpretation_id).interpretation
            if previous.validated_text != expected_text:
                raise PhraseConflict("Accepted text changed; reload the message")
            # Same desired state is safe to retry after a lost response; no duplicate audit.
            if previous.shortcut == selected:
                return previous
            if previous.shortcut != expected_selected:
                raise PhraseConflict("Shortcut choice changed; reload the message")
            current = replace(previous, shortcut=selected)
            store.save(profile_id, current)
            store.audit(
                profile_id,
                "phrase_shortcut_selected" if selected else "phrase_shortcut_removed",
                previous,
                current,
                f"human:{actor_role.value}",
            )
        return current
