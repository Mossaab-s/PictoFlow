"""Atomic, explicit copies of completed selections, without transferring a meaning."""

import json
from uuid import UUID

from app.application.pcl_repository import PCLUnits
from app.application.semantic_space import SemanticNotFoundError
from app.domain.pcl.entities import CommunicationBlock, CommunicationSequence, ProposalStatus
from app.domain.pcl.invariants import DomainInvariantError, identifier
from app.domain.pcl.sequences import editable_copy


class MessageCopyConflict(ValueError):
    pass


class MessageCopies:
    def __init__(self, units: PCLUnits):
        self.units = units

    @staticmethod
    def provenance(store, profile_id, source_id, copy_id):
        current = store.get(profile_id, CommunicationSequence, copy_id)
        events = store.audit_history(
            profile_id, target_type="communication_sequence", target_id=copy_id, limit=1
        )
        if events and events[0].event_type == "sequence_copied":
            original = json.loads(events[0].new_state or "{}")
            if original.get("presentation", {}).get("copied_from_sequence_id") == str(source_id):
                return current, original.get("block_ids")
        raise MessageCopyConflict("This request belongs to another message")

    def read(self, profile_id: UUID, source_id: UUID, request_id: UUID):
        with self.units() as store:
            store.get(profile_id, CommunicationSequence, source_id)
            return self.provenance(store, profile_id, source_id, request_id)[0]

    def create(
        self,
        profile_id: UUID,
        source_id: UUID,
        request_id: UUID,
        expected_block_ids: tuple[UUID, ...],
    ):
        for value in (profile_id, source_id, request_id):
            identifier(value, "identity")
        if not isinstance(expected_block_ids, tuple) or not 1 <= len(expected_block_ids) <= 32:
            raise DomainInvariantError("Copying requires the exact ordered source message")
        for value in expected_block_ids:
            identifier(value, "expected_block_id")
        with self.units() as store:
            source = store.get(profile_id, CommunicationSequence, source_id)
            try:
                existing, original_ids = self.provenance(store, profile_id, source_id, request_id)
            except SemanticNotFoundError:
                existing = None
            if existing is not None:
                if original_ids != [str(value) for value in expected_block_ids]:
                    raise MessageCopyConflict("This request carries a different source snapshot")
                # Read the actual copy; retries never overwrite subsequent edits or decisions.
                return existing
            if source.status != "completed" or source.block_ids != expected_block_ids:
                raise MessageCopyConflict("Source message changed; review it before copying")
            for block_id in set(source.block_ids):
                block = store.get(profile_id, CommunicationBlock, block_id)
                if block.status != ProposalStatus.VALIDATED:
                    raise MessageCopyConflict("A source touch is no longer available")
            current = editable_copy(source, request_id)
            store.add(profile_id, current)
            store.audit(
                profile_id,
                "sequence_copied",
                None,
                current,
                "human",
                new_details={"copied_from_sequence_id": str(source_id)},
            )
        return current
