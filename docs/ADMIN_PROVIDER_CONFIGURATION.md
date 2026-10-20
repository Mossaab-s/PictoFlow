# Configure and test an AI provider in the administrator space

`/admin/providers` lets an authenticated administrator choose DisabledProvider,
FakeProvider, an OpenAI-compatible API or PRISM. Enter the base URL, exact model
identifier, JSON response format, timeout and optional temperature. An empty
temperature omits that parameter from compatible interpretation requests.

```text
Administrator edits a draft
        |
        +-- Test without saving
        |      metadata request + "Moi / Boire / Eau" synthetic interpretation
        |      structured result or redacted failure
        |      active configuration and personal PCL unchanged
        |
        +-- Save and activate (explicit action)
               compare expected configuration version
               persist operational settings in PostgreSQL
               subsequent requests use the new provider
               requests already started keep their provider snapshot
```

Testing may consume API credits. It sends three fixed fictitious touches, without
profile identifiers, personal examples or memory references. It never creates a
communication sequence, interpretation, validation or memory record. Metadata
availability and generation results are reported separately: a reachable model
catalogue does not demonstrate that the selected model can produce the expected
structured output. A structured sentence is not proof of correct personal meaning.
FakeProvider uses the bundled fixtures and may decline this unmatched example.
The combined test is bounded to 110 seconds, below the frontend proxy deadline.

## Activation and persistence

Until the first save, environment settings remain the source of configuration.
After saving, the singleton `ai_provider_configuration` takes precedence for
provider operations across restarts and API instances sharing the database.
Each operation reads a coherent configuration snapshot; applying another draft
does not close an in-flight request's HTTP client or rewrite its provenance.
There is no service restart or container environment rewrite during activation.

Settings are global to the installation, not personal vocabulary. The operational
table has no profile foreign key and is excluded from profile backup exports and
PCL semantic history. Saving records an administrative access event containing
only the version and provider type. It never validates a pending phrase or touch.

Migration `0014_provider_configuration` creates an empty table and leaves existing
PCL and account data intact. Downgrading refuses to discard saved settings.
Backend startup still requires a valid initial environment configuration.

## API keys and administration

Only authenticated administrators can read settings, test a draft or activate it.
Origin and CSRF checks apply to writes and tests, including accompanied sessions.
These editing routes are unavailable while account authentication is disabled.

The API returns `api_key_configured`, never a saved key or its suffix. Keys supplied
in the password field are not placed in browser storage or sent to the frontend
runtime environment. They can be kept, replaced or explicitly cleared. Keeping a
nonempty key requires the same normalized provider type and base URL; changing an
endpoint requires another deliberate key choice before any network call.

The API key is stored in a server-side operational PostgreSQL column, in plaintext
at rest under the database's access controls. Full server backups contain it and
must retain their existing private/encrypted handling. Profile exports never do.
The original environment key remains in the private server environment file but
is not used when a saved override clears or replaces it. No secret, remote error
body or authorization header is returned in diagnostics. Redirects remain disabled
in provider transports. Administrators can intentionally select local HTTP APIs.

## Concurrent edits and uncertain saves

Saving and testing require the version loaded by the form. PostgreSQL serializes
singleton creation and updates; stale drafts receive 409 before a provider call.
The form then requires an explicit reload. A lost save response also requires a
reload to discover the actual stored state; it never automatically repeats a PUT.
Reloading discards the form draft and clears an entered key. Testing does not save.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/providers/configuration` | Read settings and key-presence flag |
| `PUT /api/v1/providers/configuration` | Versioned explicit activation |
| `POST /api/v1/providers/test` | Probe an unsaved draft with synthetic input |
| `GET /api/v1/providers` | Existing metadata health for the active configuration |

## Verification

Unit coverage exercises key isolation, URL normalization, redacted provider errors,
synthetic request contents and independent in-flight provider lifetimes. PostgreSQL
tests cover actual cookies/CSRF/grants, version conflicts, restart persistence,
key keep/replace/clear, profile-export exclusion and runtime interpretation use.
The browser scenario `admin/tests/e2e/provider-settings.mjs` uses real authenticated
routes and a local HTTP completion fixture. It checks test-before-save, activation,
reload, key isolation, invalid/auth failures, concurrent updates, a lost committed
save response, mobile width and unchanged personal PCL. It restores DisabledProvider
afterward. It does not contact or certify a real external model.
