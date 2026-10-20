# Move an occurrence in a draft message

**Corriger une touche** offers two operations. **Retirer une touche** remains the
default; **Déplacer une touche** becomes available with at least two selections.
The selected occurrence is identified by its picture/photo, word and ordinal.

```text
Current: [Water] [Mother] [Book] [Water]
                  |
       choose Mother, touch 2 of 4
       New place: [Place 1 of 4]
       [one place before] [one place after]
                  |
Preview: [Mother] [Water] [Book] [Water]
       [Keep current order] [Confirm this order]
```

The native selector reaches any destination; step buttons support keyboard and
mouse without dragging. The numbered preview retains every drawing/photo and
word and marks the moved occurrence. Long previews scroll inside a bounded area.
No change reaches the message/server until **Confirmer cet ordre**. An unchanged
result, including swapping indistinguishable repeated IDs, disables confirmation
and says **L’ordre reste inchangé.** Moving preserves every occurrence and the
32-touch limit. Completed messages remain immutable.

## Deliberate controls

The modal initially focuses **Garder l’ordre actuel**. Cancellation returns focus
to the source occurrence. After a request/reconciliation, focus reaches the
requested destination in the actual draft or its nearest remaining occurrence;
a completed message returns to the message area. Escape first stops active speech;
another Escape dismisses the modal. Only explicit speech reads words.

Pending moves announce **Déplacement en cours…** and prevent editing, cancelling
or repeated submission. Offline previews cannot change/confirm a destination but
can be dismissed. Reconnection never queues a move. Reload/profile navigation
discards local previews and restores only the existing server sequence by ID.
Reopening correction defaults to removal again.

## API and consistency

The existing profile-scoped selection endpoint accepts:

```json
{
  "action": "move",
  "index": 1,
  "target_index": 0,
  "expected_block_ids": ["uuid-for-water", "uuid-for-mother", "uuid-for-book"]
}
```

UUIDs above are placeholders. Both indices are strict zero-based integers in the
provided ordered list of 2–32 UUIDs. The target is the **final** index after taking
out the source: moving 0 to 3 in four touches puts it last. No append `block_id` or
rhythm observation is accepted; other actions cannot use `target_index`.
Unchanged results are rejected rather than generating artificial audit events.

Under the existing PostgreSQL profile/sequence lock, the service compares the
whole expected list, including repetitions, and requires an in-progress draft.
Stale/terminal drafts return HTTP 409 without a move. Successful state and
`sequence_move` audit are atomic; the event retains previous/current selections
and `moved_from_index`/`moved_to_index`. Normal communication/profile permissions
apply. No migration is needed.

Conflicts and ambiguous responses trigger the existing reread, never an automatic
POST replay. A failed reread blocks further writes until explicit reload. Reusing
the same expected list after a committed move fails because the list changed.
Historical rhythm remains a record of append gestures; moves do not rewrite it.
The next local append starts a new timing baseline. No AI, accepted memory,
keyboard position, concept or representation changes accompany a move. Protected
standalone offline copies keep their existing controls.

## Verification

Domain/API checks cover directions, repetitions, reversibility, strict indices,
no-ops, 32 touches, atomic audit, stale replay, foreign/terminal drafts, retained
rhythm and accepted memory. The authenticated communication-only browser scenario
covers local preview/cancel/confirm, mouse/keyboard/focus, Escape speech priority,
held/lost responses, concurrent edit/completion, offline, profile/reload reset,
timing baseline and bounded 320px previews. Existing removal and complete POC
journeys continue in CI. Screenshots contain synthetic data; participant sessions,
screen-reader and real device voice checks remain separate evidence.
