# PostgreSQL persistence foundation

DB-015 implements the initial PostgreSQL mappings and Alembic migration.
The PCL domain remains plain Python. SQLAlchemy lives entirely under
`backend/app/infrastructure/postgres`.

## Scope and contracts

The first domain contracts are `UserCommunicationProfile`, `Concept` and
`Representation`. They are immutable dataclasses, independent from SQLAlchemy.
Repository ports live in `app/application/repositories.py`; PostgreSQL adapters
return these domain objects rather than ORM rows.

The expanded pure domain core is documented in [PCL_CORE.md](PCL_CORE.md).
Audited semantic operations and queries are documented in
[SEMANTIC_SPACE.md](SEMANTIC_SPACE.md). The complete local functional baseline
and isolation coverage are summarized in [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md).

## Tables

| Table | Purpose |
| --- | --- |
| `user_communication_profile` | Profile identity, timestamps and version |
| `concept` | Profile-specific semantic identity and label |
| `representation` | Concept representation and provenance/license metadata |
| `communication_block` | Selectable concept or intent with stability and origin |
| `semantic_relation` | Directed concept relation, confidence and validation counters |
| `communication_sequence` | Session association and completion state |
| `communication_sequence_item` | Ordered block selections; duplicates are allowed |
| `interpretation` | Original proposal and optional corrected text |
| `validation_event` | Human feedback facts |
| `semantic_gap_candidate` | Repeated validated intent and occurrence counts |
| `semantic_audit_event` | Semantic evolution facts |

Session and context IDs on sequences are opaque references to transient state,
not foreign keys into a persistent context table.

## Profile isolation

Every personal table includes `profile_id`. Entity rows have a globally unique
UUID plus a unique `(profile_id, id)` pair. Links to concepts, representations,
blocks, sequences and event targets use composite foreign keys against that
pair. A relation in A cannot target a concept in B, even through direct SQL.

Repository reads and updates require both `profile_id` and entity ID. Inserts
also check that the supplied entity belongs to the active profile. A foreign
profile read/update returns `None`; deleting a foreign representation returns
`False`. No semantic repository exposes an unscoped `get_by_id(id)` method.

Audit and validation targets are polymorphic at the domain boundary. Their SQL
rows retain `target_type` and `target_id` and include one typed target column
with a real composite foreign key. A check constraint requires that exactly the
matching target is populated and its ID equals `target_id`. This prevents
cross-profile or nonexistent event targets without replacing FKs with opaque JSON.

These protections do not implement authentication or PostgreSQL row-level
security; those are outside DB-015. Raw SQL access remains an infrastructure
capability, while application code must use scoped ports.

## Transactions and state

Engine creation is explicit and does not connect at API startup. SQLAlchemy
session factories are provided by `database.py`; its `transaction()` context
manager commits successful work and rolls back failures. Repositories flush
changes but never commit independently.

The database checks status values, confidence in `[0, 1]`, nonnegative counts,
concept-key uniqueness per profile and sequence completion consistency.
High confidence does not set validation status. Representations, relations,
blocks and interpretations default to proposals where applicable.

Database statuses represent stored state, not authorization to perform a state
transition. SEM-002 controls relation promotion and records human feedback and
audit in one transaction. VAL-005 additionally handles persistent interpretation
feedback and corrected relation replacement.

## History and deletion

All foreign keys use `ON DELETE RESTRICT`. There are no ORM cascade-delete
relationships. Deleting a representation cannot delete its concept; deleting a
referenced concept, representation or profile is refused.

PostgreSQL triggers reject `UPDATE` and `DELETE` on audit and validation events.
Corrections therefore require new history facts. SEM-002 automatically records
concept and relation changes; AUDIT-010 extends this to the communication lifecycle,
gaps, representations, blocks and keyboard presentation changes.

Removing an unreferenced representation is supported by the scoped adapter.
Referenced representations must eventually use an explicit archive workflow.
MEM-003 supplies explicit profile-memory erasure with a narrowly scoped history
deletion exception, instead of cascades. See
[COMMUNICATION_MEMORY.md](COMMUNICATION_MEMORY.md) for its transaction and
transient-storage semantics. Normal history updates/deletes remain prohibited.

Alembic downgrade is an explicit schema operation intended for development and
tests; it drops the tables and the history-protection function.

## Verification

The integration suite runs actual Alembic upgrade/downgrade, compares the migrated
schema with ORM metadata, persists domain objects, tests scoped operations and
composite FKs, preserves concepts after representation removal, checks history
immutability and verifies transaction commit/rollback. Tests operate in random
schemas inside rolled-back transactions, leaving other schemas untouched.
