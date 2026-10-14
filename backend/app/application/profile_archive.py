"""Versioned, self-contained PCL archives; never provider or transient state."""

import base64
import hashlib
import json
from dataclasses import fields, replace
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

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
)
from app.domain.pcl.gaps import SemanticGapCandidate, sequence_signature
from app.domain.pcl.invariants import timestamp
from app.domain.pcl.keyboard import KeyboardGroup, KeyboardPosition, project_keyboard

MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
MAX_RESTORE_BYTES = MAX_ARCHIVE_BYTES + 1024
MAX_RECORDS = 50_000


class ArchiveError(ValueError):
    """Archive cannot be restored; never include its content in errors."""


class ArchiveTooLarge(ArchiveError):
    pass


class RestoreConflict(ArchiveError):
    pass


class Contract(BaseModel):
    model_config = ConfigDict(
        strict=True, extra="forbid", frozen=True, hide_input_in_errors=True, allow_inf_nan=False
    )


class PhotoRecord(Contract):
    id: UUID
    profile_id: UUID
    content_base64: Annotated[str, Field(min_length=1, max_length=2_796_204)]
    digest: Annotated[str, Field(pattern="^[0-9a-f]{64}$")]
    width: Annotated[int, Field(ge=1, le=1024)]
    height: Annotated[int, Field(ge=1, le=1024)]
    created_at: datetime

    def content(self) -> bytes:
        try:
            value = base64.b64decode(self.content_base64, validate=True)
            if not 1 <= len(value) <= 2 * 1024 * 1024:
                raise ValueError
            if hashlib.sha256(value).hexdigest() != self.digest:
                raise ValueError
            return value
        except ValueError:
            raise ArchiveError("Invalid photo archive") from None

    @model_validator(mode="after")
    def integrity(self):
        timestamp(self.created_at, "created_at")
        self.content()
        return self


class FeedbackRecord(Contract):
    id: UUID
    profile_id: UUID
    target_type: TargetType
    target_id: UUID
    action: ValidationAction
    corrected_value: str | None
    actor_role: HumanRole | None  # Old evidence may have no recorded human role.
    actor_reference: str | None
    created_at: datetime

    @model_validator(mode="after")
    def consistent_feedback(self):
        timestamp(self.created_at, "created_at")
        if self.action == "correct":
            if self.corrected_value is None or not self.corrected_value.strip():
                raise ArchiveError("Invalid correction")
        elif self.corrected_value is not None:
            raise ArchiveError("Unexpected correction")
        return self


class Records(Contract):
    concepts: Annotated[tuple[Concept, ...], Field(max_length=10_000)]
    representations: Annotated[tuple[Representation, ...], Field(max_length=10_000)]
    blocks: Annotated[tuple[CommunicationBlock, ...], Field(max_length=10_000)]
    relations: Annotated[tuple[SemanticRelation, ...], Field(max_length=10_000)]
    sequences: Annotated[tuple[CommunicationSequence, ...], Field(max_length=10_000)]
    interpretations: Annotated[tuple[Interpretation, ...], Field(max_length=10_000)]
    gaps: Annotated[tuple[SemanticGapCandidate, ...], Field(max_length=10_000)]
    groups: Annotated[tuple[KeyboardGroup, ...], Field(max_length=10_000)]
    positions: Annotated[tuple[KeyboardPosition, ...], Field(max_length=10_000)]
    photos: Annotated[tuple[PhotoRecord, ...], Field(max_length=10_000)]
    validations: Annotated[tuple[FeedbackRecord, ...], Field(max_length=10_000)]
    audit: Annotated[tuple[SemanticAuditEvent, ...], Field(max_length=10_000)]

    def collections(self):
        return {name: getattr(self, name) for name in type(self).model_fields}


TARGETS = {
    "concept": "concepts",
    "representation": "representations",
    "communication_block": "blocks",
    "semantic_relation": "relations",
    "communication_sequence": "sequences",
    "interpretation": "interpretations",
    "semantic_gap_candidate": "gaps",
    "keyboard_group": "groups",
}


