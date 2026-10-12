# Personal semantic space (SEM-002)

`app/application/semantic_space.py` implements concept creation, label changes,
directed relation proposals, confidence changes, explicit human confirmation or
rejection, scoped queries and history. `app/domain/pcl/semantics.py` contains the
pure relation transitions. PostgreSQL is the persistent store; Redis and AI
providers are not dependencies of this service.

## Usage

Create the profile through the profile repository before using the service.
Engine and session-factory creation remain explicit; the HTTP application creates
units only when a database is configured and makes no startup connection. Scoped
business routes expose these operations; see [API_OBSERVABILITY.md](API_OBSERVABILITY.md).

```python
from app.application.semantic_space import SemanticSpace
from app.domain.pcl.entities import HumanRole, RelationType
from app.infrastructure.postgres.database import create_session_factory
from app.infrastructure.postgres.semantic_space import PostgresSemanticUnits

space = SemanticSpace(PostgresSemanticUnits(create_session_factory(engine)))
noise = space.create_concept(profile_id, "NOISE", "Bruit")
leave = space.create_concept(profile_id, "LEAVE", "Partir")
relation = space.create_relation(
    profile_id, noise.id, leave.id, RelationType.ASSOCIATED_WITH, .82
)
assert space.get_neighbours(profile_id, noise.id) == ()

space.confirm_relation(profile_id, relation.id, actor_role=HumanRole.USER)
assert space.get_neighbours(profile_id, noise.id) == (leave,)
```

## Identity, direction and queries

Relabelling preserves concept UUID and canonical key, so existing relations stay
attached to the same meaning. Canonical keys are unique within a profile and may
independently occur in another profile. No association is copied between profiles.

The five relation types are `associated_with`, `often_followed_by`,
`often_preceded_by`, `contextually_related_to` and `shortcut_for`. All are directed;
queries follow outgoing edges only. Multiple proposals between two concepts may
coexist, including different relation types. Neighbours are deduplicated by UUID.

| Method | Result |
| --- | --- |
| `get_neighbours(profile_id, concept_id)` | Concepts reached by validated outgoing relations |
| `get_validated_relations(profile_id, concept_id)` | Validated outgoing relations |
| `get_strongest_relations(profile_id, concept_id, limit=5)` | Strongest validated outgoing relations, up to the limit |
| `get_relations(..., status=..., relation_type=...)` | Explicit status partition and optional type filter |
| `get_history(profile_id, target_type, target_id)` | Immutable before/after domain values for this concept or relation |

Relations sort by descending confidence, then UUID for reproducible ties.
Limits must be positive integers. Missing or foreign concept queries return an
empty tuple; mutations raise `SemanticNotFoundError` without revealing an owner.
History queries are scoped by profile and typed target. Every SQL access to a
personal object includes the profile; composite foreign keys also prevent
cross-profile endpoints and feedback targets.

## Validation and atomic history

New relations always start as proposals. Setting confidence to 1.0 does not
validate them, and changing a rejected relation's confidence does not reactivate
it. Confirmation or rejection requires a typed human event and preserves both
historical counters. A later explicit confirmation can reactivate a rejection.
Changing directed endpoints or relation type requires a new proposal rather than
silently rewriting an already validated meaning.

Each mutation owns one transaction. A successful transaction persists the new
state and an append-only audit snapshot; confirmation and rejection also persist
their `ValidationEvent`. Any write failure rolls back all three. Mutations lock
the current concept or relation row before calculating changes. Externally
supplied feedback older than the current relation state is rejected. Replaying
the same feedback UUID cannot increment counters again.

Audit snapshots retain identity, timestamps, status, confidence and counters.
Human decisions record their role in the feedback row and as the audit source
(`human:user`, `human:caregiver`, or `human:professional`). Migration
`0002_validation_actor_role` adds the role column without changing existing
feedback facts; historical roles remain unknown (`NULL`). New service feedback
always includes a valid role. Existing database triggers prevent history updates
and deletion.

The role is an application input, not authentication. AUDIT-010 supplies broader
history queries, and VAL-005 supplies corrected relation replacement without
rewriting old endpoints. Low-level persistence adapters remain infrastructure
capabilities; business callers use services for audited semantic mutations.

## Verification

Pure domain tests verify confidence/state separation, feedback targets,
confirmation/rejection counts and chronological transitions. PostgreSQL tests
exercise the NOISE → HEADPHONES .90 / LEAVE .82 / FEAR .35 example, where only the
first two are validated; profile B sees none of A's relations. They also cover
relabelling, all relation types, direction, strongest results, history restoration,
invalid input and rollback after audit failure or duplicate feedback identity.
