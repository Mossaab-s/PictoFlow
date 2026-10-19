# Choose a free keyboard place visually

Opening a validated touch in the [touch library](KEYBOARD_TOUCH_LIBRARY.md) now
shows a destination selector below its zone, page and numeric place fields.
The supporter can choose a free case by looking at its neighbouring drawings
and words. The case number is still available for precise or distant placement.

```text
Page: Activities                    Zone: My touches

  [1: FREE] [2: Drink - occupied] [3: FREE] [4: FREE]
                                     |
                                     +-> local place = 3
                                           |
                          [Preview move] -> [Confirm move]
```

Choosing a case updates only the local destination. The selected free case shows
the touch's drawing and word as a placement preview, while any current case is
explicitly marked **Place actuelle**. This does not create a second touch.
Other occupied cases remain visible and disabled. Positions whose validated
touch is unavailable remain reserved as **Indisponible**; missing metadata never
makes a reserved place appear free. The selector uses only the current profile's
touches, positions and representations.

## Ranges, pages and spatial landmarks

The selector follows the profile's existing display preference: 12, 6 or 4 cases
per range, with the same column counts and narrow-screen column changes as the
communication grid. Stable anchors always retain the standard 12-case display
and remain global, regardless of the selected page or display preference. The
cards are compact previews; use the existing full keyboard preview to inspect
the communication interface at its actual display size.

**Places précédentes** and **Places suivantes** browse without changing the
chosen number. The chosen destination remains written below the grid, including
when it is outside the visible range. **Revenir à la place choisie** returns to
that range. Typing a valid number selects its range directly. The final range
stops at place 1000, the existing numeric editor limit. Positions outside that
editor limit are not renumbered or changed; their saved location remains in the
touch card's summary.

Selecting another page or zone resets range browsing for that destination, while
retaining the chosen numeric place. It never silently picks another free place.
Empty cases, gaps and occupied coordinates are not compressed or sorted. A
candidate placed in a personal zone does not occupy a case in the separate
stable zone, or a case with the same number on another named page.

## Saving and conflicts

The existing APIs and permissions remain authoritative. Non-stable moves within
the same zone require a server preview and explicit confirmation. Existing zone
changes retain their explicit placement action. All selector and range buttons
are non-submitting buttons: neither mouse selection nor keyboard activation
saves the form, speaks, composes a message, calls AI or accepts personal memory.
Changing the selected case clears an existing move preview.

An occupied case cannot be selected in the grid. Numeric entry retains its
existing server validation; an occupied numeric destination is explained locally
and rejected if submitted. If another preparer occupies a locally free case
before preview, the server rejects it and the refreshed grid shows the new
occupant. The chosen number is retained for inspection. A stale preview remains
subject to the existing server conflict checks. Writes are never retried
automatically. Cancelling a preview saves nothing.

The selector is part of the existing profile-keyed library: leaving the profile
clears local placement drafts. It introduces no new browser storage; it reads
the existing profile-scoped display preference.

## Verification

Unit checks cover profile-scoped occupancy, reserved unavailable touches, page
and zone independence, unchanged gaps, offscreen selections, range boundaries
and all display sizes. The authenticated browser scenario uses a preparation-only
account with real profile APIs and checks keyboard selection, numeric access to
place 1000, range browsing without writes, global anchors, a second preparer's
concurrent move, explicit preview/cancel/confirm, unchanged memory and neighbouring
positions, profile reset and a 320px layout. Screenshots contain synthetic data.
These checks complement, and do not replace, usability testing with actual users.
