# Everyday French hypotheses

The French eligibility guard now permits `regarder` (and its present-tense
inflections) when a selected touch's validated personal meaning includes
`Télévision` or `Télé`. It does not infer buying a television, a destination,
an emotion or an unselected person. A television label whose personal meaning
is `Pause` does not grant this action.

An added watching action follows the existing inferred-link policy: confidence
is capped at the configured confirmation threshold, the proposal carries
`inferred_linking` evidence and remains unvalidated. The disposable 24-hour cache
may replay the proposal without learning it. Only explicit human acceptance
creates an accepted association.

| Synthetic selection | Candidate | Handling |
| --- | --- | --- |
| Maman, Télévision | Maman, je voudrais regarder la télévision. | Eligible hypothesis; confirmation required |
| Moi, Télévision | Tu regardes la télévision. | Rejected: selected speaker changed |
| Non, Télévision | Je regarde la télévision. | Rejected: negation lost |
| Maman, Télévision | Maman achète la télévision. | Rejected: unsupported action |
| Couche, Maman, Dormir; Couche means protection hygiénique | Maman, je me couche pour dormir. | Rejected: declared object read as a verb |
| Same explicit meaning | Maman, je voudrais une couche pour dormir. | Eligible unvalidated hypothesis |
| Couche, Maman, Dormir; meaning is only Couche | Either noun or action reading | Unresolved ambiguity; confirmation required |

## Declared meanings and uncertainty

The noun/verb guard covers the known `Couche`/`Couches` collision using explicit
meanings such as protection hygiénique, couche-culotte, couche pour bébé and se
coucher. It never reads a photo to assign meaning. With a declared diaper meaning,
complete phrases must use couche as a noun; bare ordered labels remain available.
An independently selected coucher action may coexist with the noun. A personal
reference cannot bypass this declared distinction in a newly generated hypothesis.
Accepted exact associations still follow the existing memory-first path and are
not rewritten by this lexical rule.

When the label and meaning merely say Couche, the backend records
`ambiguous_meaning` and caps generated candidates at the confirmation threshold.
The prompt asks for plausible distinct readings and distinguishes speaker,
addressee and actor: a named Maman may be addressed rather than made the actor.
The prompt also asks for a close current reading before a personal interpretation
supported by applicable accepted references. Negation, Stop, repetitions and
explicit actions remain protected.

These are bounded lexical rules, not a French semantic parser or a measurement of
the person's intention. They do not resolve all homonyms, assign actors reliably,
or guarantee that an external model returns several useful readings. The person
must be able to choose, correct or refuse. Unknown paraphrases may still fall
back to the original labels.

## Verification

`tests/test_everyday_grounding.py` exercises natural formulations, inflections,
explicit meanings and attempted reference bypasses. Integration regressions in
`tests/integration/test_proposal_relevance.py` cover real request construction,
confidence, audit evidence, cache replay and absence of automatic learning.
`tests/test_http_providers.py` retains the shared OpenAI-compatible and PRISM
contract checks, including PRISM's 4,000-character limit. Prompt changes also
change the cache identity, so pending proposals from the previous prompt are not
replayed as new generations.

All examples are synthetic. These checks require no external model calls, paid
quota, production profiles or deployment; a later live trial must assess actual
model wording with human review.
