# POC: complete-journey validation

This closes the automated whole-journey step of the three-space UX plan. Real
usability sessions remain pending. The test links the actual screens using one
profile's data and independent authenticated accounts; it does not substitute
model output or claim to know a person's intended meaning.

```text
Supporter                     Communicator                  History reader
prepare drawing + word
       |
proposed touch --------------- absent from keyboard
       |
explicit validation --------- usable touch
save stable position
                              choose six touches
                              (keyboard + mouse, repeats)
                              complete / explicit proposal
       <--------------------- pending phrase
inspect original touches
correct + accept
       |--------------------- accepted personal reference -- read decision
                              new message                    + original order
                              propose remembered phrase
       <--------------------- new proposal, not acceptance
refuse new proposal
       |--------------------- original reference retained
```

## Evidence produced by CI

[`complete-journey.mjs`](../admin/tests/e2e/complete-journey.mjs) runs against the
real authenticated API and PostgreSQL in the PCL workflow. Setup creates synthetic
profiles, grants and a foreign control reference through the API. All target
touch creation, validation, stable placement, composition, phrase correction,
memory reuse and refusal are performed through the browser UI.

The scenario verifies that:

- A proposed drawing/word is absent from the communicator's keyboard, and forging
  a professional actor role does not grant validation rights.
- Four simple daily pictograms can be prepared and explicitly validated by a
  supporter. Saving a stable anchor does not compose or accept a message.
- Six touches, including repeated words, retain their exact order through
  keyboard/mouse input, completion, proposal and browser reload.
- A communicator with only `communicate` can propose but cannot validate. Another
  account reviews the same six touches and records an explicit correction.
- A history-only account sees the actual correction, recorded human role and
  original ordered touches without decision controls.
- The next message can propose that accepted phrase from personal memory. Its
  source is `pcl-memory`; reading/choosing it does not accept the new message or
  invoke another interpretation request.
- Refusing the new proposal preserves the original accepted reference and the
  prepared keyboard positions.
- Another profile can associate the same water pictogram with swimming. That
  phrase is absent from this profile's suggestions; unauthorized navigation does
  not mount its loaders, its API returns 404 and its PCL collections stay unchanged.

The `synthetic-pcl-learning` artifact contains a structured `report.json` and
screenshots under `complete-journey/`. A checkpoint is recorded only after its
assertions pass. The report contains fictitious scenario data and no credentials,
cookies or CSRF tokens. A failed browser scenario records a failed status and
only the checkpoints completed before the failure; the job also fails.

The provider is explicitly **DisabledProvider**. Its literal proposal is corrected
by a human actor in the test. This demonstrates PCL retention and reuse, not
natural-language quality, implicit intent recognition, installed speech quality
or a fix for the separately diagnosed Groq/Qwen issues.

## Related coverage

| Scope | Existing browser scenario |
| --- | --- |
| Account grants, revocation, exact server denials | `profile-capabilities.mjs` |
| Admin/support/communication entry and mixed accounts | `three-spaces.mjs` |
| Communication layout, speech adapter, reset and recovery | `ux-communication.mjs` |
| Real fixture-driven optional formulation | `ux-fake-formulation.mjs` |
| Concurrent reviews, read outage and lost decision response | `support-review.mjs` |
| Scoped accompanied handoff and reauthentication | `accompanied-session.mjs` |
| Readable historical and current meaning | `memory-evolution.mjs` |
| Vocabulary-need evidence and explicit decisions | `vocabulary-needs.mjs` |
| Administrator console and honest operational status | `admin-console.mjs` |
| Protected offline reopen and explicit import | `offline-reopen.mjs` |

These remain separate scenarios: the complete-journey test does not claim to
exercise every failure mode, external provider or offline condition in one run.

## Preparing an actual POC session

Follow [the usability-session guide](UX_USABILITY_SESSIONS.md). Record the tested
release and device, use each person's authorized access, and choose vocabulary
with them. A practical walkthrough is:

1. An authorized supporter opens **Accompagnement → person → Clavier**, chooses a
   simple drawing and word, checks the personal meaning and explicitly validates
   the touch. Inspect the preview and any stable positions.
2. The communicator opens their keyboard, chooses a short message and completes
   it. Try a longer message with repetitions if they want to continue.
3. Inspect the proposal together. The authorized reviewer opens **Phrases à
   vérifier** and confirms, corrects or refuses according to the person's choice.
4. Open **Historique** to see what was actually retained and which touches it came
   from. Try **Suggestions → Phrases** and **Mots** on a later message.
5. Refuse a new proposal if it does not express the intended meaning. Check that
   consultation and refusal did not silently change an earlier accepted phrase.

Use the person's own words and feedback for the real exercise; the synthetic
water example is a test fixture, not a prescribed interpretation. The maintainer
records participant observations privately with the guide's template. Public
issues and screenshots should use fictitious reproductions.

Actual local voice, screen reader, native zoom, device storage, input comfort and
understanding need manual observation. No participant results, clinical benefit,
accessibility certification, deployment or external-model quality are claimed by
passing CI. Findings become the next small functional improvements.
