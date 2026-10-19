# Supporter vocabulary needs

The accompaniment page `/accompagnement/personnes/{profileId}/propositions`
replaces the generic suggestion listing with a review of vocabulary needs.
It shows repeated, explicitly accepted expressions, the original ordered touches,
current evidence and the person's recorded decision. Nothing is accepted on view.

```text
Completed touch sequences + explicitly accepted phrases
                         |
              [Search repeated expressions]
                         |
               Existing PCL GapPolicy
                         |
                  Need to examine
                         |
             [Open current examples]
                         |
          +--------------+---------------+
          |                              |
     [Accept need]                  [Refuse need]
          |                              |
     Accepted need                 Refused need
          +--------------+---------------+
                         |
                  Decision history
                         |
          [Open keyboard preparation] if permitted
```

## Meaning and evidence

Detection reuses the existing exact ordered-sequence signature and accepted-text
policy. Default thresholds remain five completed occurrences and four accepted
interpretations of the same phrase. This is not semantic clustering or an AI
inference. The personal profile remains the scope of every read and decision.

Opening the page, searching the list and opening examples are read-only. Detection
is an explicit action. Each card distinguishes counts recorded at detection from
current counts, displays the configured thresholds and shows up to five current
accepted examples. Example dates are labelled as proposal dates; they do not claim
to be acceptance dates. Original touch order and repetitions are preserved.

Pending needs and recorded decisions have separate views, text search and ten
cards per page. A withdrawn accepted interpretation disappears from current
examples. Approval always rechecks current evidence on the server; insufficient
evidence or an existing active key prevents approval.

Acceptance records a need. This increment does **not** create, validate, place or
activate a key. An accepted card links to the existing keyboard editor only when
the supporter can prepare it. The drawing, word and key validation remain explicit
preparation steps. The existing intent-only `from_gap` API is unchanged and is not
called by this screen. Connecting such candidates to pictogram preparation needs
a separate domain change preserving the Concept/Representation relationship.

## Access and concurrency

| Operation | Required profile capability |
| --- | --- |
| List needs and read their narrow evidence | `manage_meanings`, `prepare_keyboard` or `view_history` |
| Explicitly run detection | `manage_meanings` or `prepare_keyboard` |
| Accept or refuse | `manage_meanings` |
| Open keyboard preparation | `prepare_keyboard` |

Human role selection records who made the decision; it does not grant permission.
History-only access is read-only. This does not widen general sequence or
interpretation access. Unassigned profiles and accompanied sessions retain their
existing isolation boundaries.

`GET /profiles/{profileId}/suggestions/{gapId}/evidence` is a read-only projection
from the existing policy, returning current counts, thresholds, eligibility,
existing-key status and accepted sequence/interpretation pairs. It does not call
an AI provider or persist detection results.

The existing decision endpoint accepts optional `expected_status: "proposed"`.
The new UI supplies it on every decision. The profile transaction checks this
condition before recording feedback or audit; an already decided need returns
409 without an extra event. Omitting the condition retains existing API behavior,
including deliberate legacy transitions. No schema migration is required.

After a decision, including an uncertain response, the screen rereads server state
without resending the POST. A failed list read hides stale cards and blocks
decisions until an explicit successful refresh. A failed evidence read removes
its decision controls until examples can be loaded again. Live capability changes
remain enforced by the API.

## Verification

Unit tests cover profile filtering, pending/history search, accepted-only example
joins and capability policy. PostgreSQL API tests cover read-only evidence,
withdrawal, stale decisions without duplicate events, cross-profile denial and
limited grants. The isolated PCL CI workflow exercises real authenticated browser
journeys, including approval/refusal, stale review, withdrawal after opening,
evidence/list outages, a committed decision with a lost response, live revocation,
history-only access and unchanged keys/keyboard. Screenshots use synthetic data
at tablet and mobile widths. These checks do not replace participant usability
sessions or constitute a deployment.
