# Communication UX: verification and usability sessions

This is the evaluation plan for #66, following #60-#65. The application remains a
functional POC. The French interface is intentional; public planning is English.

## What automated checks establish

The isolated PostgreSQL/browser workflow uses fictitious profiles. It covers:

| Journey | Evidence |
| --- | --- |
| Open and communicate | Desktop 1280x800, tablet 768x1024, mobile 390x844; first keyboard row visible |
| Long composition | Repeated touches, bounded message, 320 CSS pixel reflow |
| Deliberate speech | Synthetic local voice; exact selected words, phrase-specific reading, Stop/Escape |
| Message replacement | Cancel/confirm clear and new message; canceled draft preserved |
| Personal suggestions | Three-card preview, full word pool, text-only words, corrected accepted phrases, human decisions |
| Preparation | Existing missing-word return; validated-only preview, current size/contrast, local page navigation |
| Preferences and focus | Persisted settings, forced colors, reduced motion, no focus theft after a delayed selection |
| Failure and recovery | Failed selection/reconciliation, explicit reload, no reconnect POST, existing protected offline reopen and idempotent import |
| Account affordances | Mocked authenticated frontend session: compact account entry, communication-only preparation denial |
| Optional formulation | Real fixture-driven FakeProvider through the API and browser, reading/refusal/acceptance |

The mocked frontend session does **not** establish authentication or API access
security. Existing real backend account/profile-isolation tests cover those
boundaries. Speech is a deterministic test adapter, not evidence that a particular
device has a usable installed voice.

The later three-space increments also add real authenticated browser scenarios
for grants, role entry, supporter review, accompanied sessions, memory evolution,
vocabulary needs and administration. The [complete-journey validation](POC_COMPLETE_JOURNEY.md)
connects UI preparation, six-touch communication, explicit review and later
personal-memory reuse with separate accounts and a structured CI report. These
automated results remain separate from the participant observations below.

`tests/ux_fake_application.py` is a separate loopback-only CI adapter guarded by
`PICTOFLOW_UX_TESTING=1`. It configures an exact fixture from a completed synthetic
sequence. Normal application entry points and server Docker images do not import
or include it. No external provider or credentials are needed.

## Actual usability sessions: pending

The maintainer arranges sessions with communicators and, when useful, their
supporters. No sessions, recruitment or participant feedback are claimed by this
delivery. Check whether the person wants to participate and can pause or stop.
Use familiar vocabulary chosen with them; the intended meaning belongs to them.

Record build/PR, device, viewport, input method, chosen touch size/contrast and
local voice availability before starting. Test a harmless sound example together.
Use fictitious content for public screenshots and issue attachments.

### Suggested sequence

1. **Find the keyboard.** Open the person's authorized profile. Ask where they
   would start communicating; observe whether settings distract them.
2. **Compose and speak.** Let the person choose a message with 3-6 pictograms.
   Ask them to make it heard, stop, repeat a word and undo one selection.
   Try [correcting a chosen occurrence](MESSAGE_TOUCH_CORRECTION.md) in the middle
   of the message, cancel once, then confirm only if they want to remove it.
   If useful, try [moving an occurrence](MESSAGE_TOUCH_ORDER.md) instead. Observe
   whether its numbered preview helps the person choose their own word order.
3. **Move between pages.** Find a familiar touch on another page, keeping the
   message. Check whether saved positions and empty anchor spaces remain useful.
   If appropriate for the person, try the optional [personal touch lookup](COMMUNICATION_TOUCH_LOOKUP.md),
   distinguish identically named touches by location and close it to return to
   the same keyboard page. Observe whether typing helps or adds effort.
4. **Choose a personal formulation.** Explore Words and Phrases using previously
   accepted examples. Ask whether a proposal expresses their meaning. Try refusal
   and correction, then an explicit acceptance only if they choose it.
5. **Try optional AI.** Explain that it offers hypotheses. Ask for a formulation,
   compare it with the person's intended meaning, and exercise refusal. A model
   score is not proof of what the person meant.
6. **Prepare a missing word.** An authorized person creates and reviews a touch,
   previews its placement and returns. The communicator chooses whether to use it.
7. **Recover together.** In a prepared test setup, reload, simulate an outage,
   reopen the protected local copy and explicitly import a draft after reconnect.
   Verify that online and local messages are distinguishable.

Avoid coaching until needed; record the help given. Stop or shorten the session
if the person requests it. Speed alone is not success. Record comfort/fatigue as
reported by the person, without inferring emotion from selection timing.

### Observation template

```text
Build / issue:
Device / input / touch size / voice available:
Scenario:
Person's intended message (keep private if personal):
Outcome: completed / partly completed / stopped
Help: none / verbal prompt / demonstration / other
Confusing control or unexpected result:
Accidental activation and recovery:
Did spoken/retained text match the person's chosen meaning?
Person's feedback:
Supporter's observation (separate from the person's feedback):
Reported comfort / fatigue / wish to stop:
Proposed follow-up issue and priority:
```

## Remaining manual checks

- [ ] Actual screen reader: reading order, live message, settings, review and focus return.
- [ ] Native browser zoom at 200% on the intended devices.
- [ ] Actual installed local voice, audible Stop and sound-device behavior.
- [ ] Touch/mouse/keyboard comfort and understanding with the people concerned.
- [ ] Prepared offline copy on the intended device/browser, including storage limitations.

Keep these observations separate from CI results. Passing automated checks is not
an accessibility certification, clinical assessment or validation of the concept
with users. Turn concrete findings into small prioritized follow-up issues.