class ProfileArchive(Contract):
    format: Literal["pictoflow-profile"]
    version: Annotated[int, Field(strict=True, ge=1, le=2)]
    exported_at: datetime
    profile: UserCommunicationProfile
    records: Records

    @model_validator(mode="after")
    def references(self):
        timestamp(self.exported_at, "exported_at")
        collections = self.records.collections()
        if sum(map(len, collections.values())) > MAX_RECORDS:
            raise ArchiveTooLarge("Too many records")
        known = {}
        for name, values in collections.items():
            known[name] = {v.id: v for v in values}
            if len(known[name]) != len(values):
                raise ArchiveError("Duplicate record identity")
            if any(v.profile_id != self.profile.id for v in values):
                raise ArchiveError("Archive spans profiles")

        def ref(collection, value):
            if value is not None and value not in known[collection]:
                raise ArchiveError("Missing archive reference")

        def unique(values):
            if len(values) != len(set(values)):
                raise ArchiveError("Conflicting archive records")

        unique([c.canonical_key for c in self.records.concepts])
        unique([g.label for g in self.records.groups])
        unique([b.semantic_gap_id for b in self.records.blocks if b.semantic_gap_id])
        unique([(g.source_sequence_signature, g.validated_intent) for g in self.records.gaps])
        for visual in self.records.representations:
            ref("concepts", visual.concept_id)
            if visual.source == "personal-photo":
                if visual.type != "photo" or visual.asset_reference != f"photo:{visual.id}":
                    raise ArchiveError("Invalid personal photo reference")
                if visual.status in ("proposed", "validated"):
                    ref("photos", visual.id)
        for photo in self.records.photos:
            ref("representations", photo.id)
            if known["representations"][photo.id].source != "personal-photo":
                raise ArchiveError("Unexpected photo payload")
        for block in self.records.blocks:
            ref("concepts", block.concept_id)
            ref("representations", block.representation_id)
            ref("gaps", block.semantic_gap_id)
            if block.representation_id:
                visual = known["representations"][block.representation_id]
                if visual.concept_id != block.concept_id:
                    raise ArchiveError("Representation changes block meaning")
                if visual.source == "personal-photo" and block.visual_reference not in (
                    None,
                    visual.asset_reference,
                ):
                    raise ArchiveError("Invalid block photo reference")
        for relation in self.records.relations:
            ref("concepts", relation.source_concept_id)
            ref("concepts", relation.target_concept_id)
        for sequence in self.records.sequences:
            for block_id in sequence.block_ids:
                ref("blocks", block_id)
        accepted = []
        for item in self.records.interpretations:
            if self.version == 1 and item.shortcut:
                raise ArchiveError("Shortcuts require archive version 2")
            ref("sequences", item.sequence_id)
            if known["sequences"][item.sequence_id].status != "completed":
                raise ArchiveError("Interpretation has no completed sequence")
            if item.validated_text is not None:
                accepted.append(item.sequence_id)
        unique(accepted)
        signatures = {
            sequence_signature(s) for s in self.records.sequences if s.status == "completed"
        }
        for gap in self.records.gaps:
            if gap.source_sequence_signature not in signatures:
                raise ArchiveError("Gap has no source sequence")
        for position in self.records.positions:
            ref("groups", position.group_id)
            ref("blocks", position.block_id)
        project_keyboard(self.profile.id, self.records.blocks, self.records.positions)
        for event in (*self.records.validations, *self.records.audit):
            ref(TARGETS[event.target_type], event.target_id)
        return self


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ArchiveError("Duplicate JSON key")
        result[key] = value
    return result


