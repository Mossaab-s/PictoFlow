# Three user spaces: audit, UX architecture and delivery plan

Status: **design proposal, before application changes**. Audited on 18 October
2026 against `main` commit `c9f58de287f6b00cb002b9d7dab0532259a129bf` (merged #75).
The POC remains the baseline; this is a restructuring of access and journeys,
not a replacement PCL, an AI migration or a backend rewrite.

Public project documentation is English. The proposed product interface is French.
The [clickable wireframes](design/three-spaces.html) use fictitious content and
run directly from a local file without dependencies, authentication or API calls.
They are a design artifact, not an alternative application or permission system.
The [preview gallery](design/README.md) also renders directly in GitHub.

## 1. What exists and must be preserved

| Working foundation                                                                                | Source inspected                                                                                                                                                                                                   | Reuse decision                                                                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Dedicated communication route, current message, undo/reset confirmation and optional human review | [`communication/[profileId]/page.tsx`](../admin/src/app/communication/[profileId]/page.tsx), [`communication-screen.tsx`](../admin/src/components/communication-screen.tsx)                                        | Keep sequence IDs, selection order, recovery and explicit human decisions; reshape presentation incrementally |
| Pictogram above its word, personal photos, pages, free spaces and stable anchors                  | [`keyboard-grid.tsx`](../admin/src/components/keyboard-grid.tsx), [`pictogram.tsx`](../admin/src/components/pictogram.tsx), [`keyboard_organization.py`](../backend/app/application/keyboard_organization.py)      | Keep shared rendering and server-checked move/removal previews; never auto-reorder                            |
| Keyboard creation/review/placement, 140 bundled drawings and preview                              | [`keyboard-editor.tsx`](../admin/src/components/keyboard-editor.tsx), [`keyboard-preparation-preview.tsx`](../admin/src/components/keyboard-preparation-preview.tsx), [catalogue](DAILY_PICTOGRAMS.md)             | Move into a supporter journey without recreating these APIs or the drawing catalogue                          |
| Local speech, size/contrast preferences and keyboard/mouse support                                | [`use-local-speech.ts`](../admin/src/components/use-local-speech.ts), [`communication-preferences.tsx`](../admin/src/components/communication-preferences.tsx)                                                     | Preserve profile-scoped preferences; only a deliberate action speaks                                          |
| Usual phrases, personal-memory word/phrase suggestions, correction/refusal/acceptance             | [`phrase-library.tsx`](../admin/src/components/phrase-library.tsx), [`memory-suggestions.tsx`](../admin/src/components/memory-suggestions.tsx), [`profile-memory.tsx`](../admin/src/components/profile-memory.tsx) | Offer concise communication views and richer supporter review of the same records                             |
| Optional AI, per-profile references, technical attempt evidence                                   | [`interpretation.py`](../backend/app/application/interpretation.py), [personal memory](PERSONAL_AI_MEMORY.md), [quality](AI_QUALITY.md)                                                                            | Preserve the provider boundary and provenance; AI failures must not block literal communication               |
| Personal accounts, many-to-many profile grants, CSRF, revocation and server authorization         | [`access.py`](../backend/app/api/access.py), [`application/access.py`](../backend/app/application/access.py), [`models.py`](../backend/app/infrastructure/postgres/models.py), [access guide](ACCESS_CONTROL.md)   | Extend this system only where the new permission matrix requires it                                           |
| Protected offline reopen/import, profile backup/restore and audit                                 | [offline guide](OFFLINE_REOPEN.md), [backup](PROFILE_BACKUP.md), [server backup](SERVER_BACKUPS.md), [`profile_archives.py`](../backend/app/api/profile_archives.py)                                               | Preserve encryption, ownership, explicit import and existing rollback/recovery guarantees                     |
| Existing regression coverage                                                                      | [`test_access.py`](../backend/tests/integration/test_access.py), [`access.test.mjs`](../admin/tests/access.test.mjs), [`tests/e2e`](../admin/tests/e2e), [usability guide](UX_USABILITY_SESSIONS.md)               | Adapt coverage with each increment; keep real usability evidence separate from automated checks               |

### Existing screens and routes

| Current route                        | What it does today                                                                    | Proposed destination                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/` and `/admin`                     | Redirect to `/admin/profiles` for every account                                       | An authenticated entry resolver; `/admin` becomes an administrator dashboard              |
| `/admin/profiles`                    | Authorized profile list, admin-only creation/restore, preparation/communication links | Admin profile management plus a separate supporter list and minimal communicator chooser  |
| `/admin/profiles/{id}/keyboard`      | Editor, page management and validated preview                                         | `/accompagnement/personnes/{id}/clavier` for authorized supporters                        |
| `/admin/profiles/{id}/communication` | Communication inside the admin shell                                                  | Redirect to the existing `/communication/{id}`                                            |
| `/admin/profiles/{id}/memory`        | Accepted/proposed messages, touches, meanings and relations                           | A supporter vocabulary/history view; communicator phrases remain a simple drawer          |
| `/admin/profiles/{id}/{section}`     | Concepts, representations, semantic space, suggestions, audit and backup              | Human-readable supporter tools where authorized; technical records remain under admin     |
| `/admin/access`                      | Existing account creation, grants, activation and password replacement                | Keep within administrator console; add explicit capability controls later                 |
| `/admin/providers`                   | **Read-only** provider availability/capabilities                                      | Keep status in admin; configuration is currently server-side, not an existing web form    |
| `/communication/{id}?phrase=…`       | Standalone keyboard with secondary tools and phrase shortcut                          | Preserve canonical path and profile-bound shortcut behavior; simplify its visible surface |
| `/offline`                           | Separate protected local unlock/reopen flow                                           | Preserve; do not turn it into an unauthenticated shortcut to server data                  |

### What is not already implemented

There is no `/accompagnement` space, role-based landing resolver, granular
supporter grant model, communication-only delegated session or unified global
administrator dashboard. Provider configuration uses server settings; global
backup/maintenance uses server procedures. The pictogram catalogue is bundled
code, not a browser-managed global registry. Do not draw functioning web controls
for these tasks until a real authorized API/procedure backs them.

## 2. What must change in the UX

1. **Entry:** authentication currently leads everyone through admin profile UI.
   A communicator with one authorized profile should arrive at that keyboard.
2. **Navigation:** profile tools and names such as Concepts, Representations,
   Semantic Space and AI Quality share the same navigation as everyday preparation.
   [`ProfileSection`](../admin/src/components/profile-section.tsx) displays internal
   identifiers and JSON record details. Keep this inspection in admin.
3. **Communication:** the dedicated route already avoids the admin sidebar, but
   secondary options still group preparation, voice, offline setup, personal
   meanings and rhythm. `CompositionMemory` and the model explanation can add long
   sections after a message. Keep only communication and a concise optional choice
   in the everyday surface; make history, setup and technical evidence deliberate
   destinations in the appropriate space.
4. **Support:** build around a person, their keyboard and decisions awaiting human
   attention, not a table of internal PCL entities. The editor and preview already
   perform most operations needed; give them a dedicated shell and readable steps.
5. **Permissions:** today's `communicator` and `editor` are profile access roles;
   `is_admin` is the global flag. Parent/professional are not authentication roles.
   `actor_role` on feedback describes provenance and must never grant permission.
6. **Destructive operations:** an existing `editor` can export a profile **and
   erase its PCL memory**. Hiding that button alone is insufficient. The new matrix
   must be enforced in FastAPI, with migration and tests for the intended change.
7. **Assisted access:** an adult opening a keyboard under their unrestricted
   session is currently just a presentation change. A protected handoff requires
   a server-enforced session scope and an authenticated return to adult tools.
8. **Technical administration:** organize existing operations first. Global
   telemetry, registry editing and settings need a separately scoped API decision,
   rather than fake controls or a broad backend rebuild.

These are findings from source inspection. No participant session, screen-reader
evaluation or clinical outcome has been established by this audit.

## 3. Architecture of the three spaces

```text
                      AUTHENTICATED ENTRY (/)
                                |
              +-----------------+------------------+
              |                 |                  |
       Administrator       Support access     Communication only
              |                 |                  |
          /admin         /accompagnement      1 profile -> keyboard
              |                 |             >1 -> simple chooser
       technical console  authorized people    0 -> friendly no-access
              |                 |                  |
              |          person dashboard      /communication/{id}
              |                 |                  |
              +-----------------+------------------+
                                |
                     existing Next API proxy
                                |
              FastAPI authorization on every operation
                                |
                  existing application services
                                |
                PostgreSQL: personal PCL and history
                                |
                optional AIProvider / transient Redis
```

### Target route map

```text
/                              entry from actual authenticated grants
/admin                         global console
  /profiles                    create/manage profiles and assignments
  /access                      accounts and per-profile capabilities
  /profiles/{id}/technical/...  technical profile inspection
  /providers                   provider status; real configuration stays protected
  /operations                  operational status/procedures, honest availability

/accompagnement                authorized supported people
  /personnes/{id}              person overview and keyboard preview
  /personnes/{id}/clavier      prepare/review/place drawings and words
  /personnes/{id}/phrases      accepted phrases and shortcut preparation
  /personnes/{id}/propositions human decisions and new vocabulary needs
  /personnes/{id}/vocabulaire  personal meanings and authorized history
  /personnes/{id}/preferences supported person's presentation preferences

/communication                 minimal authorized-profile chooser when needed
  /{id}                        personal keyboard, message, speech, undo/reset
                               usual phrases and optional proposal drawers
/offline                       existing protected local-copy portal
```

Use separate layouts and navigation for admin and accompaniment; the communicator
gets the whole application viewport without either sidebar. Full browser-screen
mode is an optional explicit action with a visible exit, not an automatic trap.
Existing credentials, API proxy paths and PCL identifiers do not change.

### Landing and navigation rules

- Use the current authenticated session and server grants, never a role from
  `localStorage`, a URL parameter or a feedback body. Do not mount protected page
  content or start its data loading while access/redirect is unresolved.
- Admin defaults to `/admin`. An account with supporter permissions defaults to
  `/accompagnement`. A communication-only account with exactly one profile opens
  `/communication/{id}` directly. With several, show only large name/avatar cards;
  with none, explain how an authorized adult can arrange access, without creation
  or system controls.
- A mixed account may accompany one profile and communicate with another. Select
  its default from effective grants; never assume that the account's person label
  determines all its rights. A supporter list contains only support-authorized
  people; separately authorized communication remains reachable deliberately.
- An administrator can deliberately open the other journeys for an authorized
  profile, but global navigation does not appear inside the keyboard.
- Old links remain controlled aliases. Preserve `resume=1`, profile-bound phrase
  links and valid local return targets. Do not redirect arbitrary `next` URLs or
  send a denied account into an admin/communication redirect loop.
- A direct forbidden URL renders a simple recovery path to that account's space;
  the API independently refuses its reads/writes. Access revocation and account
  changes invalidate mounted content and late responses as they do today.

### Reusable component boundaries

```text
Authentication / authorized entry
  + AdminLayout        -> AdminNavigation + existing access/status/technical tools
  + SupportLayout      -> PeopleList -> PersonOverview
  |                                      + KeyboardEditor + validated preview
  |                                      + ProposalReview + VocabularyHistory
  + CommunicationLayout -> existing communication controller
                           + MessageComposer + KeyboardGrid
                           + UsualPhrases drawer + optional human review

Shared: TouchContent, page/anchor renderer, local speech, display preferences,
        existing API client, source provenance, recovery and access predicates.
```

Keep the current communication state machine as the initial controller. Extract
presentation pieces one at a time under browser tests; do not create another
selection/validation engine or duplicate PCL-derived truth in React state.

## 4. Permissions matrix

**This table is the proposed target, not a claim about current authorization.**
All non-admin permissions are profile-scoped. Parent and practitioner share a
layout; their individual grants may differ, including between two people with
the same title. An administrator can perform all listed operations, with the
existing explicit confirmations and audit requirements.

| Operation                                                          | Administrator                      | Parent / practitioner / supporter                         | Communicator                                                                 |
| ------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| See a profile                                                      | All authorized admin scope         | Explicitly assigned people                                | Explicitly assigned personal keyboards                                       |
| Compose, undo/reset and read words                                 | Yes                                | `communicate` grant                                       | `communicate` grant                                                          |
| Request optional AI / choose a personal-memory proposal            | Yes                                | `communicate` grant                                       | `communicate` grant; explicit request                                        |
| Confirm/correct/refuse the communicated meaning                    | Yes, explicit human action         | `review_meanings` grant                                   | Explicit `review_meanings` grant; preserved for existing communicator grants |
| Read usual phrases for communication                               | Yes                                | `communicate` grant                                       | `communicate` grant                                                          |
| Configure shortcuts                                                | Yes                                | `prepare_keyboard` grant                                  | No preparation permission implied                                            |
| Add/review drawings, organize pages, place/move/remove touches     | Yes                                | `prepare_keyboard` grant                                  | No                                                                           |
| Change an established personal meaning or semantic relation        | Yes                                | `manage_meanings` grant, with validation/audit            | No preparation permission implied                                            |
| Review vocabulary-gap proposals and authorize a new block          | Yes                                | Appropriate `prepare_keyboard` / `manage_meanings` grants | No automatic creation; may express/decline their intended meaning            |
| View the readable personal vocabulary/history beyond usual phrases | Yes                                | `view_history` grant                                      | Only the communication information needed for their own choices              |
| Export a profile backup                                            | Yes                                | Explicit `export_profile` grant                           | No                                                                           |
| Erase PCL / restore a profile / manage global backups              | Yes, separate confirmed operations | No                                                        | No                                                                           |
| Create profiles, accounts or assignments                           | Yes                                | No implicit permission                                    | No                                                                           |
| View provider configuration, global logs or system settings        | Yes                                | No                                                        | No                                                                           |
| Enter a communication-only assisted session                        | Yes                                | `communicate` on the selected profile                     | Already in personal communication scope                                      |
| Return from assisted communication to preparation                  | Re-authenticate and recheck grants | Re-authenticate and recheck grants                        | Cannot elevate access                                                        |

Implementation should add a small explicit capability set to the current account
access layer, not turn job titles into hard-coded medical authority. A grant may
combine communication, keyboard preparation and review, or provide only one of
them; each API operation has a defined required capability. New endpoints deny
by default. Frontend affordances mirror, but never replace, these checks.

Migration of existing grants must be explicit and transactional: preserve
communicator composition/feedback and editor preparation/review/history/export
access on their existing profiles. Removing the legacy editor's memory-erasure
power is an intentional change to reach the requested admin-only maintenance
boundary; record and test it. Do not alter accepted PCL records or infer clinical
capacity from a role. Keep the existing stale-grant conflict mechanism when
editing permissions. Update both the session DTO and the frontend/API tests.

### Accompanied access without a personal password

```text
Adult authenticates -> chooses an authorized person -> Start accompanied session
                                                      |
                        server restricts/replaces this browser session
                        to communication + allowed review for this profile
                                                      |
                                  Person communicates with their keyboard
                                                      |
                                   Return to adult tools
                                                      |
                           adult re-authentication + current grant check
```

The person need not type an adult's password. Do not give them a hidden adult
session, a public profile URL, a permanent URL token or an invented default PIN.
The server must enforce the restricted scope on direct API requests too.
Retain the actual authenticating account and assisted-mode provenance for audit;
do not forge a child's account identity or infer who expressed a choice.

Account changes affect all tabs in the current implementation. A handoff must
invalidate unrestricted access in other tabs, late responses and browser-back
restoration; otherwise it is not a protected handoff. Ending/recovering an
expired session must not silently restore adult permissions. Device-specific
reauthentication convenience can be evaluated later without weakening this rule.
The first assisted implementation may be online-only; extending it to protected
offline copies needs an explicit ownership/scope design and tests. Existing
personal offline flows must remain available independently.

## 5. Wireframes and visual system

See [six navigable screens](design/three-spaces.html): communication, supported
people, person overview/review, keyboard preparation, administration and assisted
access. There is a **prototype navigation bar outside the mock application**;
it is not a role switcher intended for the real product. All data is fictitious.

### Communication: keyboard immediately, optional choice on demand

```text
+------------------------------------------------------------------+
| Lina                                      [Mes phrases] [Options]|
|                                                                  |
| Mon message : [Moi] [Boire] [Eau]                                 |
| [Parler]             [Annuler]             [Effacer]               |
|                                                                  |
| [Accueil] [Manger et boire] [Personnes] [Activites]                 |
|                                                                  |
|  +------------+ +------------+ +------------+ +------------+       |
|  |   dessin   | |   dessin   | |   dessin   | |   dessin   |       |
|  |    Eau     | |   Manger   | |   Maman    | |   Maison   |       |
|  +------------+ +------------+ +------------+ +------------+       |
|  Stable anchors retain their existing positions                   |
|                                                                  |
| [Une phrase ?] -> choice drawer -> [Oui] [Modifier] [Non]          |
| No dashboard, PCL graph, technical audit or preparation sidebar    |
+------------------------------------------------------------------+
```

Speech always reads the person's deliberate selection or deliberately chosen
phrase; a proposal is not auto-spoken or accepted. Reset keeps the existing
confirmation. The choice drawer is optional and does not move keyboard positions.

### Support: the person and their keyboard

```text
+-------------------+----------------------------------------------+
| Accompagnement    | Lina                         [Communiquer]   |
| Mes personnes     |                                              |
|                   | [Vue d'ensemble] [Clavier] [Phrases]          |
| Lina              | [A verifier] [Vocabulaire]                    |
| Noe               |                                              |
|                   | Apercu de son clavier    | A verifier        |
|                   | [dessin / mot] [...]     | 2 propositions     |
|                   | [Personnaliser]          | [Examiner]         |
|                   |                                              |
|                   | Evolution : changements acceptes seulement   |
|                   | No medical interpretation or system status   |
+-------------------+----------------------------------------------+
```

The keyboard editor leads with drawing + word, proposal review, explicit placement
and preview. A human-readable meaning editor can reuse concept/representation APIs
without exposing canonical keys, UUIDs or JSON. Removal and movement retain their
server preview and conflict checks. Show only controls granted to that supporter.

### Administrator: technical console

```text
+--------------------+---------------------------------------------+
| PictoFlow / Admin  | Vue d'ensemble                              |
| Vue d'ensemble     |                                             |
| Comptes et acces   | [Comptes] [Profils] [Services disponibles]    |
| Profils            |                                             |
| Moteur PCL         | Attributions       | Etat des services       |
| Fournisseurs IA    | [Gerer les acces]  | [Voir le diagnostic]    |
| Referentiels       |                                             |
| Audit              | Sauvegarde et maintenance                   |
| Maintenance        | Existing server procedure / API if available|
|                    | No fake success or unsupported web mutation |
+--------------------+---------------------------------------------+
```

### Shared design tokens and different complexity levels

| Dimension  | Shared rule                                                            | Communication                                                           | Accompaniment                          | Administration                                |
| ---------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| Identity   | Existing PictoFlow drawing language and personal photos                | Warm, quiet surface                                                     | Clear person-oriented cards            | Dense structured console                      |
| Typography | System font, readable labels, wrapping; no icon-only essential actions | Large word below drawing                                                | Plain French task labels               | Technical labels where useful                 |
| Actions    | Visible focus, generous spacing, predictable ordering                  | Target at least 56 CSS px for controls; retain larger touch preferences | Direct task buttons                    | Forms/tables with explicit states             |
| Color      | Neutral background, readable dark text; never color alone              | One primary speaking action                                             | Calm accent and explicit pending state | Neutral navigation and status with text       |
| Layout     | Responsive reflow, shared controls/tokens, no horizontal dependence    | Whole viewport; first useful row prioritized                            | Person navigation collapses on tablet  | Sidebar collapses on narrow screens           |
| Motion     | Respect reduced motion                                                 | No decorative motion or surprise rearrangement                          | No animation needed for completion     | No distracting status polling                 |
| Disclosure | Preserve data, expose only relevant tasks                              | Phrases/choice in drawers; simple voice options                         | Review/history on demand               | Raw diagnostics only here and when authorized |

Focus, reduced motion, forced colors, 200% native zoom, large touches and actual
installed voices must be checked on intended devices. These design targets do not
constitute an accessibility certification. Existing approved placements and blank
anchor spaces take precedence over fitting more items into the viewport.

## 6. Incremental implementation plan

Each item gets at least one **draft PR targeting `main`** and its own validation.
Merge only after review. Start the next code branch from updated `main` after its
dependency merges; avoid another chain of parent-branch merges (#74 documented why).
No deployment of unmerged changes. This design delivery does not modify the app.

| Order | Increment                                            | Reviewable result and verification                                                                                                                                                                      |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Audit, architecture and wireframes — this delivery   | Existing/target behavior distinguished, six mock screens, permission matrix, no application changes                                                                                                     |
| 1     | Capability/access foundation                         | Extend existing account grants and exact endpoint policy, define migration; real backend tests for each capability, cross-profile denial, forged roles, revocation, export and admin-only erasure       |
| 2     | Role landing and separate route/layout shells        | Admin/support/communication entries, one/many/no-profile paths, authorized mixed accounts, controlled legacy aliases; no unauthorized content flash or request                                          |
| 3     | Communication surface — first functional UX priority | Reuse current controller/grid/speech/reset; reduce visible tools, preserve phrases and optional review, tablet/full-viewport behavior; literal communication works with AI disabled                     |
| 4     | Supporter people dashboard and keyboard preparation  | Only assigned people, accurate read-only preview, drawing/word preparation, stable placements, pages and explicit conflict-aware moves/removals; no technical identifiers or destructive admin controls |
| 5     | Supporter meaning review and readable evolution      | Authorized proposal correction/refusal/acceptance, vocabulary needs, shortcuts and traceable accepted changes; no automatic medical interpretation or PCL mutation on view                              |
| 6     | Administrator console organization                   | Existing account/profile/provider/audit tools under one console; real operational procedures clearly distinguished from missing web capabilities; no provider secrets sent to the browser               |
| 7     | Protected accompanied session                        | Adult-initiated profile-scoped server session, reauthenticated return, all-tab invalidation, expired/revoked/back-button cases and no privilege restoration through a URL                               |
| 8     | Whole-journey verification and usability sessions    | Real authenticated browser personas and API denial tests, tablet/mouse/keyboard/offline/AI-disabled regression, then sessions with communicators/parents/practitioners; record actual observations only |

Access is a short foundation step; after it, communication is the first functional
screen delivered, followed by accompaniment. Backend changes stay in the existing
account/session layer except for a separately justified missing API. PCL services,
schemas and personal truth remain shared and authoritative.

### Validation gates for every functional increment

- Check actual backend authorization, not only mocked frontend roles. Extend
  [`test_access.py`](../backend/tests/integration/test_access.py), including an
  editor losing memory-erasure access and new limited capability combinations.
- Keep existing PCL isolation, source-revocation, acceptance, idempotency, move
  preview, photo, sequence and personal-memory tests. No route transition, reading
  or screen opening may accept a meaning or send an AI request automatically.
- Extend the isolated [`PCL workflow`](../.github/workflows/pcl-poc.yml) with real
  authenticated admin/supporter/communicator/mixed accounts, multiple granted and
  ungranted profiles, revoked access and the accompanied session. Existing mocked
  UI session checks remain useful for layout but are not authorization evidence.
- Check old deep links, phrase links, missing-word return, account changes across
  tabs, browser back, narrow/large-touch layouts, focus, speech Stop and explicit
  offline import. Do not cache authenticated admin/support pages for offline use.
- Preserve deployment backup and before/after PCL/photo/placement checks. Any
  access migration must leave the meaning records and audit history untouched.
- Follow the [usability-session guide](UX_USABILITY_SESSIONS.md) with familiar
  vocabulary and the person's consent to participate/stop. Record assistance and
  actual feedback; never infer emotion or capacity from typing rhythm.

### Separate existing AI follow-up

The diagnosed Groq/Qwen JSON-generation errors, overly strict idiomatic grounding
and indistinct literal-fallback reasons are **not fixed by a layout refactor**.
Track them as a separate functional correction, preserve optional AI and make the
fallback understandable in the new communication view. Do not mix that correction
with this audit or silently change the model/provider configuration.

## Audit delivery evidence

The source inventory, authorization policy, endpoint families and relevant test
cases above were inspected against the pinned revision. The standalone wireframes
were checked as design artifacts in a local headless browser: all six screens at
320, 390, 768 and 1280 CSS pixels (24 reflow/navigation checks), without horizontal
overflow, JavaScript errors or external network requests. Representative mobile
and desktop screenshots were visually inspected. This is not an application,
authentication or participant-usability test. This documentation-only delivery does
not rerun or claim new application test results, change account permissions, create
profiles, modify PCL data, access production or deploy a new UI.
