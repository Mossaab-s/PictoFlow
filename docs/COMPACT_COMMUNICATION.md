# Persistent communication surface

Issue #119 introduces the compact default at `/communication/{profile}`. The
maintainer chose automatic formulation after a pause. The original detailed
workflow remains behind **Options**, with existing profile/capability checks.
The tab remembers this view preference; it contains no communication text.

**Mes phrases** in the compact header opens accepted personal phrases directly,
with a separate review and deliberate reading while the current composition is
kept. See [COMPACT_PERSONAL_PHRASES.md](COMPACT_PERSONAL_PHRASES.md).

Tapping a current-message pictogram offers Keep, Remove or Replace, with a local
before/after review and explicit confirmation. Completed snapshots are preserved
through the existing editable-copy path. See
[COMPACT_TOUCH_REPLACEMENT.md](COMPACT_TOUCH_REPLACEMENT.md).

With two or more pictograms, **Déplacer cette touche** also provides a numbered
order preview without dragging. See [COMPACT_TOUCH_ORDER.md](COMPACT_TOUCH_ORDER.md).

**Ajouter une touche ici** offers before/after the chosen occurrence, followed
by a full-message review. See [COMPACT_TOUCH_INSERTION.md](COMPACT_TOUCH_INSERTION.md).

**Changer** reviews the original pictograms, proposal and personal correction
before explicit saving, retaining the draft through errors. See
[COMPACT_PHRASE_CORRECTION.md](COMPACT_PHRASE_CORRECTION.md).

```text
Choose pictograms -> original drawings/words update immediately
           |
     1.2-second pause
           |
Seal immutable sequence snapshot -> accepted PCL / 24-hour cache / optional AI
           |                                      |
           |                          show only if still current
           |                                      |
Continue editing in a copy              Speak / confirm / correct / refuse
           |                                      |
Original snapshots are preserved         explicit feedback only -> memory
```

The pause is a scheduling delay, not an inference about emotion or intention.
One automatic request runs at a time in the tab. New choices cancel a pending
timer; an outstanding request settles before the latest selection is requested.
Its result is ignored when its sequence is no longer current. It never triggers
speech, acceptance, keyboard rearrangement or an automatic retry after an error.
The automatic option can be disabled. A memory-only suggestion mode pauses AI;
its existing tools remain available in Options.

The existing API requires a completed selection before interpretation. Automatic
completion therefore seals a snapshot, without validating its meaning. Its audit
source is `application`, with `completion_reason=automatic_phrase_preview`. An
explicit later pictogram edit uses the existing idempotent editable-copy API and
then applies the edit. Copy recovery references contain IDs only. Earlier completed
snapshots and their pending/accepted meanings are not overwritten. This produces
completed snapshot history for pauses; only explicit human feedback is accepted
personal-language memory.

The message, speech/review controls and stable-key region keep their place while
the personal pictogram browser scrolls. Stable keys use the profile's validated,
explicitly placed anchors; this UI does not invent universal meanings or silently
create six new personal keys. Supporters should prepare Yes/No/Stop/Help/Drink/
Toilet anchors with that person when appropriate. Positions and original images
are retained; desktop uses six columns and narrow screens use three. Extra
configured anchors remain available in their existing stable pagination.

The supported fixed-viewport layouts are tested at 1280x900, 1024x768 and 390x844.
Short/zoomed viewports (height at most 600 CSS pixels) use normal page flow with a
sticky message instead of clipping content. Long phrases and long pictogram
sequences have their own scroll areas. French local TTS remains explicit and can
read either a hypothesis or the original pictogram words, even if AI is unavailable.

Automated synthetic evidence covers slow/stale responses, continued input,
original-sequence preservation, stable-key coordinates, internal grid scrolling,
explicit speech and learning, correction, recovery, an opt-out and offline literal
speech. Existing detailed-tool browser journeys explicitly select the Options
view; the new default is tested independently. Real-device speech, switch-device
access and evaluation with AAC users and practitioners remain to be performed.
Automated checks do not establish participant usability or model understanding.
