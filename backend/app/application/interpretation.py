"""Build bounded provider requests from the active profile, then persist proposals."""

from uuid import UUID

from app.ai.contracts import InterpretationRequest, SelectedBlock, SemanticHint
from app.ai.errors import ProviderDisabledError, ProviderPayloadError, ProviderUnavailableError
from app.ai.protocol import AIProvider
from app.application.ai_quality import AttemptEvidence, FallbackReason
from app.application.communication import CommunicationService
from app.application.pcl_repository import PCLUnits
from app.application.personal_examples import select_examples
from app.application.phrase_fidelity import faithful_words
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
    def __init__(
        self,
        units: PCLUnits,
        communication: CommunicationService,
        provider: AIProvider,
        telemetry=None,
        memory_limit=50,
    ):
        self.units = units
        self.communication = communication
        self.provider = provider
        self.telemetry = telemetry
        self.memory_limit = memory_limit

    def fallback(
        self,
        profile_id: UUID,
        sequence_id: UUID,
        reason: FallbackReason,
        *,
        received: int = 0,
        examples: int = 0,
        memory_examples: int = 0,
    ):
        if self.telemetry:
            self.telemetry.signal(
                "interpretation.fallback", provider=self.provider.provider_id, result_state=reason
            )
        return self.communication.propose(
            profile_id,
            sequence_id,
            (self.literal(profile_id, sequence_id),),
            source="pcl",
            evidence=AttemptEvidence(
                self.provider.provider_id, reason, received, examples, memory_examples
            ),
        )

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
            confidence=max(0.5, self.communication.policy.refusal),
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
                if (
                    relation.status != "validated"
                    or relation.source_concept_id not in concepts
                    or relation.target_concept_id not in concepts
                ):
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
            request = InterpretationRequest(
                blocks=tuple(selected),
                declared_context=declared_context,
                semantic_hints=tuple(hints),
            )
            # Context supplied for this call was not recorded with older corrections.
            # Do not assume it is equivalent. The repository also excludes changed meanings.
            examples = (
                ()
                if declared_context
                else store.correction_examples(
                    profile_id,
                    block_ids=sequence.block_ids,
                    concept_ids=tuple(concepts),
                    context_id=sequence.context_id,
                    exclude_sequence_id=sequence.id,
                )
            )
            examples = tuple(
                dict.fromkeys(text for text in examples if faithful_words(request, text))
            )[:3]
            memory = select_examples(store, profile_id, sequence, limit=self.memory_limit)
        return InterpretationRequest(
            **request.model_dump(exclude={"correction_examples", "memory_examples"}),
            correction_examples=examples,
            memory_examples=memory,
        )

    async def interpret(
        self, profile_id: UUID, sequence_id: UUID, *, declared_context: tuple[str, ...] = ()
    ):
        if self.provider.provider_id == "disabled":
            return self.fallback(profile_id, sequence_id, "disabled")
        request = self.request(profile_id, sequence_id, declared_context=declared_context)
        source = self.provider.provider_id
        examples = len(request.correction_examples)
        memory = len(request.memory_examples)
        try:
            result = await self.provider.interpret(request)
            if result.status == "not_understood":
                return self.fallback(
                    profile_id,
                    sequence_id,
                    "model_refusal",
                    examples=examples,
                    memory_examples=memory,
                )
            items = tuple(
                Interpretation(
                    profile_id=profile_id,
                    sequence_id=sequence_id,
                    text=item.text,
                    confidence=item.confidence,
                    source=source,
                )
                for item in result.candidates
                if faithful_words(request, item.text)
            )
            if not items:
                return self.fallback(
                    profile_id,
                    sequence_id,
                    "unfaithful_words",
                    received=len(result.candidates),
                    examples=examples,
                    memory_examples=memory,
                )
            if not self.communication.policy.decide(items).candidates:
                return self.fallback(
                    profile_id,
                    sequence_id,
                    "low_confidence",
                    received=len(result.candidates),
                    examples=examples,
                    memory_examples=memory,
                )
        except (ProviderDisabledError, ProviderUnavailableError):
            return self.fallback(
                profile_id, sequence_id, "unavailable", examples=examples, memory_examples=memory
            )
        except ProviderPayloadError:
            return self.fallback(
                profile_id,
                sequence_id,
                "invalid_payload",
                examples=examples,
                memory_examples=memory,
            )
        return self.communication.propose(
            profile_id,
            sequence_id,
            items,
            source=source,
            evidence=AttemptEvidence(
                source,
                received_candidates=len(result.candidates),
                correction_examples=examples,
                memory_examples=memory,
            ),
        )
