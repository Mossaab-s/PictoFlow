"""Profile-locked PostgreSQL communication units and append-only history."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.dialects.postgresql import aggregate_order_by, array
from sqlalchemy.orm import Session, sessionmaker

from app.application.pcl_repository import FeedbackEvidence, FeedbackPage, HistoricalFeedback
from app.application.photos import PhotoAsset
from app.application.semantic_space import SemanticNotFoundError
from app.domain.pcl.audit import SemanticAuditEvent
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    Interpretation,
    Representation,
    SemanticRelation,
    ValidationEvent,
    utc_now,
)
from app.domain.pcl.gaps import SemanticGapCandidate
from app.domain.pcl.invariants import identifier
from app.domain.pcl.keyboard import KeyboardGroup, KeyboardPosition
from app.infrastructure.postgres.database import transaction
from app.infrastructure.postgres.models import (
    AuditRow,
    BlockRow,
    ConceptRow,
    GapRow,
    InterpretationRow,
    KeyboardGroupRow,
    KeyboardPositionRow,
    PhotoAssetRow,
    ProfileRow,
    RelationRow,
    RepresentationRow,
    SequenceItemRow,
    SequenceRow,
    ValidationRow,
)
from app.infrastructure.postgres.repositories import to_domain, to_values

MAPPINGS = {
    KeyboardGroup: KeyboardGroupRow,
    PhotoAsset: PhotoAssetRow,
    SemanticGapCandidate: GapRow,
    KeyboardPosition: KeyboardPositionRow,
    Concept: ConceptRow,
    Representation: RepresentationRow,
    CommunicationBlock: BlockRow,
    SemanticRelation: RelationRow,
    CommunicationSequence: SequenceRow,
    Interpretation: InterpretationRow,
}


def snapshot(entity) -> dict | None:
    return None if entity is None else json.loads(json.dumps(to_values(entity), default=str))


class PostgresPCLRepository:
    def __init__(self, session: Session, actor_reference: str | None = None):
        self.session = session
        self.actor_reference = actor_reference
        self._profile: UUID | None = None

    def _scope(self, profile_id: UUID):
        identifier(profile_id, "profile_id")
        if self._profile is not None and self._profile != profile_id:
            raise ValueError("A communication unit cannot span multiple profiles")
        if self._profile is None:
            row = self.session.scalar(
                select(ProfileRow).where(ProfileRow.id == profile_id).with_for_update()
            )
            if row is None:
                raise SemanticNotFoundError("Profile not found")
            self._profile = profile_id

    def get(self, profile_id: UUID, entity_type, entity_id: UUID):
        self._scope(profile_id)
        identifier(entity_id, "entity_id")
        row_type = MAPPINGS[entity_type]
        row = self.session.scalar(
            select(row_type)
            .where(row_type.profile_id == profile_id, row_type.id == entity_id)
            .with_for_update()
        )
        if row is None:
            raise SemanticNotFoundError("Object not found in this profile")
        return self._domain(entity_type, row)

    def list(self, profile_id: UUID, entity_type):
        self._scope(profile_id)
        row_type = MAPPINGS[entity_type]
        query = select(row_type).where(row_type.profile_id == profile_id)
        query = (
            query.order_by(row_type.zone, row_type.position)
            if entity_type is KeyboardPosition
            else query.order_by(row_type.created_at, row_type.id)
        )
        rows = self.session.scalars(query)
        return tuple(self._domain(entity_type, row) for row in rows)

    def _domain(self, entity_type, row):
        if entity_type is CommunicationSequence:
            ids = tuple(
                self.session.scalars(
                    select(SequenceItemRow.block_id)
                    .where(
                        SequenceItemRow.profile_id == row.profile_id,
                        SequenceItemRow.sequence_id == row.id,
                    )
                    .order_by(SequenceItemRow.position)
                )
            )
            values = {
                name: getattr(row, name)
                for name in (
                    "id",
                    "profile_id",
                    "session_id",
                    "context_id",
                    "created_at",
                    "completed_at",
                    "status",
                )
            }
            return CommunicationSequence(**values, block_ids=ids)
        return to_domain(entity_type, row)

    def add(self, profile_id: UUID, value):
        self._scope(profile_id)
        if value.profile_id != profile_id:
            raise ValueError("Object does not belong to the active profile")
        row_type = MAPPINGS[type(value)]
        values = to_values(value)
        values.pop("block_ids", None)
        self.session.add(row_type(**values))
        self.session.flush()
        if isinstance(value, CommunicationSequence):
            self._selections(value)

    def save(self, profile_id: UUID, value):
        self._scope(profile_id)
        if value.profile_id != profile_id:
            raise ValueError("Object does not belong to the active profile")
        # Read through the same scoped contract before any update.
        self.get(profile_id, type(value), value.id)
        row_type = MAPPINGS[type(value)]
        row = self.session.scalar(
            select(row_type).where(row_type.profile_id == profile_id, row_type.id == value.id)
        )
        for name, item in to_values(value).items():
            if name not in ("id", "profile_id", "created_at", "block_ids"):
                setattr(row, name, item)
        self.session.flush()
        if isinstance(value, CommunicationSequence):
            self._selections(value)

    def _selections(self, value: CommunicationSequence):
        self.session.execute(
            delete(SequenceItemRow).where(
                SequenceItemRow.profile_id == value.profile_id,
                SequenceItemRow.sequence_id == value.id,
            )
        )
        for position, block_id in enumerate(value.block_ids):
            self.session.add(
                SequenceItemRow(
                    profile_id=value.profile_id,
                    sequence_id=value.id,
                    position=position,
                    block_id=block_id,
                )
            )
        self.session.flush()

    def feedback(self, event: ValidationEvent):
        self._scope(event.profile_id)
        self.session.add(
            ValidationRow(
                id=event.id,
                profile_id=event.profile_id,
                target_type=event.target_type,
                target_id=event.target_id,
                **{f"{event.target_type.value}_id": event.target_id},
                action=event.action,
                actor_role=event.actor_role,
                actor_reference=self.actor_reference or event.actor_reference,
                corrected_value={"text": event.corrected_value}
                if event.corrected_value is not None
                else None,
                created_at=event.created_at,
            )
        )
        self.session.flush()

    def feedback_history(self, profile_id: UUID, target_id: UUID):
        self._scope(profile_id)
        identifier(target_id, "target_id")
        rows = self.session.scalars(
            select(ValidationRow)
            .where(ValidationRow.profile_id == profile_id, ValidationRow.target_id == target_id)
            .order_by(ValidationRow.created_at, ValidationRow.id)
        )
        return tuple(
            HistoricalFeedback(
                id=row.id,
                profile_id=row.profile_id,
                target_type=row.target_type,
                target_id=row.target_id,
                action=row.action,
                corrected_value=row.corrected_value.get("text") if row.corrected_value else None,
                actor_role=row.actor_role,
                actor_reference=row.actor_reference,
                created_at=row.created_at,
            )
            for row in rows
        )

    def correction_examples(
        self,
        profile_id,
        *,
        block_ids,
        concept_ids,
        context_id,
        exclude_sequence_id,
    ):
        self._scope(profile_id)
        # Ordered array equality preserves repetitions. Every subquery is profile scoped.
        selected = (
            select(
                func.array_agg(
                    aggregate_order_by(SequenceItemRow.block_id, SequenceItemRow.position)
                )
            )
            .where(
                SequenceItemRow.profile_id == profile_id,
                SequenceItemRow.sequence_id == SequenceRow.id,
            )
            .correlate(SequenceRow)
            .scalar_subquery()
        )
        latest_feedback = (
            select(ValidationRow.id)
            .where(
                ValidationRow.profile_id == profile_id,
                ValidationRow.target_type == "interpretation",
                ValidationRow.target_id == InterpretationRow.id,
            )
            .order_by(ValidationRow.created_at.desc(), ValidationRow.id.desc())
            .limit(1)
            .correlate(InterpretationRow)
            .scalar_subquery()
        )
        changed_meaning = (
            select(AuditRow.id)
            .where(
                AuditRow.profile_id == profile_id,
                AuditRow.target_id.in_((*block_ids, *concept_ids)),
                AuditRow.target_type.in_(("communication_block", "concept")),
                AuditRow.created_at >= ValidationRow.created_at,
            )
            .correlate(ValidationRow)
            .exists()
        )
        query = (
            select(InterpretationRow.corrected_text)
            .join(
                SequenceRow,
                (SequenceRow.profile_id == profile_id)
                & (SequenceRow.id == InterpretationRow.sequence_id),
            )
            .join(ValidationRow, ValidationRow.id == latest_feedback)
            .where(
                InterpretationRow.profile_id == profile_id,
                InterpretationRow.status == "corrected",
                SequenceRow.status == "completed",
                SequenceRow.id != exclude_sequence_id,
                SequenceRow.context_id.is_not_distinct_from(context_id),
                selected == array(list(block_ids)),
                ValidationRow.action == "correct",
                ValidationRow.actor_role.in_(("user", "caregiver", "professional")),
                ValidationRow.corrected_value["text"].astext == InterpretationRow.corrected_text,
                func.char_length(InterpretationRow.corrected_text).between(1, 256),
                ~changed_meaning,
            )
            .order_by(ValidationRow.created_at.desc(), ValidationRow.id.desc())
            .limit(10)
        )
        return tuple(self.session.scalars(query))

    def audit(
        self,
        profile_id: UUID,
        event_type: str,
        previous,
        current,
        source: str,
        *,
        previous_details: dict | None = None,
        new_details: dict | None = None,
    ):
        self._scope(profile_id)
        if current.profile_id != profile_id or (
            previous is not None and previous.profile_id != profile_id
        ):
            raise ValueError("History must belong to the active profile")
        target = MAPPINGS[type(current)].__tablename__
        before, after = snapshot(previous), snapshot(current)
        if previous_details is not None and before is not None:
            before["presentation"] = previous_details
        if new_details is not None:
            after["presentation"] = new_details
        self.session.add(
            AuditRow(
                id=uuid4(),
                profile_id=profile_id,
                event_type=event_type,
                target_type=target,
                target_id=current.id,
                **{f"{target}_id": current.id},
                previous_state=before,
                new_state=after,
                source=source,
                created_at=utc_now(),
            )
        )
        self.session.flush()

    def feedback_page(self, profile_id, target_type, target_id, *, limit, before):
        self._scope(profile_id)
        query = select(ValidationRow).where(
            ValidationRow.profile_id == profile_id,
            ValidationRow.target_type == target_type,
            ValidationRow.target_id == target_id,
        )
        if before is not None:
            cursor = self.session.scalar(query.where(ValidationRow.id == before))
            if cursor is None:
                raise SemanticNotFoundError("Feedback cursor not found for this target")
            query = query.where(
                tuple_(ValidationRow.created_at, ValidationRow.id)
                < tuple_(cursor.created_at, cursor.id)
            )
        rows = tuple(
            self.session.scalars(
                query.order_by(ValidationRow.created_at.desc(), ValidationRow.id.desc()).limit(
                    limit + 1
                )
            )
        )
        return FeedbackPage(
            items=tuple(
                FeedbackEvidence(
                    id=r.id,
                    profile_id=r.profile_id,
                    target_type=r.target_type,
                    target_id=r.target_id,
                    action=r.action,
                    corrected_value=r.corrected_value.get("text") if r.corrected_value else None,
                    actor_role=r.actor_role,
                    created_at=r.created_at,
                )
                for r in rows[:limit]
            ),
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )

    def purge(self, profile_id: UUID):
        self._scope(profile_id)
        # Narrow transaction-local permission. Normal history updates/deletes remain refused.
        self.session.execute(
            select(func.set_config("pictoflow.purge_profile", str(profile_id), True))
        )
        for row_type in (
            KeyboardPositionRow,
            AuditRow,
            ValidationRow,
            KeyboardGroupRow,
            SequenceItemRow,
            InterpretationRow,
            SequenceRow,
            BlockRow,
            GapRow,
            RelationRow,
            PhotoAssetRow,
            RepresentationRow,
            ConceptRow,
        ):
            self.session.execute(delete(row_type).where(row_type.profile_id == profile_id))
        self.session.execute(select(func.set_config("pictoflow.purge_profile", "", True)))
        profile = self.session.get(ProfileRow, profile_id)
        profile.version += 1
        profile.updated_at = utc_now()
        self.session.flush()

    def remove_photo(self, profile_id: UUID, photo_id: UUID):
        self._scope(profile_id)
        self.session.execute(
            delete(PhotoAssetRow).where(
                PhotoAssetRow.profile_id == profile_id, PhotoAssetRow.id == photo_id
            )
        )

    def audit_history(
        self, profile_id: UUID, *, target_type: str | None, target_id: UUID | None, limit: int
    ):
        self._scope(profile_id)
        query = select(AuditRow).where(AuditRow.profile_id == profile_id)
        if target_type is not None:
            query = query.where(AuditRow.target_type == target_type)
        if target_id is not None:
            query = query.where(AuditRow.target_id == target_id)
        rows = self.session.scalars(query.order_by(AuditRow.created_at, AuditRow.id).limit(limit))
        return tuple(
            SemanticAuditEvent(
                id=row.id,
                profile_id=row.profile_id,
                event_type=row.event_type,
                target_type=row.target_type,
                target_id=row.target_id,
                previous_state=json.dumps(row.previous_state)
                if row.previous_state is not None
                else None,
                new_state=json.dumps(row.new_state) if row.new_state is not None else None,
                source=row.source,
                created_at=row.created_at,
            )
            for row in rows
        )


class PostgresPCLUnits:
    def __init__(self, factory: sessionmaker[Session], actor_reference: str | None = None):
        self.factory = factory
        self.actor_reference = actor_reference

    @contextmanager
    def __call__(self) -> Iterator[PostgresPCLRepository]:
        with transaction(self.factory) as session:
            yield PostgresPCLRepository(session, self.actor_reference)
