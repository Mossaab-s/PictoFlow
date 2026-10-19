# Find and organize existing touches

The keyboard editor's **Modifier les touches et leurs places** section now starts
with compact drawing-and-word cards instead of one visible placement form per
validated touch. Each card shows its current page, zone and one-based place. The
list follows the server's existing order; filtering never sorts the keyboard or
closes blank places.

```text
[Search word or personal meaning________] [Show: All touches v]
6 of 6 touches

  [drawing]          [drawing]             [drawing]
  Mon verre          Maman                 Livre
  Home / place 3     All pages / place 1    Activities / place 5
  Edit this touch    Edit this touch       Edit this touch
        |
        +-> existing word / image / page / place controls
                   -> preview -> explicit confirmation
```

Search uses only validated touches belonging to the selected profile and their
personal meanings (or canonical intent for an intent-based touch). All search
terms must match, ignoring case, accents and the French ligature `œ`. It does not
look up general catalogue synonyms, query an AI provider or use another profile's
vocabulary.

Filters distinguish **all touches**, **Accueil**, **stable anchors** and each
active named page. A page filter shows the touches assigned to that page; global
stable anchors have their own filter. Their cards explicitly say **Toutes les
pages**. An empty search offers a reset button which restores all cards and
focuses the search field. If a selected page disappears on refresh, the effective
filter returns to all touches.

## Local edits and direct links

Cards use native expandable controls, available to both pointer and keyboard.
Their editing content is first mounted when opened, so an unopened card does not
render another full pictogram picker. After opening, closing or filtering out the
card retains its local fields, photo choice and pending preview. The summary's
word and location always describe the last server state, not an unsaved draft.
Local drafts and filters reset when leaving the profile; no new browser storage
is used.

The placement links under **Mes touches souvent choisies** clear filters, open
the target card and focus it. This also works when following the same fragment a
second time. Entering the editor with a touch fragment opens that card after the
profile loads. Revealing a card does not save a placement or review a phrase.

Existing placement forms retain their contracts: moves within a non-stable zone
require a server preview and explicit confirmation; direct zone changes use the
existing explicit placement action. Occupied or stale destinations remain
rejected by the server, the preview is cleared after a failed confirmation, and
writes are never replayed automatically. If a successful move hides the focused
card under the active filter, focus returns to search. Browsing and placement do
not alter accepted personal memory.

## Validation

Unit checks cover scoped searches, personal meanings and intent-only touches,
accent handling, page/global-anchor distinctions and location labels with blank
places. The authenticated browser scenario uses a preparation-only account and
real profile APIs. It covers retained local edits, repeated direct links,
keyboard activation, empty searches, occupied and concurrently stale previews,
cancel/confirm, stable positions, profile reset and a 320px viewport. Screenshots
use synthetic vocabulary. The complete POC journey opens the compact card before
placing a stable anchor.

These checks do not establish usability for a particular communicator or replace
testing with actual users, assistive technologies and device settings.
