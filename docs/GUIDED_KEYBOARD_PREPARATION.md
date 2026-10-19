# Guided keyboard touch preparation

The keyboard editor now separates touch creation into three short steps. The
supporter sees only the fields needed for the current step, with an explicit
current-step indicator and keyboard focus on each step heading after navigation.

```text
1. Image                   2. Word                  3. Review
Drawing or personal photo  Editable catalogue word Image above the actual word
Search / categories        Optional personal sense Retained meaning
                           Or existing meaning     [Create proposed touch]
     ^                          ^                         |
     +---------- Back / edit locally --------------------+
                                                          |
                                            Explicit validation below
                                                          |
                                                    Keyboard touch
```

Choosing an image, typing, reviewing, going back and changing drawing/photo source
do not write to the PCL. Only the final **Créer la touche à vérifier** submits a
creation request. Enter in an earlier step advances the form rather than creating
a touch. Search still prevents Enter from submitting.

## Words, meanings and photos

A drawing initially supplies its catalogue word. Choosing another drawing updates
that default until the person explicitly edits the word. An edited word remains
unchanged when they go back and choose another image. Photo filenames never
become the word automatically.

The second step puts personal meaning and reuse of an existing concept inside
**Préciser le sens (facultatif)**. The review shows the actual retained meaning,
including when it differs from the displayed word. Going back retains these
choices. Personal photos use a local preview; temporary object URLs are revoked
when their preview unmounts or changes. The selected filename remains readable
when returning to the image step.

The role selector is available under **Qui prépare et valide ce clavier ?**.
It records the existing human role and does not change account permissions.

## Creation, uncertain responses and validation

The wizard retains its draft after a failed creation response. An unchanged retry
uses the same request identifier; changing the draft starts a new creation. The
existing personal-meaning and photo APIs retain their idempotent contracts.
Creating a touch for an existing concept now also accepts optional `request_id`
on `POST /profiles/{profileId}/blocks`. A replay returns the same touch without
new records or audit events. Reusing an identifier with another word, concept or
drawing is rejected. Old callers omitting the field retain their existing behavior.

After a successful creation, the editor refreshes server state and focuses the
new proposal. The separate drawing/word validation remains explicit. Refusal
preserves the proposal's history. Existing stable anchors, placement previews,
page organization and keyboard preview remain available.

The missing-word return journey still keeps the ongoing communication sequence;
the newly prepared touch is never appended to it automatically. Preparing or
validating a touch does not accept a phrase or invoke AI.

## Validation

The authenticated browser scenario uses a preparation-only supporter and real
profile APIs. It checks local back/edit operations without writes, catalogue and
custom wording, optional meanings, personal photo preview, existing-concept
reuse, committed writes with lost responses, explicit validation/refusal, stable
anchors and narrow layouts. Desktop/mobile screenshots contain synthetic data.
The daily-drawing, missing-word and whole-journey tests follow the same new steps.

PostgreSQL tests exercise idempotent existing-concept creation, conflicting
replays, foreign concepts and backwards-compatible creation without an identifier.
These automated checks do not replace usability sessions with the people concerned.
