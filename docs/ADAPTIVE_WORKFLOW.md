# Validated repetition, controlled blocks and keyboard projection

GAP-007, PIC-008, KEY-009, AUDIT-010 and REP-013 use the shared PostgreSQL PCL
unit and the pure gap/keyboard domain modules. Semantic state, feedback and
history commit together. A profile lock serializes mutations and erasure.

## Semantic Gaps

`GapPolicy` groups completed sequences by an exact, profile-scoped SHA-256
signature of ordered block UUIDs. Different orders are different patterns.
Each sequence contributes at most one current accepted meaning. Proposed,
rejected and refusal interpretations do not count as accepted evidence.
Corrections contribute their corrected text, never the original AI text.

Thresholds are configurable (`PICTOFLOW_GAP_MINIMUM_OCCURRENCES=5`,
`PICTOFLOW_GAP_MINIMUM_VALIDATED=4`). The detector creates proposals only when
both counts are reached and no active block has the exact canonical intent.
No semantic normalization or observation window is inferred in V1.

Detection reuses an existing candidate for the same profile/pattern/meaning.
The database additionally enforces this identity with a unique expression index;
its MD5 is an indexing aid, not a security or semantic confidence mechanism.
Full intent text is retained. Human approval rechecks current evidence, so
subsequent interpretation rejections cannot leave an eligible-looking approval.

## Controlled block creation

A gap must be approved through a human event before `from_gap()` creates its
one block candidate. Creation rechecks eligibility. The candidate has a distinct
UUID, a gap reference, canonical intent, label, `pcl_suggestion` origin and
`adaptive` stability. It remains absent from the keyboard until human validation.

Confirmation/correction activates the block and resolves its gap; rejection
keeps the candidate and its history. Label correction does not rewrite canonical
meaning. Existing active intent matches prevent duplicate activation. Visual
replacement preserves block/gap identity and meaning. A stable block cannot have
its visual changed through the ordinary replacement method.

## Keyboard

`project_keyboard()` uses one profile's validated blocks and explicit positions.
Stable positions are locked and retain their position numbers, including holes.
New PCL blocks appear in the adaptive zone; ordinary personal vocabulary appears
in the personal zone unless explicitly positioned elsewhere. No automatic action
moves stable blocks. Manual placement requires a human validation event, and
new PCL suggestions cannot be promoted to stable through this V1 workflow.

Selection is submitted through the sequence API using the projected block UUID.
The sequence service independently verifies profile ownership and active status.
Projection and selection remain available without Redis or any AI provider.

## Representations

Representations are proposals attached to concept identity, with provenance and
known license metadata retained. The service supports creation, metadata/asset
updates, human confirmation/correction/rejection and archiving. It prohibits
changing concept identity or source through metadata updates.

Selecting a representation for a validated concept block requires a human event,
a validated representation and matching concept identity. Selection cannot create
relations. Archiving a symbol leaves the concept, other representations and
communication blocks intact; text remains available if a visual is unavailable.
Canonical-intent blocks currently use optional visual references; representation
attachment through concept UUIDs is restricted to concept blocks.

## Audit

The shared writer records concepts, relations, sequences, interpretations, gaps,
representations, blocks and manual keyboard changes. Keyboard audits retain
before/after presentation details as well as block stability. Immutable audit
domain objects hold JSON snapshots as strings, preventing nested dictionary
mutation from rewriting an event in memory. PostgreSQL prevents historical
updates/deletes except explicit profile erasure.

`AuditService.history()` reads chronological profile evolution or a typed target,
with a maximum of 1000 events per query. Audit is never a validated-memory source.
Rejected and corrected values remain inspectable in history.

## End-to-end verification

The integration scenario starts with validated NOISE → DISCOMFORT .91 and
NOISE → LEAVE .84 relations. Six ordered NOISE → STOP → LEAVE sequences produce
five accepted interpretations and one unconfirmed proposal using a mocked
provider. Detection creates one proposed gap. Human approval creates a proposed
block; separate human validation activates it in the adaptive zone while stable
positions remain unchanged. Refusal and rejected-evidence scenarios create no
accepted knowledge or gap. A disabled-provider test verifies the literal-label
fallback without claiming inferred meaning.
