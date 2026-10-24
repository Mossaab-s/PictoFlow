# Add a forgotten pictogram in compact communication

Issue #147 adds **Ajouter une touche ici** to the compact message's local
**Modifier cette touche** dialog. The person selects an exact existing occurrence,
chooses a validated touch from their own keyboard/search, then reviews its
placement before or after that anchor. Existing pictograms keep their relative
order. An empty message uses the ordinary keyboard; insertion supports 1–31
selections and is disabled at32 with an explanation. Other corrections remain
available under their existing limits.

```text
Mother -> Water -> Book -> Water
                             |
Modify touch 4 -> Add here -> choose Mother -> Before / After this Water
                                                     |
Mother -> Water -> Book -> Mother* -> Water <- review / Confirm
```

The flow reuses `MessageInsertDialog`: safe initial **Garder le message actuel**,
personal keyboard/pages and display size, optional word search, candidate drawing
and location, before/after selector and full numbered preview marking the added
occurrence. Returning to the picker preserves its page/search and focus. Adding
the same identity as the anchor is an intentional repetition, not a no-op.

## Explicit changes and preserved memory

Opening, choosing, changing position and cancelling remain local. The existing
touch-editing pause prevents scheduling new automatic formulation during review;
already running work retains its existing stale-result checks. No copy, selection,
feedback or model request is initiated by preview alone.

Only **Confirmer l’ajout** invokes the existing guarded insert action. Its index
is a gap in the captured ordered snapshot, not the anchor index unless inserting
before it. A completed/accepted message first uses the existing idempotent editable
copy; its original sequence and accepted meaning remain intact. An in-progress
message is edited in place. No accepted meaning is created for the edited message.

Cancellation returns focus to the anchor. After submission/reconciliation, focus
reaches the inserted position in the actual message, clamped to its remaining
length, or a safe message-heading fallback. Existing local/parent gates lock
repeated submission, position changes and cancellation while pending. Conflicts
and lost responses trigger the existing reread without replay; an unrecoverable
reread retains the write block until reload. Offline previews can be dismissed
but cannot submit. Reload/profile/view navigation discards local preview state.

Opening touch editing stops current speech. Choosing or inserting never starts
speech. Keep/remove/replace/move, usual phrases and the detailed editor continue
to use their existing contracts. No backend/schema, provider, permission or
keyboard-placement change is introduced.

## Validation and limits

`admin/tests/e2e/compact-touch-insertion.mjs` uses synthetic profiles and an
authenticated communicate-only account. It verifies before/after the exact
repeated anchor, search-state retention, local cancellation without writes,
intentional repetition, one explicit copy preserving accepted source memory,
exact gap payloads, pending/double-submit, lost/conflicting/offline recovery,
anchor/inserted-position focus, single-touch insertion, 31-to32/final-gap guards,
paused automatic formulation and reload/profile reset. It checks unchanged
accepted memory/keyboard/blocks/visuals and tracks model requests and speech
across page navigation.

The journey uploads desktop and 390/320-pixel reviews, a final-place32 capture and
a synthetic report. Existing compact and detailed editing/browser/backend tests
remain enabled. Chromium and instrumented speech do not establish participant
usability, screen-reader behavior or real-device audio; those remain manual
checks. No external model or deployed profile is used by the tests.
