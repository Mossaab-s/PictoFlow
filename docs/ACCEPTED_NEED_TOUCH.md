# Prepare an illustrated touch from an accepted vocabulary need

A supporter can now follow an accepted vocabulary need into keyboard preparation
without copying its meaning by hand. The optional `need` URL parameter contains
only the need ID; personal text is read from the authorized profile API.

```text
Repeated completed messages + explicitly accepted personal phrases
                              |
                    Review and accept need
                              |
                  Open keyboard preparation
                              |
              Choose drawing -> Write short word
                              |
              Review drawing, word, accepted meaning
                              |
                   [Create proposed touch]
                              |
            [Validate drawing and word] or [Set aside]
                              |
                 Existing visual placement controls
                              |
                  Personal communication keyboard
```

## Try it

1. In **Besoins de vocabulaire**, open **Suivi des décisions**. Open keyboard
   preparation from an accepted need.
2. The editor displays the actual accepted reference expression. Choose a simple
   drawing and write a short label, for example **Boire ici** for the personal
   meaning **Je voudrais boire de l’eau.** The word and the meaning are distinct.
3. Review the drawing, word and retained meaning. Going back changes only the
   local preparation. Creation is an explicit action and produces a proposed touch.
4. Follow **Revoir cette touche**. Validate the drawing and word, or set the touch
   aside. Acceptance of the need alone never validates the touch or its drawing.
5. After validation, follow **Choisir la place de cette touche** into the existing
   visual placement controls. Stable anchors and other touches retain their places.
   Validation uses the existing adaptive projection until a placement is chosen.

Reloading the same need opens its existing touch. A rejected touch is retained
and may be explicitly reviewed again. No second touch is created for the same
need. The decision history links resolved needs back to their touch as well.

## Personal meaning and storage

`POST /profiles/{profile_id}/suggestions/{gap_id}/illustrated-block` accepts
`request_id`, `label`, `pictogram_key`, `expected_intent` and `actor_role`.
It requires `prepare_keyboard`; approval/refusal of a need continues to require
`manage_meanings`. Role selection records the actor's declared role and never
grants access.

The profile transaction rechecks approval and current accepted evidence. It
creates a Concept with the exact accepted expression, a proposed Representation
and a proposed CommunicationBlock linked through `semantic_gap_id`. The existing
Concept/Representation relationship and exactly-one-concept-or-intent constraint
remain intact. No database migration is required.

The drawing and displayed word do not redefine the accepted meaning. General
concept renaming cannot repurpose a concept attached to a vocabulary need;
prepare a separate meaning instead. Snapshots and profile archives check the
same invariant, including after ID remapping on restoration. Validated illustrated
touches suppress duplicate gap detection by their personal meaning, while ordinary
concept touches keep the existing detection policy.

First validation rechecks current evidence and approval before recording drawing
confirmation, block feedback and resolution together. A failed check rolls back
all of them. The existing validation projection becomes available for communication;
no phrase is accepted, no message is composed and no AI request is made by preparation.

## Recovery and scope

- A matching explicit retry returns the existing touch without extra records or
  audit events. Another request for the same need, or a different word/drawing
  under the same request, is rejected. Later validation or refusal is never reset.
- A lost creation response triggers the editor's existing read-only refresh,
  never an automatic POST replay. The linked touch is recovered from profile state,
  including after reloading the page without the original request ID.
- Failed need/evidence reads block creation. A withdrawn need or insufficient
  evidence prevents new creation and first validation, including stale open editors.
- The first version creates catalogue drawings. Personal photos remain available
  in ordinary preparation and for existing concept-backed validated touches.
- Expressions longer than the provider-neutral 512-character touch meaning limit
  remain in memory and cannot be silently shortened into a new touch.
- Existing intent-only legacy candidates are preserved and reviewed through the
  editor. This flow does not silently convert their identity or historical meaning.

## Verification

Contract and domain tests cover explicit preparation rights, strict fields, personal
meaning, snapshot consistency, profile isolation and duplicate detection. PostgreSQL
tests cover atomic creation, matching retries, conflicting drafts, refusal, lost
eligibility, revoked approval, visual validation and backup/restoration. The
authenticated browser scenario `admin/tests/e2e/need-touch.mjs` uses a preparation-only
supporter, real profile APIs and synthetic accepted phrases. It exercises the full
path, keyboard focus, word retention, a committed write with a lost response,
reload recovery, refusal, chosen placement, stale evidence, read failure and
320-pixel layout. Screenshots contain synthetic data only. Actual participant
usability sessions and deployment remain separate steps.
