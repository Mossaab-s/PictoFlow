"""Accepted alignments first; disposable 24-hour references to pending proposals second."""

import hashlib
import json
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime, timedelta
from uuid import UUID

from app.ai.providers.http import system_instruction
from app.application.communication import CommunicationService
from app.application.interpretation import InterpretationService
from app.application.memory_vocabulary import (
    MemorySuggestionConflict,
    check_memory_provenance,
    revision,
)
from app.application.semantic_space import SemanticNotFoundError
from app.application.transient import (
    TransientKind,
    TransientPayloadError,
    TransientStoreUnavailable,
)
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Interpretation,
    utc_now,
)
from app.domain.pcl.invariants import DomainInvariantError

TTL_SECONDS = 24 * 60 * 60
VERSION = 1


def presentation(store, profile_id, item):
    events = store.audit_history(
        profile_id, target_type="interpretation", target_id=item.id, limit=100
    )
    for event in events:
        if event.event_type in {
            "interpretation_proposal",
            "interpretation_confirmation_required",
            "interpretation_multiple_hypotheses",
            "memory_proposal",
        }:
            return json.loads(event.new_state or "{}").get("presentation", {})
    return {}


@contextmanager
def bound_units(store):
    yield store


class InterpretationReuse:
    def __init__(self, interpreter, transient, configuration, *, clock=utc_now):
        self.interpreter = interpreter
        self.units = interpreter.units
        self.policy = interpreter.communication.policy
        self.transient = transient
        self.configuration = configuration
        self.clock = clock

    def service(self, store):
        return CommunicationService(lambda: bound_units(store), self.policy)

    def prepare(self, store, profile_id, sequence_id, declared_context):
        interpreter = InterpretationService(
            lambda: bound_units(store),
            self.service(store),
            self.interpreter.provider,
            memory_limit=self.interpreter.memory_limit,
        )
        request = interpreter.request(profile_id, sequence_id, declared_context=declared_context)
        sequence = store.get(profile_id, CommunicationSequence, sequence_id)
        provider_revision = getattr(self.interpreter.provider, "cache_revision", None)
        value = {
            "version": VERSION,
            "profile_id": str(profile_id),
            "context_id": str(sequence.context_id) if sequence.context_id else None,
            "request": request.model_dump(mode="json"),
            "configuration": self.configuration,
            "provider": self.interpreter.provider.provider_id,
            "provider_revision": provider_revision if isinstance(provider_revision, str) else None,
            "policy": asdict(self.policy),
            "prompt": system_instruction("interpret"),
        }
        key = hashlib.sha256(
            json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()
        return request, key

    def memory(self, store, profile_id, sequence_id, declared_context):
        sequence = store.get(profile_id, CommunicationSequence, sequence_id)
        if sequence.status != "completed":
            raise DomainInvariantError("Interpretation requires completed communication")
        for block_id in sequence.block_ids:
            if store.get(profile_id, CommunicationBlock, block_id).status != "validated":
                raise DomainInvariantError("Selected blocks must remain validated")
        traces = store.accepted_traces(
            profile_id,
            block_ids=sequence.block_ids,
            exclude_sequence_id=sequence_id,
            exact=True,
            context_id=sequence.context_id,
        )
        groups = {}
        for trace in traces:
            source = store.get(profile_id, Interpretation, trace.interpretation_id)
            details = presentation(store, profile_id, source)
            if tuple(details.get("declared_context", ())) != declared_context:
                continue
            groups.setdefault(trace.text, []).append(trace)
        ranked = sorted(
            groups.items(),
            key=lambda pair: (len(pair[1]), max(t.accepted_at for t in pair[1]), pair[0]),
            reverse=True,
        )[:3]
        if not ranked:
            return None
        candidates, details = [], {}
        for text, sources in ranked:
            reference = max(sources, key=lambda t: (t.accepted_at, str(t.interpretation_id)))
            candidate = Interpretation(
                profile_id=profile_id,
                sequence_id=sequence_id,
                text=text,
                source="pcl-memory",
                confidence=self.policy.confirmation,
            )
            candidates.append(candidate)
            details[candidate.id] = {
                "personal_hypothesis": True,
                "alignment_memory": True,
                "declared_context": list(declared_context),
                "reuse": "memory",
                "memory_sources": [
                    {
                        "interpretation_id": str(reference.interpretation_id),
                        "revision": revision(text),
                        "index": None,
                    }
                ],
            }
        return self.service(store).propose(
            profile_id,
            sequence_id,
            tuple(candidates),
            source="pcl-memory",
            proposal_details=details,
        )

    async def interpret(self, profile_id, sequence_id, *, declared_context=(), refresh=False):
        with self.units() as store:
            if not refresh:
                remembered = self.memory(store, profile_id, sequence_id, declared_context)
                if remembered:
                    return remembered
            request, key = self.prepare(store, profile_id, sequence_id, declared_context)
        if not refresh and self.transient is not None:
            try:
                value = await self.transient.get(profile_id, TransientKind.SEMANTIC_CACHE, key)
                cached = self.replay(profile_id, sequence_id, declared_context, key, value)
                if cached:
                    return cached
            except (TransientStoreUnavailable, TransientPayloadError):
                pass
        # Use one immutable request snapshot for generation and its cache identity.
        result = await self.interpreter.interpret(
            profile_id, sequence_id, declared_context=declared_context, prepared_request=request
        )
        if (
            self.transient is not None
            and self.interpreter.provider.provider_id != "disabled"
            and result.candidates
            and all(i.source == self.interpreter.provider.provider_id for i in result.candidates)
        ):
            expires = self.clock() + timedelta(seconds=TTL_SECONDS)
            with self.units() as store:
                _, current_key = self.prepare(store, profile_id, sequence_id, declared_context)
                if key != current_key:
                    return result
                for item in result.candidates:
                    self.record(store, profile_id, item, key, expires, item.id)
            try:
                await self.transient.put(
                    profile_id,
                    TransientKind.SEMANTIC_CACHE,
                    key,
                    {
                        "version": VERSION,
                        "expires_at": expires.isoformat(),
                        "candidate_ids": [str(i.id) for i in result.candidates],
                    },
                    ttl_seconds=TTL_SECONDS,
                )
            except (TransientStoreUnavailable, TransientPayloadError):
                pass
        return result

    def record(self, store, profile_id, item, key, expires, root):
        store.audit(
            profile_id,
            "interpretation_reuse",
            None,
            item,
            item.source,
            new_details={
                "cache_key": key,
                "cache_expires_at": expires.isoformat(),
                "cache_root_id": str(root),
            },
        )

    def replay(self, profile_id, sequence_id, declared_context, key, value):
        try:
            if not isinstance(value, dict) or value.get("version") != VERSION:
                return None
            expires = datetime.fromisoformat(value["expires_at"])
            ids = value["candidate_ids"]
            if (
                expires.tzinfo is None
                or expires <= self.clock()
                or expires > self.clock() + timedelta(seconds=TTL_SECONDS)
                or not isinstance(ids, list)
                or not 1 <= len(ids) <= 3
            ):
                return None
            roots = tuple(UUID(i) for i in ids)
            if len(set(roots)) != len(roots):
                return None
        except (KeyError, ValueError, TypeError, AttributeError):
            return None
        with self.units() as store:
            # Re-check after the Redis await, under the same profile lock as persistence.
            remembered = self.memory(store, profile_id, sequence_id, declared_context)
            if remembered:
                return remembered
            _, current_key = self.prepare(store, profile_id, sequence_id, declared_context)
            if current_key != key:
                return None
            rejected = store.rejected_cache_roots(profile_id, roots)
            candidates, details, by_id = [], {}, {}
            for root in roots:
                if root in rejected:
                    continue
                try:
                    source = store.get(profile_id, Interpretation, root)
                except SemanticNotFoundError:
                    continue
                if (
                    source.status != "proposed"
                    or source.source != self.interpreter.provider.provider_id
                ):
                    continue
                try:
                    check_memory_provenance(store, profile_id, source)
                except MemorySuggestionConflict:
                    continue
                events = store.audit_history(
                    profile_id, target_type="interpretation", target_id=root, limit=100
                )
                if not any(
                    e.event_type == "interpretation_reuse"
                    and json.loads(e.new_state or "{}").get("presentation")
                    == {
                        "cache_key": key,
                        "cache_expires_at": expires.isoformat(),
                        "cache_root_id": str(root),
                    }
                    for e in events
                ):
                    continue
                candidate = Interpretation(
                    profile_id=profile_id,
                    sequence_id=sequence_id,
                    text=source.text,
                    confidence=source.confidence,
                    source=source.source,
                )
                candidates.append(candidate)
                by_id[candidate.id] = root
                details[candidate.id] = {
                    **presentation(store, profile_id, source),
                    "reuse": "cache",
                }
            if not candidates:
                return None
            result = self.service(store).propose(
                profile_id,
                sequence_id,
                tuple(candidates),
                source=self.interpreter.provider.provider_id,
                proposal_details=details,
            )
            for item in result.candidates:
                self.record(store, profile_id, item, key, expires, by_id[item.id])
            return result
