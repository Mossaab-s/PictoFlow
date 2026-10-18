# Supporter phrase review

After the three-space navigation and communication surface, accompaniment gains
`/accompagnement/personnes/{profileId}/a-verifier`: **Phrases à vérifier**.
It requires the existing `review_meanings` grant for that profile. A review-only
supporter can decide without gaining composition or keyboard-preparation rights.
The existing vocabulary-needs screen at `.../propositions` remains a separate task.

## Explicit review

```text
Existing completed personal messages and interpretations
                     |
             Pending message groups
                     |
        Original ordered touches (current drawings)
                     |
    +----------------+------------------+
    |                |                  |
 Confirm          Correct             Refuse
    |                |                  |
 Existing profile-scoped interpretation feedback endpoint
                     |
       Fresh list + recorded human decision/evidence
```

The page groups alternative hypotheses by completed message and preserves repeated
touches. Search and ten-message pages operate on the current profile's read model.
Only unresolved messages appear in the pending view. If one hypothesis is already
accepted/corrected, its still-proposed siblings are omitted from that queue; their
stored status is not rewritten. Recorded confirmations, corrections and refusals
are available in a read-only decisions view, including existing per-item human
evidence. Refusals are distinguished from accepted personal memory.

An authorized person explicitly confirms, edits and saves a correction, or refuses
a phrase. The declared provenance defaults to caregiver and can be selected; this
does not confer permissions. The existing account identity is recorded by FastAPI.
Local French speech, when available, reads a phrase only on request; Stop/Escape
interrupts it. No new proposal or provider request is issued by this page.

## Concurrent and uncertain decisions

The existing feedback endpoint accepts optional `expected_status: "proposed"` for
pending review. The new page always sends it. `CommunicationService.validate`
checks it inside the existing profile-locked PostgreSQL transaction. A changed
candidate, or acceptance of another hypothesis while accepting/correcting this
one, returns 409 before appending PCL feedback/audit. Existing clients that omit
the precondition retain their deliberate legacy transition behavior. This is a
pending-review check, not a general revision token for later accepted edits.

On conflict or an uncertain response, the UI rereads the list without retrying the
decision. While a read is unresolved or fails, further decisions are blocked until
a successful explicit refresh. A successful write followed by a failed reread is
reported separately. A lost response after commit can therefore be reconciled
without duplicate acceptance. Existing CSRF, live grant revocation, profile
isolation and stale-account-response handling still apply.

## Validation

Presentation tests cover grouped hypotheses, resolved siblings, profile/completed
sequence isolation, recent-decision ordering and independent access grants.
PostgreSQL service/API tests cover stale correction/confirmation/refusal, sibling
conflicts, unchanged feedback/audit after 409, invalid preconditions, foreign
profiles and compatibility with deliberate legacy withdrawal.

The authenticated CI browser uses fictitious profiles and a review-only account.
It exercises all three decisions, role evidence, read-only recent decisions,
cross-profile denial before loading, stale decisions, lost responses, failed
refresh, grant revocation and unchanged keyboard positions. Existing communication,
memory, offline and three-space journeys also run. This increment adds no PCL
schema migration, keyboard reordering, prompt change or accompanied-session lock.
