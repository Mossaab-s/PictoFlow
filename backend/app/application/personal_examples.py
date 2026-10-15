"""Retrieve grounded personal associations without lexical censorship of human meaning."""

from collections import Counter
from difflib import SequenceMatcher

from app.ai.contracts import MemoryExample, SelectedBlock
from app.domain.pcl.entities import CommunicationBlock, Concept

MAX_EXAMPLE_CHARACTERS = 32_000


def select_examples(store, profile_id, sequence, *, limit=50):
    """Same profile, accepted sources, current touch meanings, explicit bounded payload.

    Exact ordered matches first, then multiset coverage and order similarity;
    frequency and recency break ties. A repeated confirmation on one message is
    not another use. Counts describe the bounded candidate shortlist, not all time.
    """
    traces = store.accepted_traces(
        profile_id, block_ids=sequence.block_ids, exclude_sequence_id=sequence.id
    )
    if not traces:
        return ()
    blocks = {b.id: b for b in store.list(profile_id, CommunicationBlock)}
    concepts = {c.id: c for c in store.list(profile_id, Concept)}
    groups = {}
    for trace in traces:
        if not 1 <= len(trace.block_ids) <= 32:
            continue
        source_blocks = tuple(blocks.get(i) for i in trace.block_ids)
        if any(b is None or b.status != "validated" for b in source_blocks):
            continue
        key = (trace.block_ids, trace.text)
        group = groups.setdefault(key, [])
        if all(t.sequence_id != trace.sequence_id for t in group):
            group.append(trace)
    current = Counter(sequence.block_ids)

    def rank(entry):
        (ids, _), traces = entry
        overlap = sum((current & Counter(ids)).values())
        union = sum((current | Counter(ids)).values())
        return (
            ids == sequence.block_ids,
            overlap / union,
            SequenceMatcher(None, sequence.block_ids, ids, autojunk=False).ratio(),
            len(traces),
            max(t.accepted_at for t in traces),
            str(traces[0].interpretation_id),
        )

    result, size = [], 0
    for (ids, text), traces in sorted(groups.items(), key=rank, reverse=True):
        selected = tuple(
            SelectedBlock(
                block_id=b.id,
                label=b.label,
                meaning=concepts[b.concept_id].label if b.concept_id else b.canonical_intent,
            )
            for b in (blocks[i] for i in ids)
        )
        latest = max(traces, key=lambda t: (t.accepted_at, str(t.interpretation_id)))
        example = MemoryExample(
            reference_id=latest.interpretation_id,
            blocks=selected,
            text=text,
            occurrences=len(traces),
        )
        cost = len(example.model_dump_json())
        if size + cost > MAX_EXAMPLE_CHARACTERS:
            continue
        result.append(example)
        size += cost
        if len(result) >= limit:
            break
    return tuple(result)
