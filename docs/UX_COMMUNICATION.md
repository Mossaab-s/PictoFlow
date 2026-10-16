# Communication-first UX

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
