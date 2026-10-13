"""Build bounded provider requests from the active profile, then persist proposals."""

from uuid import UUID

from app.ai.contracts import InterpretationRequest, SelectedBlock, SemanticHint
from app.ai.errors import ProviderDisabledError, ProviderUnavailableError
from app.ai.protocol import AIProvider
from app.application.communication import CommunicationService
from app.application.pcl_repository import PCLUnits
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    Interpretation,
    SemanticRelation,
    SequenceStatus,
)
from app.domain.pcl.invariants import DomainInvariantError


class InterpretationService:
    def __init__(self, units: PCLUnits, communication: CommunicationService, provider: AIProvider):
        self.units = units
        self.communication = communication
        self.provider = provider

    def literal(self, profile_id: UUID, sequence_id: UUID):
        with self.units() as store:
            sequence = store.get(profile_id, CommunicationSequence, sequence_id)
            if sequence.status != SequenceStatus.COMPLETED:
                raise DomainInvariantError("Literal communication requires a completed sequence")
            labels = []
            for block_id in sequence.block_ids:
                block = store.get(profile_id, CommunicationBlock, block_id)
                if block.status != "validated":
                    raise DomainInvariantError("Selected blocks must remain validated")
                labels.append(block.label)
        return Interpretation(
            profile_id=profile_id,
            sequence_id=sequence_id,
            text=" → ".join(labels),
            confidence=0.5,
            source="pcl",
        )

    def request(
        self, profile_id: UUID, sequence_id: UUID, *, declared_context: tuple[str, ...] = ()
    ):
        with self.units() as store:
            sequence = store.get(profile_id, CommunicationSequence, sequence_id)
            if sequence.status != SequenceStatus.COMPLETED:
                raise DomainInvariantError("Interpretation requires completed communication")
            selected, concepts = [], set()
            for block_id in sequence.block_ids:
                block = store.get(profile_id, CommunicationBlock, block_id)
                if block.status != "validated":
                    raise DomainInvariantError("Selected blocks must remain validated")
                meaning = block.canonical_intent
                if block.concept_id:
                    concept = store.get(profile_id, Concept, block.concept_id)
                    meaning = concept.label
                    concepts.add(concept.id)
                selected.append(
                    SelectedBlock(block_id=block.id, label=block.label, meaning=meaning)
                )
            hints = []
            for relation in store.list(profile_id, SemanticRelation):
                if relation.status != "validated" or relation.source_concept_id not in concepts:
                    continue
                source = store.get(profile_id, Concept, relation.source_concept_id)
                target = store.get(profile_id, Concept, relation.target_concept_id)
                hints.append(
                    SemanticHint(
                        source_meaning=source.label,
                        target_meaning=target.label,
                        relation_type=relation.relation_type,
                        confidence=relation.confidence,
                    )
                )
                if len(hints) == 16:
                    break
        return InterpretationRequest(
            blocks=tuple(selected), declared_context=declared_context, semantic_hints=tuple(hints)
        )

    async def interpret(
        self, profile_id: UUID, sequence_id: UUID, *, declared_context: tuple[str, ...] = ()
    ):
        if self.provider.provider_id == "disabled":
            return self.communication.propose(
                profile_id, sequence_id, (self.literal(profile_id, sequence_id),), source="pcl"
            )
        request = self.request(profile_id, sequence_id, declared_context=declared_context)
        source = self.provider.provider_id
        try:
            result = await self.provider.interpret(request)
            items = tuple(
                Interpretation(
                    profile_id=profile_id,
                    sequence_id=sequence_id,
                    text=item.text,
                    confidence=item.confidence,
                    source=source,
                )
                for item in result.candidates
            )
        except (ProviderDisabledError, ProviderUnavailableError):
            # Literal user-selected labels remain available without claiming inferred meaning.
            source = "pcl"
            items = (self.literal(profile_id, sequence_id),)
        return self.communication.propose(profile_id, sequence_id, items, source=source)