def parse_json(data: bytes):
    try:
        value = json.loads(
            data,
            object_pairs_hook=_pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(ValueError()),
        )
        pending = [(value, 0)]
        while pending:
            item, depth = pending.pop()
            if depth > 64:
                raise ArchiveError("Archive nesting exceeds its limit")
            if isinstance(item, dict):
                pending.extend((v, depth + 1) for v in item.values())
            elif isinstance(item, list):
                pending.extend((v, depth + 1) for v in item)
        return value
    except (ValueError, RecursionError, UnicodeError):
        raise ArchiveError("Invalid JSON archive") from None


def parse_archive(data: bytes) -> ProfileArchive:
    if len(data) > MAX_ARCHIVE_BYTES:
        raise ArchiveTooLarge("Archive exceeds 32 MiB")
    complete_snapshot(parse_json(data))
    try:
        return ProfileArchive.model_validate_json(data)
    except (ValidationError, ValueError, RecursionError):
        raise ArchiveError("Invalid profile archive") from None


class RestoreRequest(Contract):
    request_id: UUID
    actor_role: HumanRole
    confirm: Annotated[bool, Field(strict=True)]
    display_name: Annotated[str, Field(min_length=1, max_length=80)] | None
    snapshot: ProfileArchive

    @model_validator(mode="after")
    def name(self):
        if self.confirm is not True:
            raise ArchiveError("Human confirmation required")
        if self.display_name is not None and self.display_name != self.display_name.strip():
            raise ArchiveError("Invalid restored name")
        return self


def parse_restore(data: bytes) -> RestoreRequest:
    if len(data) > MAX_RESTORE_BYTES:
        raise ArchiveTooLarge("Restore request exceeds its limit")
    value = parse_json(data)
    if not isinstance(value, dict):
        raise ArchiveError("Invalid restore envelope")
    complete_snapshot(value.get("snapshot"))
    try:
        return RestoreRequest.model_validate_json(data)
    except (ValidationError, ValueError, RecursionError):
        raise ArchiveError("Invalid restore request") from None


def complete_snapshot(value):
    """Persisted fields are required; only old v1 messages default to no shortcut."""
    if not isinstance(value, dict):
        raise ArchiveError("Invalid snapshot")
    profile = value.get("profile")
    records = value.get("records")
    if not isinstance(profile, dict) or set(profile) != {
        f.name for f in fields(UserCommunicationProfile)
    }:
        raise ArchiveError("Incomplete archived profile")
    if not isinstance(records, dict):
        raise ArchiveError("Incomplete archive records")
    entities = {
        "concepts": Concept,
        "representations": Representation,
        "blocks": CommunicationBlock,
        "relations": SemanticRelation,
        "sequences": CommunicationSequence,
        "interpretations": Interpretation,
        "gaps": SemanticGapCandidate,
        "groups": KeyboardGroup,
        "positions": KeyboardPosition,
        "audit": SemanticAuditEvent,
    }
    for name, entity in entities.items():
        items = records.get(name)
        if isinstance(items, list):
            required = {f.name for f in fields(entity)}
            if entity is Interpretation and value.get("version") == 1:
                required.remove("shortcut")
            for item in items:
                if not isinstance(item, dict) or set(item) != required:
                    raise ArchiveError("Incomplete archive record")


REFERENCES = {
    "concept_id": "concepts",
    "source_concept_id": "concepts",
    "target_concept_id": "concepts",
    "representation_id": "representations",
    "block_id": "blocks",
    "semantic_gap_id": "gaps",
    "sequence_id": "sequences",
    "group_id": "groups",
    "session_id": "sessions",
    "context_id": "contexts",
}


