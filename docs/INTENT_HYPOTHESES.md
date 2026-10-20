# Distinct intent hypotheses

On a provider request, PictoFlow asks for one to three plausible interpretations
of the selected pictograms, guided by this profile's accepted PCL history. A request
is one possible intention alongside a preference, observation, question or refusal.
The shared prompt explicitly discourages automatically starting every message with
“Je veux” or “Je voudrais”.

```text
Moi -> Boire -> Eau
       |
       +-- request:     Je voudrais boire de l’eau.
       +-- observation: Je bois de l’eau.

Moi -> Manger -> Maison
       + accepted personal association: J’aime manger à la maison.
       |
       +-- preference:  J’aime manger à la maison.
       +-- request:     Je voudrais manger à la maison.
```

These are hypothetical readings, not claims about a person's present intention.
One supported reading is sufficient when alternatives would require inventing
content. A model must not add a question, feeling or affirmative alternative merely
to fill three slots. Explicit negation, Stop, selected people/actions and existing
profile-local grounding remain in force. Timing does not establish emotion.

## Avoiding duplicate choices

After grounding, otherwise identical affirmative first-person “je veux” and
“je voudrais” variants share one choice. NFC normalization, case, typographic
apostrophes and repeated whitespace are also normalized for this comparison.
The highest **post-cap** confidence wins within that narrow group; the first
candidate is kept on ties. Low-confidence duplicates cannot hide stronger eligible
ones, and no score is increased.

Punctuation, accents, actions, people, selected order in the sentence and the rest
of the wording are preserved. In particular, “Maman est à la maison ?” and “Maman
est à la maison.” remain different choices. Explicit negation or Stop disables
modal-variant grouping; exact normalized duplicates may still share a slot.
More distant paraphrases can remain duplicated: this is deliberately not a semantic
equivalence classifier. Provider `intent` labels never determine grouping,
grounding, confidence thresholds or human acceptance.

## Memory, cache and diagnostics

The [memory-first resolution and 24-hour cache](INTERPRETATION_REUSE.md) still run
before generation. An accepted exact alignment remains available without a model
call. “Proposer d’autres phrases” explicitly bypasses reuse and requests new
hypotheses with personal history. Changing the shared prompt changes the existing
cache fingerprint, so earlier generated entries are not reused for this prompt.
Accepted PCL associations are unaffected by that fingerprint change.

The selected provider's `intent` label is recorded in proposal presentation
evidence as `provider_intent`. It is diagnostic model output, not a validated PCL
concept, a learned personal intention or a confidence estimate. The synthetic
personal evaluator reports raw and retained labels and states this limitation.
Acceptance still applies to the phrase the person chose or corrected.

The evaluator now contains 22 controlled probes, including requests versus
statements, personally supported preferences, questions, refusals, modal variants
and a preference label with no grounding. Offline fixtures exercise transport
contracts, actual filtering and persistence logic; they do not measure how often
a real model understands a person's intent. Use human review of live examples and
participant choices to assess that question.

The vocabulary guard is unchanged. Questions or paraphrases that introduce words
outside the selected meanings and eligible references can still be rejected.
The PRISM query bound remains 4,000 characters and structured output remains one
to three candidates. No extra provider call is made to manufacture alternatives.
