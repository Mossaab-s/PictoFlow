# Readable evolution of personal phrase memory

Supporters with `view_history` can open **Historique** on a person's page. The
screen shows human confirmations, corrections and withdrawals of previously
accepted phrases, newest first. A three-decision preview appears after the
person's activity cards. Each change includes:

- The actual decision date and the human role recorded in the audit source.
- The original sequence in its chosen order, including repeated touches. Drawings
  and labels are today's representations, explicitly described as such.
- The accepted wording at that date, and the before/after wording for corrections.
- The interpretation's current accepted/rejected state, as read on refresh.
- A deliberate disclosure of the existing human feedback history.

```text
Maman -> Papa -> Boire -> Eau -> Maison -> Eau
                      |
                phrase confirmed        historical wording retained
                      |
                human correction        previous / corrected wording
                      |
                human withdrawal        phrase withdrawn at that date
                      |
                refresh current state   retained or refused/withdrawn today
```

The timeline is history, not a new source of personal truth. A historical
confirmation does not mean the phrase is still accepted today. The current
interpretation is read after the audit page so that it cannot predate a displayed
decision. The screen states that current values reflect its last refresh. A read
failure hides the previous cards until an explicit successful refresh. It does
not automatically retry, validate, replay a message or call an AI provider.

Unaccepted proposals, sequence selections and refusals of never-accepted phrases
do not appear as learning. Those proposals remain available in **Phrases à
vérifier** to authorized reviewers. This increment covers phrase memory; keyboard
changes and other semantic events remain in the existing full technical audit.
The interface does not infer medical outcomes, emotion or who was at the keyboard.

## Existing API extension

`GET /api/v1/profiles/{profile_id}/audit` keeps its existing response type,
oldest-first default and profile-scoped `view_history` authorization. It adds:

| Parameter | Meaning |
| --- | --- |
| `newest_first=true` | Order by descending `(created_at, id)` |
| `meaning_changes_only=true` | Select interpretation confirm/correct/reject events whose old or new state was accepted |
| `before=<audit-event UUID>` | Exclusive keyset cursor, requiring newest-first order |

The cursor must belong to the same profile, target and filter scope. Unknown,
foreign or filtered-out cursors return 404. The existing 1-1000 limit remains.
The screen requests 21 rows, displays 20 and continues from the twentieth event
when another row exists. Newer inserts do not repeat already displayed pages;
refresh explicitly returns to the latest decisions. Date ties use the event UUID
as a deterministic tiebreaker.

This extension is necessary because the old audit query returned only the first
500 events and could not reliably show recent accepted changes after a busy
communication history. It reuses existing immutable snapshots and does not change
PCL transitions, persisted schemas, accepted memory or account grants.

The frontend validates snapshot profile/target/sequence identity before presenting
the phrase, reuses the existing accepted-text presentation helper and renders
plain French text without raw JSON or visible technical identifiers. Source roles
are displayed only when explicitly recorded; missing roles are not inferred.

## Verification

- PostgreSQL/API tests cover real confirm/correct/withdraw chains, never-accepted
  refusals, current memory preservation, ascending compatibility, stable date
  ties, new inserts between pages and profile/target/filter cursor isolation.
- Authenticated browser CI uses synthetic data and a history-only supporter. It
  checks six ordered touches with a repetition, wording changes, explicit roles,
  current versus historical acceptance, read-only behavior, empty state, the
  three-item preview, more than twenty decisions, outages and rights revocation.
- Existing tests keep communication, accompanied handoff, keyboard placement and
  personal offline flows covered. Screenshots use synthetic profiles on mobile
  and tablet; they are not evidence of participant usability sessions.
