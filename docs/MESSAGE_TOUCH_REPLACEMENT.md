# Replace one occurrence in a draft message

**Corriger une touche > Remplacer une touche** lets a communicator change one
chosen occurrence without reconstructing the rest of the message. Removal
remains the default operation. Replacement works with 1–32 selections.

The compact communication screen also exposes replacement directly by tapping
the chosen message pictogram. See
[COMPACT_TOUCH_REPLACEMENT.md](COMPACT_TOUCH_REPLACEMENT.md) for its local choice
dialog, automatic-preview pause and completed-snapshot copy behavior.

```text
Current:  [Mother] [Water] [Book] [Water]
                     |
          choose Water, touch 2 of 4
                     |
          browse my keyboard pages and pictures
          or optionally search the displayed word
                     |
Review:      Before            After
             [Water]           [Book]
          [Keep current touch] [Confirm replacement]
                     |
Result:   [Mother] [Book] [Book] [Water]
```

The picker reuses the person's current touch size, drawings/photos, words and
keyboard pages. It offers only validated touches available in that profile's
loaded keyboard. It does not open the global catalogue or ask AI for a word.
Identical words belonging to distinct touches remain distinct; the review shows
the destination touch's page and position. Choosing the same identity disables
confirmation. Other occurrences, their order and message length are preserved.

## Deliberate review and recovery

Choosing a picture or search result opens a local before/after review, without
writing anything. **Choisir une autre touche** returns to the same picker page,
search and selected button. **Garder la touche actuelle** dismisses the entire
preview. The main communication keyboard's page is independent of the picker.

The native dialog initially focuses the safe Keep action. Review focuses its
heading; cancellation and completed requests return to the exact occurrence or
nearest remaining touch. Escape first stops active speech; a subsequent Escape
dismisses the dialog. Only the explicit speech action reads the message.

Pending requests disable confirmation, choosing another touch and cancellation.
Offline previews cannot submit but can be dismissed. Reconnection queues no
replacement. Reload or profile navigation discards local preview state.
Conflicts and ambiguous network responses reread the existing sequence by ID;
they never automatically replay the POST. An unsuccessful reread blocks writes
until explicit reload, following existing communication recovery behavior.

## Selection API

`POST /api/v1/profiles/{profile_id}/sequences/{sequence_id}/selection` accepts:

```json
{
  "action": "replace",
  "block_id": "uuid-for-book",
  "index": 1,
  "expected_block_ids": ["uuid-for-mother", "uuid-for-water", "uuid-for-book", "uuid-for-water"]
}
```

UUIDs above are placeholders. `index` is a strict zero-based integer within the
provided ordered snapshot of 1–32 UUIDs. The replacement must be a different,
validated block belonging to this profile. Other profiles' blocks are not found;
nonvalidated blocks and unchanged replacements cannot be selected. No
`target_index` or append rhythm observation is accepted.

The transaction uses the existing profile/sequence lock and compares the whole
ordered snapshot, including repetitions. Stale or terminal drafts return 409
without replacement. A successful update and its `sequence_replace` audit are
atomic; the event stores previous/current selections and `replaced_index`.
Existing communication permissions apply. No migration is required.

The operation edits only the draft. Accepted phrases, personal memory, keyboard
placement, concepts and representations remain unchanged. Historical selection
rhythm remains a record of append gestures. The next local append starts a new
timing baseline so correction time is not mistaken for a selection interval.
Standalone protected offline copies retain their existing controls.

## Verification

Domain/request and real PostgreSQL/API checks cover exact repeated occurrences,
strict indices, no-ops, scope, nonvalidated blocks, full-snapshot conflicts,
terminal drafts, atomic audit and unchanged memory/rhythm. An authenticated
communication-only browser scenario checks keyboard/mouse, local picture and
word review, equal labels on different pages, preserved picker state, cancellation,
focus, speech priority, pending/lost/stale responses, offline and profile/reload
reset, and single/full/terminal drafts. Synthetic 320px captures complement the
existing removal, ordering and complete POC journeys in CI. Actual participant,
screen-reader and device voice sessions remain separate evidence.
