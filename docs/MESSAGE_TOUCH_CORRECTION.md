# Correct one touch in a draft message

Correction also supports [moving](MESSAGE_TOUCH_ORDER.md) and
[replacing a chosen touch](MESSAGE_TOUCH_REPLACEMENT.md) after explicit review.

An in-progress, nonempty message offers **Corriger une touche**. This optional
mode turns the existing message pictures and words into buttons with explicit
occurrence numbers. The person chooses one occurrence, sees its picture/photo,
word and position again, and decides **Garder cette touche** or **Oui, retirer
cette touche**. Nothing is removed by opening correction or choosing a word.

```text
[Mother] [Water] [Book] [Water]     [Correct one touch]
            |
    Touch 2 of 4: Water
    [Keep] [Yes, remove this touch]
            |
[Mother] [Book] [Water]
```

The remaining touches retain their order and repetitions. Removing the final
touch leaves an empty draft, which cannot be completed until another touch is
chosen. Removing a touch from a full 32-touch draft frees one place. Completed
messages offer no correction control. This action does not change the keyboard,
personal concepts, accepted interpretations or stored reference phrases, and
does not call AI or start speech. The protected standalone offline copy keeps
its existing controls; this increment applies to the online communication screen.

The later [move-a-touch journey](MESSAGE_TOUCH_ORDER.md) adds an optional order
operation inside correction. Removal remains the default and retains the
confirmation and recovery behavior described here.

## Deliberate controls and recovery

Opening focuses the first occurrence. The confirmation initially focuses the
safe **Garder** action. Cancellation returns to the selected occurrence; after
removal, focus goes to the occurrence now at that position, the previous one at
the end, or the empty message area. **Finir la correction** or Escape outside the
dialog returns to the correction opener. Escape inside the dialog cancels the
selection. While speech is active the existing first-Escape-to-stop rule takes
priority. All controls support mouse, Enter and Space; the message scroller
keeps long compositions bounded. The online message panel now consistently
follows normal document flow. Its former sticky/non-sticky switch on keyboard
focus could move controls between pointer down and click, losing a selection or
the deliberate **Parler** action when alternating keyboard and mouse. Keeping
geometry independent of focus also prevents the enlarged message toolbar from
covering input targets. Existing jump links still reach message and keyboard.

Selection and confirmation are disabled while the current state is loading,
unavailable, offline or being saved. A pending save displays **Retrait en cours…**
inside the dialog and cannot be cancelled halfway through. An offline dialog can
still be dismissed, and correction can be closed.
No removal is queued for reconnection. Correction mode and the dialog are local
to the mounted message/profile and reset after reload; only the existing sequence
identifier is stored for server restoration.

## API and persistence

The existing profile-scoped selection endpoint accepts:

```json
{
  "action": "remove",
  "index": 1,
  "expected_block_ids": ["uuid-for-mother", "uuid-for-water", "uuid-for-book"]
}
```

The example UUID strings are placeholders. `index` is a strict zero-based integer
from 0 to 31 and must address an entry in the provided list of 1–32 UUIDs. Removal
does not accept a `block_id` or rhythm observation. Other actions do not accept
the new index/list fields. Existing append, undo, clear, complete and cancel
contracts remain available.

Inside the existing PostgreSQL profile/sequence transaction lock, the service
requires an in-progress message and compares the **whole ordered list**, including
all repetitions, before removing exactly one index. A changed or terminal draft
returns HTTP 409 without writing or auditing a removal. Cross-profile IDs remain
inaccessible. A successful transition and its `sequence_remove` audit event are
atomic; the event retains previous/current selections and the removed index.
No schema migration is needed.

A stale response reloads the actual message and asks the person to check their
choice again. An ambiguous network failure also rereads the known sequence;
the client never replays the POST. If recovery itself fails, the existing reload
guard prevents further edits. Retrying the same removal after a committed result
is rejected because the expected list no longer matches.

Optional rhythm observations remain historical records of actual append gestures,
including touches later undone or removed. Removing does not erase or synthesize
observations, and resets the local baseline so the next append does not measure
the time spent correcting as a selection interval. No emotional inference or
new timing field is sent to the model.

## Validation

Domain and request checks cover repeated occurrences, strict index bounds,
empty drafts and terminal states. Real PostgreSQL/API checks cover full-list
comparison, stale retry, foreign profile, atomic audit, retained observations,
and unchanged accepted memory. The authenticated browser scenario uses a
communication-only account and synthetic vocabulary, covering keyboard/mouse,
cancel/Escape/focus, committed-but-lost responses, another device's edit or
completion, offline dismissal without queued writes, empty/full drafts, reload,
profile changes, and a 320px confirmation screenshot. The existing complete
communication and preparation journeys continue in the same CI workflow.

These automated checks do not establish ease of use for an actual communicator;
participant sessions, screen readers and device voices remain separate checks.
