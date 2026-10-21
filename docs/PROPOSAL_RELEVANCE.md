# Proposal relevance and personal memory applicability

An accepted phrase is a personal association with its source touches, not a
general instruction to copy that phrase whenever one of its people appears.

```text
Selected touches
    |
    +-- Exact accepted alignment -> remembered choices (existing behavior)
    |
    +-- Pending cache for this request/prompt -> unvalidated cached choices
    |
    +-- Provider request
           |
           +-- applicable personal examples (up to 50, ranked as before)
           +-- first close reading; optional distinct personal hypotheses
           |
        eligibility checks -> explicit human review only
```

The same applicability rule is used when retrieving examples and when grounding
a proposed personal hypothesis. All source touch IDs must occur in the current
selection, with their repetitions. The source must cover at least half the current
selection. Order may differ for an AI hypothesis; direct memory reuse still
requires the same ordered alignment and compatible context.

For example, a four-touch `Maman / Papa / Manger / Maison` reference is not sent
or used to justify a meal when only `Maman / Papa` are selected. An association
explicitly accepted for those two touches alone can still express an implicit
meal, need or personal alias. Additional current touches may adapt an applicable
association. The rule deliberately excludes potentially useful longer sources
whose missing touches could change the situation; relevance remains bounded and
personal, rather than a general semantic similarity claim.

French modal forms can express a question or uncertainty. A selected transport
and place, recognized from the profile's validated meanings, may be linked with
`aller`, `venir`, `rentrer` or `retourner`. This bounded vocabulary covers common
transport/place expressions; it does not authorize other destinations, people,
objects, emotions or diagnoses. A transport label whose personal meaning differs
does not grant the link. Selected actions, negation, Stop, pronouns and repeated
content remain required. Unknown paraphrases can still fall back to the pictos.

An action inferred solely as a transport/place link caps the model score at the
configured confirmation threshold and records `inferred_linking` in proposal
provenance. This is an eligibility signal, not a probability of correct intention.
Personal hypotheses retain the existing priority and confidence cap; a close
generic alternative remains available when supplied and eligible. The prompt asks
for distinct plausible readings rather than manufacturing extra candidates.

The shorter shared prompt stays within the tested native PRISM envelope. Changing
the prompt changes the pending cache identity, so older cached responses cannot
silently bypass the new behavior. Existing displayed proposals and human decisions
are not rewritten; exact accepted memory continues to precede cache and generation.

Unit and PostgreSQL integration tests cover missing source touches, repetitions,
profile-specific exact associations, bounded linking, confidence caps, refusal and
pending-cache reuse. Synthetic evidence does not establish model quality or the
person's intended meaning. No raw rejected responses or personal prompts are added
to logs, and no second model or automatic retry is introduced.
