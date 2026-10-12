"""Create a NEW synthetic profile; never modify or erase an existing profile."""

from uuid import uuid4

from app.application.blocks import BlockService
from app.application.communication import CommunicationService
from app.application.semantic_space import SemanticSpace
from app.config import Settings
from app.domain.pcl.entities import (
    Interpretation,
    RelationType,
    TargetType,
    UserCommunicationProfile,
    ValidationAction,
    ValidationEvent,
)
from app.domain.pcl.keyboard import KeyboardZone
from app.infrastructure.postgres.database import create_database_engine, create_session_factory
from app.infrastructure.postgres.pcl_repository import PostgresPCLUnits
from app.infrastructure.postgres.repositories import PostgresProfileRepository
from app.infrastructure.postgres.semantic_space import PostgresSemanticUnits


def main():
    engine = create_database_engine(Settings())
    factory = create_session_factory(engine)
    profile = UserCommunicationProfile()
    try:
        with factory.begin() as session:
            PostgresProfileRepository(session).add(profile)
        semantic = SemanticSpace(PostgresSemanticUnits(factory))
        units = PostgresPCLUnits(factory)
        blocks = BlockService(units)
        communication = CommunicationService(units)
        concepts, vocabulary = {}, {}
        for key, label in (
            ("YES", "Oui"),
            ("NO", "Non"),
            ("STOP", "Stop"),
            ("HELP", "Aide"),
            ("NOISE", "Bruit"),
            ("LEAVE", "Partir"),
            ("DISCOMFORT", "Gêne"),
        ):
            concept = semantic.create_concept(profile.id, key, label)
            concepts[key] = concept
            if key != "DISCOMFORT":
                block = blocks.create(profile.id, concept.id, label)
                vocabulary[key] = blocks.validate(
                    profile.id, block.id, action="confirm", actor_role="user"
                )
        for position, key in enumerate(("YES", "NO", "STOP", "HELP")):
            blocks.place(
                profile.id, vocabulary[key].id, KeyboardZone.STABLE, position, actor_role="user"
            )
        for key, score in (("DISCOMFORT", 0.91), ("LEAVE", 0.84)):
            relation = semantic.create_relation(
                profile.id,
                concepts["NOISE"].id,
                concepts[key].id,
                RelationType.ASSOCIATED_WITH,
                score,
            )
            semantic.confirm_relation(profile.id, relation.id, actor_role="user")
        for index in range(6):
            sequence = communication.start(profile.id, uuid4())
            for key in ("NOISE", "STOP", "LEAVE"):
                communication.select(profile.id, sequence.id, "append", vocabulary[key].id)
            communication.select(profile.id, sequence.id, "complete")
            item = Interpretation(
                profile_id=profile.id,
                sequence_id=sequence.id,
                text="Le bruit me gêne et je veux partir.",
                confidence=0.78,
                source="demo-fixture",
            )
            communication.propose(profile.id, sequence.id, (item,), source="demo-fixture")
            if index < 5:
                communication.validate(
                    ValidationEvent(
                        profile_id=profile.id,
                        target_type=TargetType.INTERPRETATION,
                        target_id=item.id,
                        action=ValidationAction.CONFIRM,
                        actor_reference="synthetic-demo-fixture",
                    )
                )
        blocks.detect_gaps(profile.id)
        print(f"Created synthetic demo profile: {profile.id}", flush=True)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
