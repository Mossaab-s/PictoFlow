import asyncio

import pytest
import sqlalchemy as sa

from app.ai.contracts import InterpretationRequest, SelectedBlock
from app.ai.errors import ProviderDisabledError
from app.ai.manager import ProviderManager
from app.ai.providers.disabled import DisabledProvider
from app.ai.providers.fake import FakeProvider
from app.domain.pcl.entities import Concept, UserCommunicationProfile
from app.infrastructure.postgres.models import Base, BlockRow, RelationRow
from app.infrastructure.postgres.repositories import (
    PostgresConceptRepository,
    PostgresProfileRepository,
)

pytestmark = pytest.mark.postgres


def test_fake_proposal_and_provider_replacement_do_not_mutate_pcl_state(session):
    profile = UserCommunicationProfile()
    PostgresProfileRepository(session).add(profile)
    concepts = PostgresConceptRepository(session)
    blocks = []
    for key, label in (("NOISE", "Bruit"), ("STOP", "Stop"), ("LEAVE", "Partir")):
        concept = Concept(profile_id=profile.id, canonical_key=key, label=label)
        concepts.add(profile.id, concept)
        block = BlockRow(
            profile_id=profile.id,
            concept_id=concept.id,
            label=label,
            origin="user",
            status="validated",
            stability="stable",
        )
        session.add(block)
        session.flush()
        blocks.append(SelectedBlock(block_id=block.id, label=label, meaning=key))
    concept_rows = session.execute(
        sa.text("SELECT id, canonical_key FROM concept WHERE profile_id = :profile_id"),
        {"profile_id": profile.id},
    ).all()
    concept_ids = {key: identifier for identifier, key in concept_rows}
    relation = RelationRow(
        profile_id=profile.id,
        source_concept_id=concept_ids["NOISE"],
        target_concept_id=concept_ids["LEAVE"],
        relation_type="associated_with",
        confidence=0.91,
        validation_count=1,
        status="validated",
    )
    session.add(relation)
    session.commit()
    request = InterpretationRequest(blocks=blocks)
    fake = ProviderManager(
        FakeProvider(
            {
                "interpretations": [
                    {
                        "request": request.model_dump(mode="json"),
                        "response": {
                            "candidates": [
                                {
                                    "intent": "LEAVE_DUE_TO_NOISE",
                                    "text": "Le bruit me gêne et je veux partir.",
                                    "confidence": 0.78,
                                }
                            ]
                        },
                    }
                ]
            }
        )
    )

    def snapshot():
        result = {}
        for table in Base.metadata.sorted_tables:
            # These are test data only, read back from PostgreSQL rather than the identity map.
            statement = sa.select(table)
            if table.name.startswith("auth_") or table.name == "ai_provider_configuration":
                pass  # Operational state is global and has different primary keys.
            elif "profile_id" in table.c:
                statement = statement.where(table.c.profile_id == profile.id)
            else:
                statement = statement.where(table.c.id == profile.id)
            result[table.name] = session.execute(statement).all()
        return result

    before = snapshot()
    proposal = asyncio.run(fake.interpret(request))
    assert proposal.status == "proposal"
    assert snapshot() == before
    disabled = ProviderManager(DisabledProvider())
    assert asyncio.run(disabled.health()).status == "disabled"
    with pytest.raises(ProviderDisabledError):
        asyncio.run(disabled.interpret(request))
    session.expunge_all()
    assert snapshot() == before
    assert concepts.get_by_id(profile.id, concept_ids["NOISE"]).label == "Bruit"
