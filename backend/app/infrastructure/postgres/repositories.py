"""Adapters return domain values and leave transaction commits to the caller."""

from dataclasses import fields
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.pcl.entities import Concept, Representation, UserCommunicationProfile, utc_now
from app.infrastructure.postgres.models import ConceptRow, ProfileRow, RepresentationRow


def to_values(entity) -> dict:
    return {field.name: getattr(entity, field.name) for field in fields(entity)}


def to_domain(entity_type, row):
    return entity_type(**{field.name: getattr(row, field.name) for field in fields(entity_type)})


class PostgresProfileRepository:
    def __init__(self, session: Session):
        self.session = session

    def add(self, profile: UserCommunicationProfile) -> None:
        self.session.add(ProfileRow(**to_values(profile)))
        self.session.flush()

    def get_by_id(self, profile_id: UUID) -> UserCommunicationProfile | None:
        row = self.session.scalar(select(ProfileRow).where(ProfileRow.id == profile_id))
        return to_domain(UserCommunicationProfile, row) if row is not None else None


class PostgresConceptRepository:
    def __init__(self, session: Session):
        self.session = session

    def add(self, profile_id: UUID, concept: Concept) -> None:
        if concept.profile_id != profile_id:
            raise ValueError("Concept does not belong to the active profile")
        self.session.add(ConceptRow(**to_values(concept)))
        self.session.flush()

    def get_by_id(self, profile_id: UUID, concept_id: UUID) -> Concept | None:
        row = self._find(profile_id, concept_id)
        return to_domain(Concept, row) if row is not None else None

    def update_label(self, profile_id: UUID, concept_id: UUID, label: str) -> Concept | None:
        if not label.strip():
            raise ValueError("Concept label must not be empty")
        row = self._find(profile_id, concept_id)
        if row is None:
            return None
        row.label = label
        row.updated_at = utc_now()
        self.session.flush()
        return to_domain(Concept, row)

    def _find(self, profile_id: UUID, concept_id: UUID) -> ConceptRow | None:
        return self.session.scalar(
            select(ConceptRow).where(
                ConceptRow.profile_id == profile_id, ConceptRow.id == concept_id
            )
        )


class PostgresRepresentationRepository:
    def __init__(self, session: Session):
        self.session = session

    def add(self, profile_id: UUID, representation: Representation) -> None:
        if representation.profile_id != profile_id:
            raise ValueError("Representation does not belong to the active profile")
        self.session.add(RepresentationRow(**to_values(representation)))
        self.session.flush()

    def get_by_id(self, profile_id: UUID, representation_id: UUID) -> Representation | None:
        row = self._find(profile_id, representation_id)
        return to_domain(Representation, row) if row is not None else None

    def delete(self, profile_id: UUID, representation_id: UUID) -> bool:
        row = self._find(profile_id, representation_id)
        if row is None:
            return False
        self.session.delete(row)
        self.session.flush()
        return True

    def _find(self, profile_id: UUID, representation_id: UUID) -> RepresentationRow | None:
        return self.session.scalar(
            select(RepresentationRow).where(
                RepresentationRow.profile_id == profile_id,
                RepresentationRow.id == representation_id,
            )
        )
