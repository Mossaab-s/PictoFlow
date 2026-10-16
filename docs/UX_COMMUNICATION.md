# Communication-first UX

Implementation plan: #59, with draft PRs #67-#73 in dependency order. See
[verification and usability-session materials](UX_USABILITY_SESSIONS.md) for the
synthetic journey matrix, evidence limits and pending checks with actual users.

This series improves the existing POC communication journeys. The interface stays
French; issue/PR descriptions and this implementation guide are English.

## Layout (UX-001, #60)

```text
Profile                              More options
Message: [drawing + word] [drawing + word]
Read / undo / clear / finish / new message
Keyboard pages
[drawing + word] [drawing + word] ...
Personal-memory suggestions
More options: display, voice, usual phrases, preparation, offline copy, rhythm
Human review and personal-memory explanation when applicable
```

The message stays near the top while the keyboard is browsed. Long compositions
have a bounded scrollable area; small-height viewports use normal page flow.
Options preserve the current composition and can return focus to their opener.
Choosing a saved phrase opens the secondary tools so the selected phrase is visible.
The shared administration communication view uses the same layout and contracts.
No display change moves saved touches or validates meaning.

`admin/tests/e2e/ux-communication.mjs` checks synthetic desktop, tablet, mobile and
long-message layouts in the isolated PCL browser CI. Actual usability feedback is
still needed; automated checks do not establish suitability for an individual.

## Message actions (UX-002, #61)

**Parler** reads exactly the ordered pictogram words; it does not finish the
sequence or accept an interpretation. Phrase reading targets that phrase's own
button. Stop and Escape interrupt speech. Finishing remains explicit and enables
formulation review. Clear/new-message replacement asks before discarding an
editable draft or leaving an unaccepted review; cancellation preserves the message
and returns focus. Completed messages keep the existing immutable sequence history.

## Personal suggestions and review (UX-003, #62)

The message links to a dedicated suggestions region. Off/Words/Phrases retain
the existing profile-scoped behavior and completed-message prerequisite. The
first three suggestions are shown; More, search and pagination keep the full
pool accessible, including linking words without a drawing. No prefix filter
or AI call is added. Only an existing validated personal representation is used.

A proposal leads to a focused review with explicit acceptance, refusal or a
progressively disclosed correction editor. Reading remains separate from
acceptance. Actor and source details remain available on demand. The optional
AI formulation entry is distinguished from accepted-memory-only suggestions.

## Preferences and keyboard access (UX-004, #63)

Display and local-voice choices are grouped in the secondary tools, with a
non-interactive sample of an existing touch. The current per-profile/browser
settings and stable-anchor grid contract are reused. Escape closes options and
returns focus when it is not being used to stop speech. A floating Stop remains
reachable during reading; short viewports and keyboard navigation avoid a sticky
message obscuring focus. Late selection responses do not reclaim another control's
focus. Existing skip links remain available at the first Tab.

Browser checks cover persisted size/contrast, narrow large-touch reflow, forced
colors and reduced-motion preferences. Manual screen-reader and actual browser
zoom checks remain to be recorded with the UX evaluation guide; no full
accessibility certification is claimed.

## Preparation and preview (UX-005, #64)

The keyboard editor has direct links to prepare, review, organize and preview.
New proposals appear immediately after the creation form, before page management.
The communication preview uses only validated content and the existing per-profile
size/contrast. It shares the live keyboard renderer, including personal photos,
saved gaps, page order and stable geometry. Page navigation in the preview changes
only its local view; touches are non-interactive and create no sequence or speech.
The separate explicit communication link opens the actual route. Existing access
controls, representation changes, placement review and missing-word return remain.

## Connection and recovery (UX-006, #65)

An offline network hint explains what can still be read locally and links to an
already prepared protected copy. It does not claim the server is reachable and
never sends on reconnect. Displayed words can still be spoken with a local voice.
If a failed write cannot be reconciled by reading its server sequence, further
writes are blocked until an explicit reload rather than guessing the committed
state. The current server/local draft split and protected import remain intact.

The header has a direct usual-phrases entry; opening it does not replace the
composition or accept a meaning. Empty personal memory offers an explicit path
back to the normal formulation workflow without calling AI. On the dedicated
communication route the existing account/logout controls are collapsed under
Mon compte; authentication, access checks and cleanup behavior are unchanged.
