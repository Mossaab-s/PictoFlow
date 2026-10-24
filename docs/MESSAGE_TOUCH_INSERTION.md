# Insert a forgotten touch in a draft

**Corriger une touche > Insérer une touche** adds a personal picture/photo and
word near a chosen occurrence. Existing words stay in their relative order.
Removal remains the default correction; an empty draft uses the ordinary keyboard.

Compact communication also exposes this picker/review by tapping a message
pictogram and choosing **Ajouter une touche ici**. See
[COMPACT_TOUCH_INSERTION.md](COMPACT_TOUCH_INSERTION.md) for its snapshot/copy and
automatic-preview safeguards.

```text
Current: [Mother] [Water] [Book] [Water]
                                  |
                  choose Water, touch 4 of 4
                  choose Mother from my keyboard
                  position: Before / After touch 4
                                  |
Preview: [Mother] [Water] [Book] [Mother*] [Water]
         * added at place 4
         [Keep current message] [Confirm addition]
```

The person chooses an exact numbered occurrence, browses their own validated
keyboard pages or optionally searches displayed words, then reviews the full
message. The selected new touch is marked **ajoutée** in the ordered preview.
**Ajouter la touche** offers before/after that specific anchor. This reaches the
first and last gaps as well as the middle, without dragging or retyping words.
Repeating the same touch is valid. Distinct touches with equal displayed words
keep their identities and their page/position descriptions.

## Review, access and recovery

Opening, choosing, changing position and choosing another touch are local until
**Confirmer l’ajout**. Returning to the picker preserves page, query and focus;
the main keyboard page is independent. The dialog initially focuses **Garder
le message actuel** and the review focuses its heading. Keep/Escape dismisses
without a write. The first Escape stops active speech before dismissing a dialog.
Speech remains an explicit action.

After submission/reconciliation, focus returns to the inserted position or the
nearest actual remaining touch. If the draft reached 32 selections, insertion
is disabled and correction returns to removal; replacement/moving remain usable.
The added occurrence stays visible inside a bounded scrolling preview even at
place 32. This does not scroll the outer page or move focus to the preview.

Pending requests prevent duplicate submission, position changes and cancellation.
Offline previews cannot submit but can be dismissed. Reconnecting never queues
a write. Profile navigation and reload discard local preview state. A conflict
or ambiguous response rereads the known sequence ID without replaying the POST.
Failed reconciliation retains the existing write block until explicit reload.

## API contract

The profile-scoped selection endpoint accepts:

```json
{
  "action": "insert",
  "block_id": "uuid-for-mother",
  "index": 3,
  "expected_block_ids": ["uuid-for-mother", "uuid-for-water", "uuid-for-book", "uuid-for-water"]
}
```

UUIDs above are placeholders. `index` is a strict zero-based **gap** in the
expected ordered draft: 0 inserts before the first occurrence, and the draft's
length inserts after the last. The expected draft must contain 1–31 UUIDs;
the result contains at most 32 selections. `block_id` must identify a validated
block owned by this profile. Inserting the same identity again is permitted.
`target_index` and rhythm observations are not accepted for insertion.

The service checks the whole ordered draft, including repetitions, inside the
existing profile/sequence transaction lock. Stale and terminal drafts return
409 without insertion. A foreign block is not found, and nonvalidated blocks
cannot be inserted. The state update and `sequence_insert` audit are atomic;
the event includes previous/current lists and `inserted_index`. Existing profile
and communication permissions apply. No migration is required.

No model is called and no accepted meaning is created. Accepted phrases, personal
memory, keyboard placements, concepts and representations remain unchanged.
Historical rhythm continues to describe append gestures; insertion does not
invent or erase observations. The next local append starts a new timing baseline.
Protected standalone offline copies retain their existing controls.

## Evidence

Domain/request tests cover all gaps, repetitions, strict bounds and limits. Real
PostgreSQL/API tests cover atomic audit, scope, nonvalidated choices, exact-list
conflicts, terminal states and unchanged resources/rhythm. The authenticated
communication-only browser scenario covers local review, keyboard/mouse, before
and after repeated anchors, lookup/page state, same-identity repetitions, pending
and lost responses, stale edits/completion, offline dismissal, profile/reload
reset, single/full messages and a synthetic 320px long preview. Existing removal,
ordering, replacement and complete POC journeys remain in the CI workflow.
Participant, screen-reader and actual device voice checks remain separate work.
