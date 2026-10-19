# Explaining literal proposals in communication

When optional AI cannot supply an eligible formulation, PictoFlow keeps the
selected words in order as an unvalidated `pcl` proposal. The communication card
now explains the recorded reason for that specific attempt, alongside the
existing reading, correction and human-decision controls.

```text
[Ask for a formulation]       Explicit request only
            |
   Optional AI / eligibility checks
            |
     Literal proposal needed
            |
   PostgreSQL transaction
     +-- attempt receipt (existing aggregate quality evidence)
     +-- proposed interpretation + recorded fallback reason
            |
   Communication card: words + explanation
     +-- [Read]                  Local speech, no acceptance
     +-- [Modify / confirm]      Explicit human decision
     +-- Reload explanation      GET only, no model retry
```

## Recorded reasons

| Code | Meaning of the French explanation |
| --- | --- |
| `disabled` | AI assistance was disabled for this attempt |
| `model_refusal` | The model did not propose a formulation |
| `unfaithful_words` | Received formulations did not pass the word-grounding checks |
| `low_confidence` | Reported model scores did not reach the configured proposal threshold |
| `unavailable` | AI assistance was unavailable during this attempt |
| `invalid_payload` | The model response could not be used to propose a phrase |

The message describes the past attempt. It does not claim current provider
health, identify a quota or transport failure, or assess the person's intention.
No raw error, failed generation, provider URL, key or prompt is displayed.

## Persistence and access

`InterpretationService.fallback` records the allowlisted code in the candidate's
creation audit, atomically with the existing proposal and attempt receipt. The
existing profile-scoped read endpoint
`GET /profiles/{profileId}/interpretations/{interpretationId}/ai-context` adds
`fallback_reason`, defaulting to `null`. The domain interpretation and confidence
contracts, model wire schema and database schema are unchanged.

The card reads this narrow projection on display and after a reload, including
when the draft restores the proposal by its identifiers. It never reconstructs
the reason from today's provider settings, a sequence's latest attempt, or an
aggregate quality counter. Older candidates without recorded metadata say that
the reason was not recorded. Unknown codes are not echoed. The metadata survives
profile archive restoration with remapped identifiers.

An unavailable explanation leaves the original words and their controls visible.
**Recharger l’explication** repeats only the GET. Changing or leaving the candidate
aborts the old read; the component also checks the current path before displaying
a response. No message text or reason is added to browser draft storage.

The endpoint keeps its existing communication/review/history access policy.
Communicators do not gain audit-console access. Foreign profiles and revoked
grants remain denied. A corrected phrase replaces the literal notice, while its
historical reason remains readable through the existing scoped endpoint.

## Verification

- Unit tests cover reason allowlisting, absent/unknown metadata, non-literal
  sources and fixed French messages that never echo arbitrary input.
- PostgreSQL/API tests cover all six causes, actual HTTP structured-generation
  errors, read-only access, candidate-specific history, archive restoration,
  older metadata, limited communication grants, foreign profiles and revocation.
- The isolated browser workflow drives six deterministic provider cases through
  the real API, then reloads without another model call or write. It checks an
  unavailable explanation, a read-only retry, local reading without acceptance,
  missing legacy metadata, human correction and unchanged keyboard positions.

The legacy-field and explanation-outage browser cases intercept the narrow GET;
the other cases exercise recorded server metadata. Screenshots use synthetic
content. These tests do not call a live model, modify production data or establish
the semantic quality of Qwen responses.
