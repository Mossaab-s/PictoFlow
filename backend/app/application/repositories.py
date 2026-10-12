"""Persistence ports: every operation on personal data requires profile scope."""

from typing import Protocol
from uuid import UUID

from app.domain.pcl.entities import Concept, Representation, UserCommunicationProfile


class ProfileRepository(Protocol):
    def add(self, profile: UserCommunicationProfile) -> None: ...

    def get_by_id(self, profile_id: UUID) -> UserCommunicationProfile | None: ...


class ConceptRepository(Protocol):
    def add(self, profile_id: UUID, concept: Concept) -> None: ...

    def get_by_id(self, profile_id: UUID, concept_id: UUID) -> Concept | None: ...

    def update_label(self, profile_id: UUID, concept_id: UUID, label: str) -> Concept | None: ...


class RepresentationRepository(Protocol):
    def add(self, profile_id: UUID, representation: Representation) -> None: ...

    def get_by_id(self, profile_id: UUID, representation_id: UUID) -> Representation | None: ...

    def delete(self, profile_id: UUID, representation_id: UUID) -> bool: ...
