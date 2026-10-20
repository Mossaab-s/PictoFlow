"""Ordered, explicit communication lifecycle independent from interpretation."""

from dataclasses import replace
from uuid import UUID

from app.domain.pcl.entities import CommunicationSequence, SequenceStatus, utc_now
from app.domain.pcl.invariants import DomainInvariantError, identifier


def edit_sequence(
    sequence: CommunicationSequence,
    action: str,
    block_id: UUID | None = None,
    *,
    index: int | None = None,
) -> CommunicationSequence:
    if sequence.status != SequenceStatus.IN_PROGRESS:
        raise DomainInvariantError("Only an in-progress sequence can be edited")
    if action == "append":
        identifier(block_id, "block_id")
        if len(sequence.block_ids) >= 32:
            raise DomainInvariantError("A sequence supports at most 32 selections")
        return replace(sequence, block_ids=(*sequence.block_ids, block_id))
    if action == "undo":
        return replace(sequence, block_ids=sequence.block_ids[:-1])
    if action == "remove":
        if type(index) is not int or not 0 <= index < len(sequence.block_ids):
            raise DomainInvariantError("Removal requires an existing selection index")
        return replace(
            sequence, block_ids=sequence.block_ids[:index] + sequence.block_ids[index + 1 :]
        )
    if action == "clear":
        return replace(sequence, block_ids=())
    if action == "complete":
        return replace(sequence, status=SequenceStatus.COMPLETED, completed_at=utc_now())
    if action == "cancel":
        return replace(sequence, status=SequenceStatus.CANCELLED)
    raise DomainInvariantError("Unknown sequence action")
