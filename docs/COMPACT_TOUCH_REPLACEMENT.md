# Replace a pictogram in compact communication

Issue #143 adds replacement to the current-message pictograms in the simplified
communication screen. Tapping a pictogram now opens **Modifier cette touche**,
showing its drawing, word and exact occurrence. **Garder cette touche** is the
initially focused safe action. Deliberate removal remains available; **Remplacer
cette touche** opens the existing replacement picker and before/after review.

```text
Mother -> Water -> Book -> Water
           |
       Modify touch 2
           |
        Replace -> own keyboard/search -> Before Water / After Book
                                               |
                                       explicit confirmation
                                               |
Mother -> Book -> Book -> Water <---------------+
```

The picker uses the profile's currently validated touches, drawings/photos,
display size and personal pages. Search and choosing another candidate keep the
shared picker behavior. Selecting a candidate is local; the person must confirm
the review. Choosing the same identity cannot be confirmed. Message length,
every other occurrence and their order are retained, including at 32 selections.

## Completed snapshots and personal memory

The compact screen may already have sealed a message for automatic formulation.
The existing `editableCurrent` path creates an independent, idempotent copy only
after explicit edit confirmation. The replacement is submitted against that copy
with its full ordered snapshot. The original completed sequence, interpretations
and accepted personal memory remain intact. Neither copying nor replacement
accepts a meaning for the edited message. An in-progress message is edited in
place through the same existing snapshot-checked selection API.

Opening, browsing, keeping or cancelling creates no copy, selection, feedback or
formulation request. New automatic formulation is paused while a touch dialog is
open, using the existing readiness condition without clearing its attempted-call
guard. Already running requests settle under existing stale-result checks.
After closing, normal scheduling can resume for an unattempted selection.

Opening the touch editor stops current speech. No speech is started by choosing
or applying a replacement. Submission has a local double-submit gate and uses
the existing parent operation lock. Cancellation is blocked during submission;
after settlement, cancellation or reconciliation, focus returns to the same
occurrence or the nearest remaining touch. An unavailable target falls back to
the message heading. The shared dialog retains Escape speech priority.

An offline preview can be dismissed but cannot submit. Conflicts or lost edit
responses use the existing sequence reread without replaying the POST. The
existing copy-recovery identity handles ambiguous copy responses. A failed
reread continues to block writes until reload. Reload, profile navigation and
switching to detailed tools discard local preview state. No migration, provider,
permission, keyboard placement or personal-meaning change is introduced.

## Evidence and manual limits

`admin/tests/e2e/compact-touch-replacement.mjs` runs with a synthetic authenticated
communicate-only account. It covers exact repeated occurrences, safe initial
focus, local search/review/cancellation without writes, same-touch prevention,
one explicit copy preserving an accepted snapshot, pending lock/double-submit,
lost-response and conflict recovery, offline cancellation, retained removal,
32-touch replacement, automatic-preview suspension and profile/reload reset.
It checks exact request payloads, IDs, ordered selections and unchanged accepted
memory/keyboard/blocks/visuals, and captures 1280/390/320-pixel reviews.

Existing detailed replacement, compact communication, usual phrases, editing,
capability and backend invariant tests remain in CI. Synthetic speech and
Chromium layout checks do not establish real-device audio, screen-reader use or
participant usability; those still need manual evaluation. Tests do not touch
deployed profiles or call an external model.
