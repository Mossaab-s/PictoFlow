# Modify a copy of a finished pictogram message

A completed message offers **Modifier une copie** when all its 1–32 selected
blocks are still validated in this profile. The native dialog previews every
picture/photo and current word in order, including repetitions. **Garder mon
message** and Escape cancel locally; **Créer la copie modifiable** explicitly
creates a separate in-progress draft.

```text
Finished message and accepted meaning -- remain unchanged
         |
  [Modify a copy]
         |
  review: [Mother] [Water] [Book] [Water]
  [Keep my message] [Create editable copy]
         |
New draft, separate identity and session
  remove / move / replace / insert / append / speak
         |
  explicit completion -> optional new meaning proposal -> human decision
```

Only the ordered block identities are copied. Interpretations, their acceptance,
declared context and rhythm observations are not transferred. The copy does not
call AI, speak or learn automatically. The original message and accepted memory
remain intact when the new draft is edited. The existing completed-message replay
action in the memory panel retains its behavior.

## Interaction and recovery

The safe Keep action receives initial modal focus. Escape first stops active
speech, then dismisses the dialog. Pending creation disables confirmation and
cancellation. An offline preview can be dismissed and cannot submit; reconnecting
never queues a creation. After successful creation or reconciliation, focus goes
to the actual message heading; cancellation/failure returns to the copy action.
Reload/profile navigation discards an unsubmitted preview.

One POST creates all selections and their copy audit in a transaction, avoiding
partial append loops. A client request UUID identifies the target sequence.
Identical retries return the actual copy, preserving subsequent edits/completion
and never resetting it to the original selections. Reusing the identity for
another source or expected selection list conflicts.

An ambiguous response triggers a read-only lookup bound to source and request.
It never replays the POST automatically. If creation cannot be found, explicit
manual retry reuses the same identity. A failed recovery read blocks writes until
reload. A small best-effort session record retains only source/request UUIDs;
reload checks it before restoring the previous message. Its key lives under the
existing `pictoflow:sequence:` prefix and is cleared on account/session changes.
No words or pictures are added to browser recovery metadata. Browser storage
remains optional; PostgreSQL owns source and copied sequences.

Explicit new-message/replay choices discard the pending local copy reference.
A recovered copy already cancelled elsewhere returns to the source. A recovered
copy already completed elsewhere is displayed as completed, with no acceptance
invented locally. The next local append starts a fresh timing baseline.

## API

`POST /api/v1/profiles/{profile_id}/sequences/{sequence_id}/copy`

```json
{
  "request_id": "uuid-for-independent-copy",
  "expected_block_ids": ["uuid-for-mother", "uuid-for-water", "uuid-for-book", "uuid-for-water"],
  "confirm": true
}
```

UUIDs above are placeholders. Confirmation must be the boolean `true`; the
snapshot contains 1–32 UUIDs in exact source order. The service locks the scoped
source and requires a completed message matching that snapshot. Every block must
still be validated in the same profile. A stale/unfinished/unavailable source or
request collision returns 409 without partial creation. Foreign objects are not
found through another profile. A successful copy and `sequence_copied` audit are
atomic; the first event records `copied_from_sequence_id` with the original
selections. No migration is required.

`GET /api/v1/profiles/{profile_id}/sequences/{sequence_id}/copies/{request_id}`
returns `{ "sequence": ... }` for a copy whose creation audit belongs to that
source, or `{ "sequence": null }` while no copy exists in the profile. A missing
copy is a normal recovery outcome and does not trigger account-access refresh.
A foreign source still returns 404. The lookup returns the
actual current sequence state without mutation; an unrelated existing ID cannot
be adopted as a recovered copy. Creation requires `communicate`; read access uses
the existing communication-read capabilities. It does not grant meaning review,
keyboard preparation or profile-management access.

## Evidence

Domain/request and capability checks cover strict confirmation, size limits,
separate identity/session, repeated selections and source immutability. Real
PostgreSQL/API checks cover audit, accepted memory, source rhythm, idempotent
retry after editing/completion, collisions, profile scope and unavailable sources.
The authenticated communication-only browser journey covers local cancellation,
focus/speech, pending/offline guards, independent correction, committed/lost
responses, failed-read reload, manual same-request retry, full drafts and stale
source rejection. Synthetic desktop/320px previews complement existing correction
and complete POC journeys. Actual participant and device checks remain separate.
