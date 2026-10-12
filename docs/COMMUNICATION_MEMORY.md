# Communication, memory and human feedback

MEM-003, SEQ-004, VAL-005 and CONF-006 are implemented by
`app/application/communication.py`. The sequence and confidence rules are pure
Python under `app/domain/pcl`. PostgreSQL units own state, feedback and audit
transactions; transient interaction memory delegates to the optional Redis port.

## Sequence lifecycle

Start a sequence with an explicit profile and session UUID, append validated
blocks, undo the latest selection, clear, complete or cancel. Order and repeated
selections are preserved. Completion requires at least one selection. Completed
and cancelled sequences are immutable through the lifecycle service. Only
completed sequences appear in communication history. Neither selection nor
completion creates semantic relations or accepted interpretations.

## Confidence and proposals

`ConfidencePolicy` accepts configurable refusal, confirmation and direct-proposal
thresholds (defaults .40, .65, .90). Thresholds must be strictly increasing and
finite. Eligible candidates are ranked and bounded: direct proposal or required
confirmation exposes one candidate, multiple hypotheses exposes at most three,
and refusal exposes none. A persisted refusal has empty text and cannot be
confirmed into meaning. Scores never promote proposals to validated memory.

The application requires a completed sequence and matching profile/sequence/source
for every interpretation proposal. Provider identity is provenance, not authority.
High-confidence proposals remain correctable.

## Memory partitions and validation

`memory(profile_id, validated=False)` returns proposed interpretations, relations
and blocks. `memory(..., validated=True)` returns accepted interpretations and
validated relations/blocks and their accepted completed sequences. Rejected and
refusal records remain historical and
are absent from both useful-memory partitions. History is never read as semantic
truth. Accepted interpretation text uses a human correction whenever one exists.

`validate(ValidationEvent(...))` explicitly confirms, corrects or rejects an
interpretation. Corrections preserve the original text; subsequent confirmations
cannot restore the model's original meaning. Rejection removes the accepted
meaning without deleting history. Reconfirmation needs a new human event. Each
sequence may have only one accepted hypothesis at a time. Reject an existing
accepted hypothesis before accepting another. Duplicate feedback UUIDs roll back
the entire transaction, and backdated feedback is rejected.

The service records state, human facts and audit together. PostgreSQL profile
locks serialize communication operations within one profile, including erasure;
object lookups and foreign keys retain explicit profile scope.

## Transient state and erasure

`InteractionMemory` handles explicitly supplied session/context values with a
positive TTL. It never infers context or promotes any value. Clearing a session
or context deletes only that transient key and cannot modify persistent memory.
When Redis is disabled, transient operations retain the explicit disabled error;
the persistent sequence/validation workflow remains fully usable.

`erase(profile_id, transient_store)` clears that profile's keys from the configured
transient backend, then removes its persistent personal rows and history. The
empty profile identity remains with an incremented version. Other profiles and
technical provider-health keys remain intact. Redis failure prevents persistent
erasure and is reported; if PostgreSQL fails after transient deletion, persistent
memory remains and the operation fails. This is not a distributed transaction.
Clients must stop writing interaction state during profile erasure.
Changing Redis configuration does not erase a previously configured server.

The lower-level `purge(profile_id)` handles PostgreSQL alone. Migration
`0003_explicit_memory_purge` adds a narrowly scoped, transaction-local deletion
exception to append-only history triggers. Updates remain prohibited; normal
deletes remain prohibited, and the exception can delete only the designated
profile's rows. This is an infrastructure capability, not authentication or an
authorization boundary for arbitrary SQL clients. No erasure is executed against
existing developer profiles by setup or migrations.

Tests cover threshold boundaries, exact order, non-promotion, correction
precedence, refusal, cross-profile access, rollback, duplicate feedback,
append-only facts, transient cleanup and complete scoped erasure.
