from datetime import timedelta
from uuid import uuid4

from app.application.pcl_repository import AcceptedTrace
from app.application.personal_examples import select_examples
from app.domain.pcl.entities import CommunicationBlock, CommunicationSequence, utc_now


class Sources:
    def __init__(self):
        self.profile = uuid4()
        self.blocks = tuple(
            CommunicationBlock(
                profile_id=self.profile, label=s, canonical_intent=s, status="validated"
            )
            for s in ("Moi", "Manger", "Maison")
        )
        self.ids = tuple(b.id for b in self.blocks)
        self.traces = []

    def list(self, profile, kind):
        assert profile == self.profile
        return self.blocks if kind is CommunicationBlock else ()

    def accepted_traces(self, profile, **kwargs):
        assert profile == self.profile
        return tuple(self.traces)

    def add(self, text, ids=None, age=0):
        self.traces.append(
            AcceptedTrace(uuid4(), uuid4(), ids or self.ids, text, utc_now() - timedelta(days=age))
        )

    def select(self, limit=50):
        sequence = CommunicationSequence(
            profile_id=self.profile, session_id=uuid4(), block_ids=self.ids
        )
        return select_examples(self, self.profile, sequence, limit=limit)


def test_relevance_then_frequency_then_recency_and_personal_text_is_not_lexically_censored():
    sources = Sources()
    sources.add("Je voudrais manger chez moi.", age=10)
    sources.add("Je voudrais manger chez moi.", age=9)
    sources.add("J’aime manger à la maison.", age=1)
    sources.add("Juste une touche récente", ids=sources.ids[:1])
    result = sources.select()
    assert [x.text for x in result] == [
        "Je voudrais manger chez moi.",
        "J’aime manger à la maison.",
        "Juste une touche récente",
    ]
    assert result[0].occurrences == 2


def test_fifty_default_distinct_examples_and_total_serialized_character_budget():
    sources = Sources()
    for i in range(70):
        sources.add(f"Message accepté {i}", age=i)
    assert len(sources.select()) == 50
    assert len(sources.select(limit=60)) == 60
    sources.traces.clear()
    for i in range(70):
        sources.add(str(i) + "x" * 3900, age=i)
    result = sources.select()
    assert 0 < len(result) < 50
    assert sum(len(x.model_dump_json()) for x in result) <= 32000