def remap_archive(archive: ProfileArchive, profile: UserCommunicationProfile) -> ProfileArchive:
    """Rewrite typed references only; never rewrite a person's words or labels."""

    def identity(collection, value):
        if value is None:
            return None
        try:
            original = UUID(str(value))
        except (ValueError, TypeError, AttributeError):
            raise ArchiveError("Invalid historical reference") from None
        return uuid5(profile.id, f"{collection}:{original}")

    managed_photos = {
        str(r.id) for r in archive.records.representations if r.source == "personal-photo"
    }

    def photo_reference(value):
        if isinstance(value, str) and value.startswith("photo:"):
            if value[6:] in managed_photos:
                return f"photo:{identity('representations', value[6:])}"
        return value

    signatures = {}
    for sequence in archive.records.sequences:
        changed = replace(
            sequence,
            profile_id=profile.id,
            block_ids=tuple(identity("blocks", i) for i in sequence.block_ids),
        )
        signatures[sequence_signature(sequence)] = sequence_signature(changed)

    def state(value, collection, target_id=None):
        if value is None:
            return None
        decoded = parse_json(value)
        if not isinstance(decoded, dict):
            raise ArchiveError("Invalid history snapshot")
        if "profile_id" in decoded and decoded["profile_id"] != str(archive.profile.id):
            raise ArchiveError("History spans profiles")
        if target_id is not None and "id" in decoded and decoded["id"] != str(target_id):
            raise ArchiveError("History changes target")
        for key, item in tuple(decoded.items()):
            if key == "id":
                if item is None:
                    raise ArchiveError("Missing historical identity")
                decoded[key] = str(identity(collection, item))
            elif key == "profile_id":
                decoded[key] = str(profile.id)
            elif key in REFERENCES and item is not None:
                decoded[key] = str(identity(REFERENCES[key], item))
            elif key == "block_ids":
                if not isinstance(item, list) or any(i is None for i in item):
                    raise ArchiveError("Invalid historical selections")
                decoded[key] = [str(identity("blocks", i)) for i in item]
            elif key in ("visual_reference", "asset_reference"):
                decoded[key] = photo_reference(item)
            elif key == "source_sequence_signature":
                if not isinstance(item, str) or item not in signatures:
                    raise ArchiveError("Missing historical sequence")
                decoded[key] = signatures[item]
            elif key == "presentation":
                if item is not None:
                    decoded[key] = json.loads(state(json.dumps(item), "positions"))
        return json.dumps(decoded, ensure_ascii=False, allow_nan=False)

    collections = {}
    for name, values in archive.records.collections().items():
        changed = []
        for value in values:
            columns = (
                type(value).model_fields
                if isinstance(value, BaseModel)
                else {f.name: None for f in fields(value)}
            )
            updates = {
                "profile_id": profile.id,
                "id": identity("representations" if name == "photos" else name, value.id),
            }
            for key in columns:
                item = getattr(value, key)
                if key in REFERENCES:
                    updates[key] = identity(REFERENCES[key], item)
                elif key == "block_ids":
                    updates[key] = tuple(identity("blocks", i) for i in item)
                elif key in ("visual_reference", "asset_reference"):
                    updates[key] = photo_reference(item)
                elif key == "source_sequence_signature":
                    updates[key] = signatures[item]
            if name in ("validations", "audit"):
                updates["target_id"] = identity(TARGETS[value.target_type], value.target_id)
            if name == "audit":
                for key in ("previous_state", "new_state"):
                    updates[key] = state(
                        getattr(value, key), TARGETS[value.target_type], value.target_id
                    )
            changed.append(
                type(value)(**{**value.model_dump(), **updates})
                if isinstance(value, BaseModel)
                else replace(value, **updates)
            )
        collections[name] = tuple(changed)
    return ProfileArchive(
        format=archive.format,
        version=archive.version,
        exported_at=archive.exported_at,
        profile=profile,
        records=Records(**collections),
    )


def archive_summary(archive: ProfileArchive) -> dict:
    return {
        "version": archive.version,
        "exported_at": archive.exported_at,
        "display_name": archive.profile.display_name,
        "counts": {key: len(value) for key, value in archive.records.collections().items()},
        "validated_blocks": sum(b.status == "validated" for b in archive.records.blocks),
        "proposed_blocks": sum(b.status == "proposed" for b in archive.records.blocks),
        "accepted_interpretations": sum(
            i.validated_text is not None for i in archive.records.interpretations
        ),
    }
