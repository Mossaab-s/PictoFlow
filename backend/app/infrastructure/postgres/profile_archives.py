"""Consistent exports and atomic, idempotent restoration into a new profile."""

import base64
import hashlib
import json
from dataclasses import asdict
from io import BytesIO
from uuid import UUID

from PIL import Image, UnidentifiedImageError
from pydantic import TypeAdapter
from sqlalchemy import func, select

from app.application.photos import PhotoAsset
from app.application.profile_archive import (
    MAX_ARCHIVE_BYTES,
    MAX_RECORDS,
    ArchiveError,
    ArchiveTooLarge,
    FeedbackRecord,
    PhotoRecord,
    ProfileArchive,
    Records,
    RestoreConflict,
    RestoreRequest,
    remap_archive,
)
from app.domain.pcl.audit import SemanticAuditEvent
from app.domain.pcl.entities import (
    CommunicationBlock,
    CommunicationSequence,
    Concept,
    HumanRole,
    Interpretation,
    Representation,
    SemanticRelation,
    TargetType,
    UserCommunicationProfile,
    ValidationAction,
    utc_now,
)
from app.domain.pcl.gaps import SemanticGapCandidate
from app.domain.pcl.keyboard import KeyboardGroup, KeyboardPosition
from app.infrastructure.postgres.database import transaction
from app.infrastructure.postgres.models import AuditRow, ProfileRestoreRow, ValidationRow
from app.infrastructure.postgres.pcl_repository import MAPPINGS, PostgresPCLRepository
from app.infrastructure.postgres.repositories import PostgresProfileRepository

ENTITIES = {
    "concepts": Concept,
    "representations": Representation,
    "relations": SemanticRelation,
    "gaps": SemanticGapCandidate,
    "blocks": CommunicationBlock,
    "groups": KeyboardGroup,
    "positions": KeyboardPosition,
    "sequences": CommunicationSequence,
    "interpretations": Interpretation,
}


def validate_archive_media(archive: ProfileArchive):
    for photo in archive.records.photos:
        content = photo.content()
        try:
            with Image.open(BytesIO(content)) as image:
                if (
                    image.format != "JPEG"
                    or image.size != (photo.width, photo.height)
                    or not content.endswith(b"\xff\xd9")
                    or any(key in image.info for key in ("exif", "icc_profile", "comment"))
                ):
                    raise ValueError
                image.verify()
                # verify() alone does not decode JPEG scan data.
            with Image.open(BytesIO(content)) as image:
                image.load()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            raise ArchiveError("Invalid archived image") from None


