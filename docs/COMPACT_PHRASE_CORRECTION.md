# Reviewing a personal phrase correction

Issue #149 improves **Changer** in compact communication. A proposed phrase is
not the person's accepted meaning. Editing it now has a separate review before
the existing explicit feedback operation.

```text
Current proposal -> Change -> edit personal wording -> Review correction
                                   ^                        |
                                   +--- Edit my text -------+
                                                            |
                                    pictograms + proposal + exact wording
                                            |               |
                                      Keep message      Save my meaning
                                                            |
                                                 accepted personal memory
```

The modal captures the selected proposal and original pictogram words/drawings,
including repeated occurrences. Its first stage focuses the editable text. The
review stage displays the trimmed text exactly as the feedback API will receive
it, starts the text at its first words, focuses the safe Keep action and allows
returning to the unchanged input.
Only **Enregistrer mon sens** submits. Opening, editing, reviewing, going back
and cancellation do not create a sequence, copy, interpretation or feedback.
Opening stops current speech; this path never starts speech or asks a model.

A local ref locks submission before React renders the pending state. Pending
feedback disables the input and all modal actions; Escape cannot dismiss it.
The existing parent operation gate and `expected_status=proposed` API guard are
retained. Successful feedback closes the dialog and returns focus to Change if
it is still usable, otherwise to the message heading. The message sequence and
keyboard are not edited by a phrase correction.

Errors retain the draft and review. The error says the response was not confirmed,
rather than claiming the write failed: the server might have committed it before
a connection was lost. Existing reconciliation reads the current sequence and
candidate without replaying feedback. If the candidate is no longer proposed,
another save is disabled and an explanation directs the person to the current
message. If recovery cannot read authoritative state, the parent's existing
write block remains until reload. A deliberate retry is available only while
the recovered proposal is still proposed and other write gates permit it.

Offline, local editing/review/cancellation remain available; saving is disabled.
Reconnection never queues a write. Draft text is component-local, discarded on
closing, reload, view or profile changes. No browser cache of correction text is
added. The current decision already pauses automatic formulation; opening this
modal neither retries it nor starts another request.

## Evidence and limits

`admin/tests/e2e/compact-phrase-correction.mjs` uses an isolated authenticated API,
synthetic profiles and an account with only communication/review rights. It first
checks that communication alone disables correction, then grants review explicitly.
It verifies preview without
writes, exact original pictograms and trimmed text, back/cancel/focus behavior,
an unsuccessful response, pending Escape and repeated submission, a committed
response lost in transit and a proposal rejected in another session. It also
covers offline dismissal, reconnect without writes, reload/profile reset,
unchanged sequence and keyboard, zero model requests and no speech. Captures at
1280/390/320 CSS pixels and a report join the `synthetic-pcl-learning` artifact.
The existing compact automatic-formulation journey tests correction through the
new review step, while detailed tools retain their existing correction action.

The dialog is viewport-bounded and internally scrollable; long text can require
scrolling within the textarea or dialog. Synthetic Chromium does not establish
real-device audio, screen-reader/browser behavior or participant usability.
These remain manual evaluation. No backend/schema/permission/provider change,
migration, deployed-profile mutation or deployment is required by this increment.
