# French phrase coverage: toileting support verbs

The French lexical check previously rejected `Moi → Caca` when a provider
returned `Je voudrais faire caca.` with bare `Caca` as the selected meaning.
It treated `faire` as an additional action and fell back to the literal touches.
The same false rejection affected `Pipi` and conjugated forms such as
`Tu fais pipi ?` or `J’ai fait caca.`.

The check now recognizes `faire pipi` and `faire caca` when the corresponding
noun occurs in the selected labels. Only the adjacent support verb is discounted,
using the existing French inflection table. `Faire` remains a content word in
other expressions, and explicitly selected occurrences of `Faire` remain required.

| Selected touches | Provider candidate | Lexical result without personal references |
| --- | --- | --- |
| Moi → Caca | Je voudrais faire caca. | Eligible proposal |
| Moi → Pipi | J’ai besoin de faire pipi. | Eligible proposal |
| Moi → Non → Caca | Je ne veux pas faire caca. | Eligible proposal |
| Moi → Caca → Caca | Je voudrais faire caca. | Literal fallback: one occurrence is missing |
| Moi → Caca → Livre | Je voudrais faire caca et faire un livre. | Literal fallback: an unsupported action is added |
| Moi → Caca → Mal | Je voudrais faire mal et caca. | Literal fallback: `faire mal` is a different expression |
| Moi → Caca | Tu veux faire caca. | Literal fallback: the selected person is missing |

All other content, repetition, negation, selected-person and confidence checks
still apply. This does not infer illness, urgency, mood, actor roles or the
person's intention, and does not make `Caca`, `Pipi` and `Toilettes` interchangeable.
Personal paraphrases still follow the existing profile-specific reference rules.
The broader lexical heuristic is not a semantic validator.

An eligible provider candidate remains **proposed**. Only an explicit human
decision can make it accepted personal memory. A matching human correction may
also pass the existing correction-example filter on a later request; its profile,
sequence order, context, current-meaning and withdrawal checks remain in force.

## Verification

Unit regressions cover the previous rejection, inflected forms, independent
support-verb occurrences, explicit `Faire`, omitted actions, repetition, negation,
selected persons, Stop and Yes. The PostgreSQL integration test exercises both
nouns through real proposal persistence, human correction, reuse, profile
isolation and withdrawal:

```shell
cd backend
python -m pytest tests/test_phrase_fidelity.py tests/test_personal_hypotheses.py
# With the disposable PostgreSQL test database configured:
python -m pytest tests/integration/test_french_idioms.py
```

These are deterministic provider fixtures. They verify filtering and persistence,
not the quality or availability of live Qwen responses. No production profile,
provider configuration or deployment is changed by these tests.
