# Accepted personal phrases in compact communication

Issue #141 adds **Mes phrases** beside **Options** in the compact communication
header. A person can reuse a phrase already accepted in their own profile without
switching to the detailed tools or replacing the current pictogram composition.

```text
Pictogram composition -> Mes phrases -> shortcuts / all accepted phrases
        |                                    |
    kept intact                       search -> select -> review
        |                                    |
        |                            deliberate Read -> current PCL check
        |                                    |
        +----------- Return to message ------+
```

The dialog reuses `PhraseLibrary`, its profile-scoped reads, six-card pagination,
corrected-text precedence and original pictograms with their current validated
visuals. It opens with explicitly chosen shortcuts. **Toutes mes phrases
acceptées** includes the other accepted phrases. Proposed or refused meanings
are excluded. A phrase is fetched again when selected and before each explicit
reading: a changed text requires another review/read, and a refused or unavailable
phrase cannot be read through this path.

The compact presentation hides the role selector and shortcut-management actions.
Detailed tools retain those controls and their existing permissions. Browsing,
choosing and reading use GET requests; they do not add a sequence, validate an
interpretation, modify a shortcut or train the PCL. The active draft's identity,
touch order and repetitions remain intact. Neither selecting nor opening a phrase
starts speech. No browser phrase cache is introduced.

New automatic formulation is paused while the dialog is open. An already running
request is allowed to settle under the existing stale-result checks; opening the
dialog does not cancel server work or replay it. Closing restores the usual
scheduling for an unattempted selection. A previously attempted selection does
not gain an automatic retry merely because the dialog closed.

The dialog uses native modal behavior, an initially focused heading, internal
scrolling and a sticky return/stop area. Escape first stops active speech and a
later Escape closes. Closing stops speech, unmounts the library, aborts pending
reads and restores focus to **Mes phrases** (or the message heading if necessary).
Search and chosen-phrase state are discarded on closing or changing profile.
Loading/read failures allow returning to the message. Without a connection, the
dialog explains why current acceptance cannot be checked; literal pictogram
communication remains available in the message.

## Validation and limits

`admin/tests/e2e/compact-personal-phrases.mjs` uses a disposable authenticated API,
a communicate-only account and synthetic profiles. It covers shortcuts, accepted
versus proposed/refused phrases, corrected text, changing/revoking a phrase before
speech, drawings, retained repetitions and draft identity, no browsing writes or
model requests, slow-read cancellation, failed-load recovery, profile reset,
empty/offline states and suspension across the automatic-preview delay.

The same journey captures 1280, 390 and 320-pixel layouts and checks horizontal
reflow. Its report and screenshots are uploaded in `synthetic-pcl-learning`.
Existing detailed phrase, full communication, offline and capability journeys
remain in CI. These checks use a synthetic local speech engine; actual device
audio, broader browser/screen-reader use and participant usability need separate
manual evaluation. No deployed profile is changed by these tests.
