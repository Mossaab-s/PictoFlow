# Three-space entry and navigation

This is the second functional increment after explicit profile capabilities (#77).
It implements entry, separate navigation and authorized aliases from the UX plan
in [UX_THREE_SPACES.md](UX_THREE_SPACES.md). It reuses the existing PCL endpoints,
keyboard editor, preparation preview, communication controller and memory views.

## Entry from effective grants

```text
                  /  -> current server session
                               |
              +----------------+-----------------+
              |                |                 |
          administrator    support grant     communication only
              |                |                 |
           /admin      /accompagnement       one profile -> keyboard
                                             several -> name cards
                                             none -> access explanation
```

Support grants are keyboard preparation, meaning management, history or export.
Review without communication also opens accompaniment. Communication plus review
alone keeps the communicator's direct entry. Mixed accounts default to support;
their support list excludes profiles assigned only for communication. Their
communication chooser independently filters for `communicate`.

Both lists come from the existing server-filtered profile collection and are
filtered again by the current effective capabilities. A stale legacy role label
never widens an explicit capability set. Export-only accounts do not load keyboard
collections in the person overview. Unnamed chooser cards use a local display
number, not an internal identifier.

## Spaces and reused tools

| Route | Visible purpose |
| --- | --- |
| `/admin` | Administrator overview with links to existing management/status screens |
| `/admin/profiles` | Profile creation/management and technical inspection |
| `/accompagnement` | Authorized supported people |
| `/accompagnement/personnes/{id}` | Person overview and read-only validated keyboard preview |
| `.../clavier` | Existing keyboard editor and stable-position workflow |
| `.../phrases` | Existing accepted/proposed memory and authorized shortcut preparation |
| `.../vocabulaire`, `.../dessins`, `.../liens` | Readable vocabulary, representations and semantic links |
| `.../propositions`, `.../historique` | Vocabulary needs and readable history, within actual grants |
| `.../sauvegarde` | Existing authorized export; no non-admin memory erasure |
| `/communication` | Minimal authorized keyboard chooser when needed |
| `/communication/{id}` | Existing standalone composer/keyboard |
| `/communication/{id}/memoire` | Existing personal memory with a simple return to the keyboard |
| `/offline` | Existing separate protected local-copy flow |

Administrator, supporter and communicator do not share a global navigation shell.
Technical JSON, canonical keys and record identifiers remain in admin inspection.
The readable vocabulary form submits a generated internal key to the existing
concept API; its key is retained after an uncertain write instead of retrying with
a new identity. It does not change concept or validation rules. Human decisions
remain in the existing per-item evidence views; the supporter history is a summary.

## Aliases and access changes

Authentication resolves the session and current route before mounting page data
loaders. `/` has no unconditional admin redirect. Non-admin `/admin` and
`/admin/profiles` bookmarks resolve to that account's own entry. Known old profile
tool URLs alias to their permitted accompaniment/communication destination. Old
communication URLs open the standalone keyboard for every account.

`resume=1` and profile-bound phrase query strings survive known profile aliases.
Destinations are constructed from the fixed internal route map; a `next` query
never determines navigation. Unknown/forbidden routes show a recovery link to the
account's own space without mounting the old admin shell or profile loaders.
FastAPI independently checks every underlying operation using #77's policy.
Existing expiry, cross-tab logout, local-copy cleanup and access-refresh behavior
are retained. Route changes recheck the session. Draft sequence references remain
profile-scoped and survive a deliberate editor/keyboard round trip.

## Validation and remaining increments

Frontend policy tests cover single/multiple/mixed/empty grants, independent tools,
legacy aliases and forbidden/unknown paths. The authenticated CI browser journey
uses isolated fictitious accounts against real FastAPI/PostgreSQL, checks denied
routes issue no profile API reads, and exercises mobile/tablet layouts, export,
direct keyboard entry and draft recovery. Existing PCL/browser journeys also run.
These checks do not substitute for usability sessions with the people concerned.

Communication presentation is still the existing controller. Further increments
simplify its secondary panels and improve supporter review workflows. Protected
accompanied handoff is still separate work: opening a keyboard in an adult's
session does not restrict that session to communication. Provider settings and
server maintenance remain their existing protected procedures. This change adds
no PCL schema, grant, provider or deployment changes.
