# Reorder a pictogram in compact communication

Issue #145 exposes **Déplacer cette touche** in the compact message's local
**Modifier cette touche** dialog. It is available with at least two selections,
including at the 32-touch limit. It reuses `MessageMoveDialog` and the existing
snapshot-checked move API; the detailed editor keeps its existing behavior.

```text
Mother -> Water -> Book -> Water
   |
Modify touch 1 -> Move -> Place 3 -> review numbered pictograms -> Confirm
                                                                    |
Water -> Book -> Mother -> Water <-----------------------------------+
```

The dialog identifies the exact source occurrence and initially focuses
**Garder l’ordre actuel**. The person can choose a numbered destination or step
one place before/after without dragging. Its full-message preview retains words,
drawings/photos and repetitions, marking the chosen occurrence. Long previews
scroll internally to keep that occurrence visible. An unchanged ordered ID list,
including swapping adjacent indistinguishable repetitions, cannot be confirmed.

The compact touch editor captures an ordered word/ID snapshot when opened and
keeps its existing automatic-formulation pause. Opening, changing destination,
reviewing or cancelling produces no selection, copy, formulation or feedback
request. Only **Confirmer cet ordre** submits the existing guarded move action.
The target index is the final position after removing the source occurrence.

An in-progress message is edited in place. A completed or accepted snapshot uses
the existing idempotent editable-copy path on explicit confirmation, then moves
inside that copy. The source sequence, its accepted meaning, personal memory and
keyboard placements remain intact. Moving the copy never accepts its meaning.

Cancellation returns focus to the source occurrence. After submission or
reconciliation, focus returns to the requested destination in the actual message,
clamped to the nearest remaining touch; an unavailable touch falls back to the
message heading. Pending moves block destination changes, duplicate submission
and cancellation. Conflicts and lost responses use the existing parent reread
without replay. Offline previews can be dismissed but cannot submit. Reload,
profile changes and switching views discard local previews.

Keep/remove/replace and usual phrases remain available as before. This step adds
no schema, permission, provider or backend contract. It does not rearrange the
person's keyboard. New speech remains explicit; opening touch editing stops
current speech, and the shared dialog retains Escape speech priority.

## Validation and limits

`admin/tests/e2e/compact-touch-order.mjs` uses synthetic profiles and a
communicate-only authenticated account. It verifies local numbered preview and
cancellation without writes, one explicit copy preserving the accepted original,
exact move payloads, destination focus, pending/double-submit guards,
lost/conflicting response recovery without replay, offline dismissal, single and
32-touch guards, identical-repeat no-ops, final-position visibility, paused
automatic formulation and reload/profile reset. It asserts unchanged accepted
memory, keyboard, blocks and representations, and no model or speech requests.

The browser journey uploads desktop and 390/320-pixel previews plus a full-message
last-position capture/report in `synthetic-pcl-learning`. Existing compact
replacement/removal/phrases, detailed move, other editing and backend invariant
checks stay enabled. Synthetic Chromium and speech instrumentation do not
establish participant usability, screen-reader behavior or actual device audio;
those remain manual evaluation. No deployed profile is used by these tests.
