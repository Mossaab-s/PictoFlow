# Find a personal touch while communicating

**Retrouver une touche**, beside the communication keyboard, opens an optional
local search. The communicator can type part of a displayed word, inspect its
drawing or photo and choose it for the current message. The normal keyboard stays
mounted below the search: its selected page, range, positions and stable anchors
are retained.

```text
Current message: [Mother] [Drink]

[Find a touch]
   [Search my word: water_______] [Clear] [Close]

   [drawing]                 [drawing]
   Water                     Water
   Needs / place 3           Outings / place 5
          |                         |
          +------ explicit choice --+
                          |
                 append that touch once

Regular keyboard below: same page, same positions
```

## Scope and presentation

Lookup searches the words displayed on validated touches available in the loaded
keyboard for the current profile. Every search term must match, ignoring case,
accents and `œ`. It does not search catalogue synonyms, hidden personal meanings,
reference phrases or another profile's vocabulary. It does not call AI or create
missing words. Unknown, archived or foreign pages and invalid touch identities
are excluded; representation ownership is checked before rendering.

An empty query does not list the whole keyboard. Results preserve keyboard input
order and are paginated in the current display size. Duplicate input identities
are shown once, while distinct touches with the same displayed word remain
separate. Their page, zone and one-based place are visible and associated with
the button's accessible description. A stable anchor says **Toutes les pages**.

Opening, typing, clearing, paging and closing do not select a touch or write to
the PCL. Changing the query resets the result range. The query is local component
state: closing the search or changing profile clears it. No new URL parameter,
browser storage, audit field or memory entry is introduced. Normal image loading
can still read the profile's existing protected photos.

## Selection, focus and recovery

Clicking a result, or activating its button with Enter/Space, uses the same
selection handler as the normal keyboard. It appends that exact touch once and
keeps the query/results available for deliberate repetition. Typing Enter in the
search field does not choose the first result. Only **Parler** starts speech.

The search field receives focus on opening. Closing returns focus to its opener;
clearing returns focus to the field. Pagination keeps a usable navigation button
focused at range boundaries. A completed selection retains the result's focus
unless the person has already moved elsewhere. Escape first stops active speech
through the existing communication handler; a subsequent Escape closes search.
The message panel follows normal document flow, consistently with the later
[message correction journey](MESSAGE_TOUCH_CORRECTION.md), so it cannot cover
the search controls on small screens.

Pending actions, network disconnection, a completed message and the 32-touch limit
disable result selection just as they disable the normal keyboard. Local lookup
and closing remain available. No selection is queued for reconnection. A lost
response after appending to an existing sequence uses the existing server
reconciliation; search does not replay the POST. Undo, completion, human phrase
review and optional selection observations retain their existing contracts.
Standalone protected offline copies remain a separate journey.

## Validation

### Reliable result focus after async selection

Search owns result focus in both the compact and detailed communication views.
The detailed screen no longer runs its competing generic message-heading
fallback for a search selection; the regular keyboard keeps its existing handling.

The old one-frame callback could run while the result button was still disabled
and never try again after React enabled it. The temporary selection-focus intent
now waits for both operation settlement and a usable button. It observes only the
button's `disabled` attribute when the first frame is too early, with no polling,
selection retry, API call or stored focus state. This reproduces a problematic
ordering; it does not reconstruct the exact ordering of the historical CI failure.

Restoration is cancelled if focus moves to another control, a pointer is used
outside the result, Tab/Escape is pressed, or the document/window becomes inactive.
It stays cancelled even if focus later returns to the document body. A disabled
button naturally leaving focus on the body alone does not count as navigation.
New selections supersede old intents. Layout cleanup cancels pending restoration
when profile, result identities, page, display size or selection purpose changes,
or when search/results unmount. Detached buttons cannot regain focus. Listeners,
the observer and any scheduled frame are released on completion or cancellation.

`node tests/e2e/selection-focus.mjs` runs eight deterministic cases in native
Chromium, transpiling the actual production helper into a routed synthetic page.
It starts no Next server and calls no API. The first case fails with the extracted
old single-frame strategy and passes with delayed enabled-state observation.
The remaining cases cover settlement order, intentional focus/pointer/keyboard
navigation, cancelled/replaced scopes and superseding selections. Its JSON report
is uploaded with the existing `synthetic-pcl-learning` CI artifact. The authenticated
communication-search journey continues to test consecutive Enter selections,
intentional focus movement during a delayed response, profile changes, unchanged
memory/keyboard and exact selection writes against the real application.

### Existing lookup coverage

Unit checks cover displayed-word matching, profile/status/page scoping, identity
deduplication, duplicate labels, accent handling and image ownership. The real
authenticated browser/API scenario uses communication-only grants and synthetic
vocabulary. It verifies no writes while looking up, preserved page/range state,
ordered repeated selections, explicit speech, Escape priority, lost-response
reconciliation without replay, delayed-selection focus, offline/completed/32-touch
guards, profile reset, unchanged keyboard/memory and a 320px viewport. Existing
communication, preparation and complete POC scenarios remain in the same workflow.
These checks do not replace usability sessions with actual communicators.
