# Long pictogram compositions and personal memory — 20 October 2026

The experiments reproduced three separate reasons for an apparently missing
phrase: strict structured generation failure, provider rate limiting, and
application word filtering. There is no fixed four-touch cutoff in these tests:
ordinary five-, six-, eight- and ten-touch selections produced retained French
proposals. Personal memory influenced some hypotheses but did not reliably
resolve every personal alias.

All 48 live calls used generated profiles and synthetic accepted phrases. No
real profile was read or modified, no proposal was accepted automatically, and
neither the server configuration nor the deployed application was changed.
These are exploratory examples, not a semantic accuracy benchmark or participant
usability evidence.

## What was compared

```text
Same ordered touch labels (5–10 touches)
               |
               +-- no memory
               +-- personal preference / request
               +-- Doudou means an accepted "ours" expression
               +-- Doudou means a different accepted "couverture" expression
               +-- withdrawn / foreign reference, excluded
               |
     Real request builder and ranked memory selection
               |
   Compatible adapter -> Groq Qwen -> contract validation
               |
     Existing grounding and confidence policy
               |
    Unvalidated hypotheses or ordered literal fallback
```

The model was `qwen/qwen3.8-27b`, with temperature `0.2`. The server configuration
file read for the experiment specified `json_schema`; a test-only override also
exercised `json_object`. This read does not establish which code version or
container overrides are currently running on the server.
The interpretation pipeline sends selected touch labels, meanings and accepted
references, rather than the pictogram image pixels themselves.

| Phase | Calls | Spacing | Retained provider proposal | Other results |
| --- | ---: | --- | ---: | --- |
| Original prompt, strict JSON | 2 | 2 seconds | 1 | 1 HTTP 400 structured-generation failure |
| Original prompt, JSON object | 13 | 2 seconds | 7 | 5 HTTP 429; 1 word-filter fallback |
| Expanded guidance | 5 | 20 seconds | 3 | 1 word-filter fallback; 1 HTTP 200 with invalid structured output |
| Expanded guidance v2 | 14 | 20 seconds | 11 | 3 word-filter fallbacks |
| Final compact guidance | 14 | 15 seconds | 11 | 3 word-filter fallbacks |

The expanded variants were exploratory. The final wording replaces the previous
memory paragraph with a short, explicit instruction to propose a reading from
a close accepted expression, even when the touch's declared meaning remains
generic. It preserves the existing PRISM 4,000-character boundary; the longer
exploratory wording did not fit that boundary for existing requests. No request
limit, lexical guard, confidence threshold or validation requirement was relaxed.

## Concrete findings

### Strict JSON is one independent failure mode

`Maman → Papa → Manger → Maison → Moi → Content` received HTTP 400 and was
classified `invalid_payload` in the strict-mode probe. A ten-touch request passed
in the same mode. With JSON object mode, the six-touch case produced:

> Maman, Papa, je voudrais manger à la maison. Je suis content.

This shows that selection length alone does not explain the reported failures.
For this Groq/model setup, `json_object` remains the safer candidate for the next
explicit deployment. It still undergoes the same Pydantic output validation.
No server setting was changed by this work.

### Provider quota can look like a missing phrase

Five of the initial thirteen JSON-object calls received HTTP 429. The application
correctly classified them as `unavailable` and kept the ordered words. They are
transport failures, not failed semantic interpretations. The later spaced runs
had no 429 responses, and the recorded headers reported a limit of 8,000 tokens
per minute for these calls. This does not guarantee that spacing alone will fit
all future requests or other activity on the same account.

