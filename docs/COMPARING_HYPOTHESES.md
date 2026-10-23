# Compare phrase hypotheses before validating

## Compact communication

The main communication screen exposes `Comparer (2)` or `Comparer (3)` when
multiple actual candidates exist. This replaces the narrow native dropdown.
The action opens a native modal dialog with complete phrase texts and a radio
group. There are no invented alternatives, model intent tags or confidence
percentages. A single candidate retains its direct review actions.

```text
Original pictograms + current phrase
                 |
          Compare (2 or 3)
                 |
      Full texts + radio selection
      Explicit local listen / stop
                 |
         Return to message
                 |
       Speak / correct / refuse / accept
```

Mouse selection and native arrow keys change only the inspected candidate.
Opening, inspecting, closing and listening submit no feedback and make no model
call. `Revenir au message` closes the dialog; it does not accept the phrase.
The existing `C’est ça`, `Changer` and `Pas ça` actions remain on the main screen.
Only explicit feedback changes the personal memory.

The dialog can explicitly read the selected full phrase with the configured local
voice. Changing the inspected phrase or closing the dialog stops speech. Escape
first stops an ongoing reading; a subsequent Escape closes the dialog. Focus
returns to the comparison button, or the message heading if that button is no
longer usable. Native modal behavior keeps keyboard navigation within the dialog.
New candidate identities or feedback statuses close a stale comparison.

Refused proposals remain identifiable as `Proposition écartée`; inspecting them
does not restore them. After acceptance, the accepted phrase is displayed and
comparison is disabled. Reload recovery still reads candidate IDs and current
server statuses. The original pictograms, keyboard positions and literal reading
are preserved.

Long texts wrap inside the dialog. A short viewport can scroll the dialog to read
the complete list and reach its actions; the underlying compact communication
document keeps its layout. This does not add persistent phrase drafts or a new
server API.

Browser CI extends `compact-communication.mjs` to cover 320, 390, 1024 and 1280
pixel widths, three long choices, mouse and arrow-key selection, explicit speech,
Escape, focus return, no implicit API writes, individual refusal, acceptance and
reload. Its deliberately repetitive long texts stress layout only; they are not
examples of good model interpretations. The fixture adapter is isolated from
production and calls no external model. Real voices, assistive technology and
participant usability still need manual checks.

## Detailed communication tools

When two or three phrases survive interpretation, the communicator sees their
complete texts together. A native radio group selects the phrase whose existing
reading, correction and human-feedback actions are displayed below the list.
Mouse clicks and keyboard arrow keys work without an AI request, speech or PCL
write. A single proposal keeps the direct review card.

The first phrase is initially displayed for inspection. This is not acceptance or
a statement that its meaning is certain. No model intent label or percentage is
presented as a personal fact. The application does not manufacture alternatives.

Reading remains explicit and reads only the displayed phrase. Changing the inspected
phrase stops a reading that is already in progress. Switching between
choices preserves unsent correction drafts within the current page. Those drafts
are not saved in browser storage and do not survive a reload.

Refusing a phrase changes only that interpretation. Other phrases remain
available for inspection. After acceptance or correction, the accepted phrase is
displayed and the choice group is disabled. Other hypotheses are neither accepted
nor automatically refused. Starting another message remains a separate action.

Recovery continues to store all candidate IDs, not phrase text. On reopening,
current server statuses determine which accepted phrase is displayed; otherwise
the first available choice is shown. An old local inspection ID cannot select a
phrase outside the current candidates. Source explanations, role permissions,
memory-first reuse, the 24-hour pending cache and explicit refresh are unchanged.

Browser CI uses the real FakeProvider with three controlled meanings to verify
mouse/keyboard comparison, explicit local reading, no implicit learning,
individual refusal, correction draft retention, accepted-phrase recovery and
single-memory-proposal behavior. It checks 320, 390 and 1280 pixel layouts.
These synthetic checks do not establish real-model interpretation quality or
participant usability.
