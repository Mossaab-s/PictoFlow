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

The message sits above the keyboard in normal document flow. Long compositions
have a bounded scrollable area; jump links reach message and keyboard directly.
Its position does not switch with input focus: this prevents controls from moving
under a mouse click when alternating keyboard and mouse or returning to Parler.
Options preserve the current composition and can return focus to their opener.
Choosing a saved phrase opens its own phrase area so the selected phrase is visible,
without opening display/voice/preparation tools.
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
reachable during reading; the message follows page flow without covering focused
controls. Late selection responses do not reclaim another control's
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
The completed message returns to normal page flow so its toolbar cannot cover
the suggestion and review controls; editable compositions retain the bounded toolbar.
Dynamic suggestion results are excluded from browser scroll anchoring so that
search updates do not move controls during pointer activation. Keyboard focus
remains visible and follows the existing tab order.

Pointer activation in personal-memory suggestions focuses the visible button
without native focus scrolling before mouseup. The outage browser check splits
press and release and verifies stable button position, a real click and the
injected unavailable response. Keyboard activation retains its usual behavior.

The header has a direct usual-phrases entry; opening it does not replace the
composition or accept a meaning. Empty personal memory offers an explicit path
back to the normal formulation workflow without calling AI. On the dedicated
communication route the existing account/logout controls are collapsed under
Mon compte; authentication, access checks and cleanup behavior are unchanged.

## Focused communication surface after three-space navigation

The existing communication controller, endpoints, profile preferences and draft
references are preserved. Only disclosure and visual order change:

```text
Name                        Options | My phrases
Message and explicit speech / undo / clear / finish actions
Personal pictogram keyboard (saved pages, gaps and stable positions)
Missing-word preparation link when authorized
Usual phrases                 [closed until requested]
Personal-memory suggestions    [closed when off; saved active mode opens]
Optional formulation / human review when applicable
What my memory retains        [closed until requested]
Voice, display and preparation [closed until requested]
```

The message's Suggestions link opens the native suggestions disclosure and focuses
its summary. Word/phrase/off behavior and the completed-message prerequisite are
unchanged. Closing it preserves the selected mode, search and tentative word list;
Escape and the close button return focus to the opener. The header's My phrases
button opens/focuses the existing phrase picker independently of the settings area.
Escape closes the picker and returns to that button. Reading a saved phrase still
requires its own explicit action and leaves the composed message intact.

The finished message now offers formulation/review before the longer PCL learning
explanation. Context remains optional in a separate disclosure; its existing value
and request contract are preserved. The memory explanation, evidence, explicit
replay and exact prior-message recall remain available behind **Ce que ma mémoire
retient**. Its open state survives an intentional replay within the current view,
but resets on a page reload. The interpretation card still displays the accepted,
corrected or refused status. Opening/closing a panel never accepts a proposition.

Native disclosure descendants remain mounted: temporary input, chosen phrases and
word drafts are not discarded on close. Existing read-only memory loading still
runs; collapsing is presentation, not a new access or request boundary. Escape
first stops active speech; a later Escape can close the focused panel. An open
secondary area keeps the same normal-flow composer so it cannot obscure focused controls.

Browser checks exercise initial compactness, direct phrases without settings,
suggestion mode preservation, keyboard open/close/focus, the completed-message
order and unchanged server sequences, positions and validated memory. Existing
PCL learning, suggestion revocation/retry, optional AI, offline and account journeys
also run. This increment adds no backend policy, PCL mutation, model-prompt change
or protected accompanied-session behavior.