Groq documents [429 and the rate-limit headers](https://console.groq.com/docs/rate-limits).
The new evaluator records allowlisted numeric quota information and stops at a
429 or authentication failure. It does not automatically resend the request.
The application's existing `unavailable` category remains unchanged.

### Personal references matter, but guidance is not reliable alignment

With the six meal touches and an accepted reference **J’aime manger à la maison**,
Qwen produced a preference hypothesis containing **j’aime**, which the application
retained through that personal reference. The absent, withdrawn and foreign-memory
controls sent no accepted reference and did not acquire that preference in the
final run.

With the five Doudou touches, the final compact prompt produced **mon ours** when
the profile's accepted expression mentioned an **ours**. With a different profile
whose expression mentioned **ma couverture**, Qwen continued to say **mon doudou**.
That second alignment remains unresolved; the prompt change is not a universal fix.

There is also an application ranking effect: memory-grounded paraphrases are
capped at confidence `0.65`. A more literal candidate can therefore appear first
even if the provider returned the personal reading first. The report records raw
and retained confidence separately. This safety cap should not be raised simply
to make a personal hypothesis rank first; presentation order deserves a separate
functional change with explicit human confirmation preserved.

### The word guard can reject a grammatical phrase

The final Doudou controls were also rejected because **mon** lay outside their
selected meanings and accepted reference vocabulary. In the couverture case,
the reference supplied **ma**, while the model wrote **mon**. This is a conservative
lexical limitation, separate from Qwen's failure to use the desired personal noun.
The report makes it visible instead of labelling the model response meaningless.

For the ten-touch repetition case, both final candidates omitted one of the two
selected **Boire** occurrences. The guard rejected them and retained the complete
ordered selection, including **Stop**. That fallback is expected protection.

Conversely, a phrase fragment such as **Je voudrais boire de l’eau. Maman, à la
maison.** can preserve all required words and pass the guard. Lexical coverage
does not prove naturalness, roles, or intention. Human choice remains necessary.

## Reproduce the checks

From `backend/`, use the installed Python environment:

```sh
python -m app.ai.personal_evaluation --output personal-evaluation.json
```

The current evaluator has 22 offline scenarios: the original sixteen probes and
six [intent-hypothesis probes](INTENT_HYPOTHESES.md). They exercise the actual
request builder, ranked personal examples, grounding, confidence handling and
proposal persistence against a generated in-memory repository. Twenty are
live-eligible; two remain fixture-only guards: a deliberately dropped repetition
and a 70-reference budget stress case. Existing PostgreSQL tests separately verify
the real repository's acceptance, profile isolation and changed-meaning rules.
The recorded live experiments above still describe the original probe set and
its captured prompts, not new observations of the updated instruction.

The budget fixture selected 47 whole references within 32,000 serialized characters.
The default limit of 50 is a maximum, not a promise to send fifty long phrases.
This stress case does not call the external model and does not measure its quota.

Explicit live CLI calls use the backend's private environment configuration.
They do not load administrator overrides saved in PostgreSQL; use the normal
profile API when testing the application's currently active provider.

```sh
python -m app.ai.personal_evaluation --live --response-format json_object \
  --interval 20 --scenario six_no_memory --scenario six_preference \
  --output personal-live.json
```

`--scenario` is repeatable. `--response-format` overrides only this evaluation;
it does not edit environment files or deploy anything. Live mode supports the
compatible adapter and can consume provider quota. Offline mode reads no external
configuration and makes no HTTP calls. CI runs both the original short suite and
the new personal suite without credentials.

The report distinguishes provider texts, retained texts, HTTP status, contract or
word-filter fallback, selected references, raw/retained confidence and surface
word differences. The latter are review clues: a missing surface noun can be a
legitimate personal paraphrase. They do not replace the existing per-reference
grounding rule. A successful exit indicates execution and state-safety checks,
not that the model understood the intended meaning.

## Recorded evidence and next functional work

The [recorded synthetic reports](validation/personal-phrases-20261020/README.md)
include every exploratory phase, their prompt fingerprints and the exact prompts.
Surface diagnostics and retained confidence were added after capture from the
recorded synthetic requests and the unchanged guard/threshold; candidate texts,
HTTP outcomes and observed usage were not rewritten.

The next useful increments are to make personal readings easier to identify
without inflating confidence, improve profile-specific aliases and permitted
French grammar without pooling unrelated memories, and explain quota/format
fallbacks clearly in the communication interface. These are remaining functional
limitations, not completed fixes in this evaluation task.