class PostgresProfileArchives:
    def __init__(self, factory):
        self.factory = factory

    def export(self, profile_id: UUID) -> bytes:
        with transaction(self.factory) as session:
            store = PostgresPCLRepository(session)
            store._scope(profile_id)  # Same lock as all PCL writers: one coherent snapshot.
            profile = PostgresProfileRepository(session).get_by_id(profile_id)
            exported_at = utc_now()
            empty = ProfileArchive(
                format="pictoflow-profile",
                version=2,
                exported_at=exported_at,
                profile=profile,
                records=Records(**{name: () for name in Records.model_fields}),
            )
            size = len(empty.model_dump_json().encode("utf-8"))
            adapters, seen = {}, set()

            def retain(name, value):
                nonlocal size
                entity = type(value)
                if entity not in adapters:
                    adapters[entity] = TypeAdapter(entity)
                size += len(adapters[entity].dump_json(value)) + (name in seen)
                seen.add(name)
                if size > MAX_ARCHIVE_BYTES:
                    raise ArchiveTooLarge("Archive exceeds 32 MiB")
                return value

            def rows(row_type):
                return session.scalars(
                    select(row_type)
                    .where(row_type.profile_id == profile_id)
                    .order_by(row_type.id)
                    .execution_options(yield_per=1 if row_type is MAPPINGS[PhotoAsset] else 32)
                )

            total = 0
            for row_type in (*MAPPINGS.values(), ValidationRow, AuditRow):
                count = session.scalar(
                    select(func.count())
                    .select_from(row_type)
                    .where(row_type.profile_id == profile_id)
                )
                total += count
                if count > 10_000 or total > MAX_RECORDS:
                    raise ArchiveTooLarge("Profile exceeds archive record limits")
            records = {
                name: tuple(
                    retain(name, store._domain(entity, row)) for row in rows(MAPPINGS[entity])
                )
                for name, entity in ENTITIES.items()
            }
            records["photos"] = tuple(
                retain(
                    "photos",
                    PhotoRecord(
                        id=p.id,
                        profile_id=p.profile_id,
                        content_base64=base64.b64encode(p.content).decode(),
                        digest=p.digest,
                        width=p.width,
                        height=p.height,
                        created_at=p.created_at,
                    ),
                )
                for p in rows(MAPPINGS[PhotoAsset])
            )
            records["validations"] = tuple(
                retain(
                    "validations",
                    FeedbackRecord(
                        id=r.id,
                        profile_id=r.profile_id,
                        target_type=TargetType(r.target_type),
                        target_id=r.target_id,
                        action=ValidationAction(r.action),
                        corrected_value=r.corrected_value.get("text")
                        if r.corrected_value
                        else None,
                        actor_role=HumanRole(r.actor_role) if r.actor_role else None,
                        actor_reference=r.actor_reference,
                        created_at=r.created_at,
                    ),
                )
                for r in rows(ValidationRow)
            )
            records["audit"] = tuple(
                retain(
                    "audit",
                    SemanticAuditEvent(
                        id=r.id,
                        profile_id=r.profile_id,
                        target_type=r.target_type,
                        target_id=r.target_id,
                        event_type=r.event_type,
                        source=r.source,
                        previous_state=json.dumps(r.previous_state)
                        if r.previous_state is not None
                        else None,
                        new_state=json.dumps(r.new_state) if r.new_state is not None else None,
                        created_at=r.created_at,
                    ),
                )
                for r in rows(AuditRow)
            )
            snapshot = ProfileArchive(
                format="pictoflow-profile",
                version=2,
                exported_at=exported_at,
                profile=profile,
                records=Records(**records),
            )
            result = snapshot.model_dump_json().encode("utf-8")
            if len(result) > MAX_ARCHIVE_BYTES:
                raise ArchiveTooLarge("Archive exceeds 32 MiB")
            return result

    @staticmethod
    def preview(snapshot: ProfileArchive):
        validate_archive_media(snapshot)
        # Validate historical typed references as well, without a database mutation.
        remap_archive(snapshot, UserCommunicationProfile())

    def restore(self, request: RestoreRequest) -> UserCommunicationProfile:
        self.preview(request.snapshot)
        payload = request.model_dump(mode="json")
        if request.snapshot.version == 1:
            # Keep receipts issued before shortcuts valid for the exact same legacy request.
            # v1 parsing guarantees that this omitted field can only default to false.
            for item in payload["snapshot"]["records"]["interpretations"]:
                item.pop("shortcut")
        encoded = json.dumps(
            payload,
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        digest = hashlib.sha256(encoded).hexdigest()
        lock = int.from_bytes(hashlib.sha256(request.request_id.bytes).digest()[:8], signed=True)
        with transaction(self.factory) as session:
            session.execute(select(func.pg_advisory_xact_lock(lock)))
            receipt = session.get(ProfileRestoreRow, request.request_id)
            profiles = PostgresProfileRepository(session)
            if receipt is not None:
                if receipt.payload_digest != digest:
                    raise RestoreConflict("Restore ID already used")
                return profiles.get_by_id(receipt.profile_id)
            profile = UserCommunicationProfile(display_name=request.display_name)
            profiles.add(profile)
            archive = remap_archive(request.snapshot, profile)
            store = PostgresPCLRepository(session)
            for name in ENTITIES:
                for value in getattr(archive.records, name):
                    store.add(profile.id, value)
            for photo in archive.records.photos:
                store.add(
                    profile.id,
                    PhotoAsset(
                        id=photo.id,
                        profile_id=profile.id,
                        content=photo.content(),
                        digest=photo.digest,
                        width=photo.width,
                        height=photo.height,
                        created_at=photo.created_at,
                    ),
                )
            for event in archive.records.validations:
                data = event.model_dump()
                data["corrected_value"] = (
                    {"text": event.corrected_value} if event.corrected_value is not None else None
                )
                session.add(ValidationRow(**data, **{f"{event.target_type}_id": event.target_id}))
            for event in archive.records.audit:
                data = asdict(event)
                for key in ("previous_state", "new_state"):
                    data[key] = json.loads(data[key]) if data[key] is not None else None
                session.add(AuditRow(**data, **{f"{event.target_type}_id": event.target_id}))
            session.add(
                ProfileRestoreRow(
                    id=request.request_id,
                    profile_id=profile.id,
                    payload_digest=digest,
                    actor_role=request.actor_role,
                )
            )
            session.flush()
            return profile
