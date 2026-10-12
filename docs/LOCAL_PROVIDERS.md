# Local providers without external AI

AI-019 implements `FakeProvider` and `DisabledProvider` behind the AI-018
protocol. They receive no persistent repositories, make no network requests and
cannot write or validate semantic state. Both use the same Pydantic contracts
that future external providers will use.

## Configuration and backend startup

| Variable | Default | Behavior |
| --- | --- | --- |
| `PICTOFLOW_AI_PROVIDER` | `disabled` | Choose `disabled` or `fake` |
| `PICTOFLOW_FAKE_PROVIDER_FIXTURES` | Unset | Absolute UTF-8 JSON fixture path; unset uses bundled samples |

The FastAPI lifespan creates the selected provider manager at
`app.state.ai_provider`. No external endpoint, credentials, PostgreSQL or Redis
is required to initialize these providers. Configuration is separate from the
PCL semantic state, so switching modes does not migrate or delete personal data.

From `backend/`, start the local API with the bundled fake examples:

```powershell
$env:PICTOFLOW_AI_PROVIDER = "fake"
.venv\Scripts\python -m uvicorn app.main:app --reload
```

The provider is an application component; this issue does not add public AI or
business endpoints. `/health` still reports API process liveness. Application
code can call `await app.state.ai_provider.health()` for provider health.

## DisabledProvider

`health()` returns `provider_id="disabled"`, `status="disabled"` and no
capabilities. `interpret`, `simplify` and `suggest_representation` raise the
documented `ProviderDisabledError`, a subtype of `ProviderUnavailableError`.
They do not fabricate a meaning or pretend an operation succeeded.

Disabled mode does not read a configured fake fixture file. The backend remains
usable for its independent PCL/persistence work; future application workflows
must handle the typed disabled result explicitly.

## FakeProvider

Fixture configuration contains up to 128 entries per operation. Each entry has
one bounded request and one unvalidated response:

```json
{
  "interpretations": [
    {
      "request": {
        "blocks": [
          {
            "block_id": "00000000-0000-0000-0000-000000000001",
            "label": "Bruit",
            "meaning": "NOISE"
          }
        ]
      },
      "response": {
        "status": "proposal",
        "candidates": [
          {"intent": "NOISE", "text": "Il y a du bruit.", "confidence": 0.78}
        ]
      }
    }
  ],
  "simplifications": [],
  "representations": []
}
```

All fixture requests/responses are parsed with the AI-018 contracts. A validated
or active response is rejected during configuration. Duplicate requests within
one operation are also rejected, including duplicates with different responses.

Matching uses canonical JSON of the complete parsed request. JSON object key
order is irrelevant, while block order/repetition, IDs, labels, meanings,
declared context, semantic hints, language and operation-specific constraints
all affect matching. Default fields are included consistently.

An unknown request raises `ProviderFixtureNotFound`. It does not trigger an
inference, generic fallback or invented `not_understood` result. A refusal must
itself be explicitly configured as an interpretation fixture with
`status="not_understood"` and no candidates.

Responses are captured as serialized snapshots and parsed again on every call.
Each caller gets a detached response. Mutating a caller's metadata or the
original configuration cannot change later results. Health is deterministic:
`status="available"`, `provider_id="fake"`, and only operations with configured
entries appear in its capabilities. An empty fake configuration has no entries
and advertises no capabilities.

## Bundled development examples

`backend/app/ai/fixtures/local.json` contains synthetic examples for:

- `NOISE → STOP → LEAVE` returning the proposal
  “Le bruit me gêne et je veux partir.” at confidence 0.78;
- an explicit unknown-meaning refusal;
- simplification of the example message;
- a proposed label and visual description for its already-approved meaning.

The UUIDs are fixed synthetic block identifiers. Use these exact request objects
for the bundled examples, or supply a custom fixture file for your own test
identifiers/context. The fixture package is included in the built Python wheel.

## Validation manager and errors

`ProviderManager` wraps one configured provider. It checks the asynchronous
protocol, validates requests before calling it, revalidates returned objects and
checks declared provider provenance against the configured ID. Missing optional
metadata remains valid. It does not route between providers or apply the PCL
confidence policy.

| Failure | Result |
| --- | --- |
| AI operation in disabled mode | `ProviderDisabledError` |
| No exact fake fixture | `ProviderFixtureNotFound` |
| Invalid request, response or health/provenance | `ProviderPayloadError` |
| Missing/invalid fixture file, duplicates or invalid local provider | `ProviderConfigurationError` |

Errors contain static technical messages rather than raw communication,
response payloads or credential details. Invalid fake configuration fails
explicitly; it does not silently change modes.

The provider outputs are still only proposals. Schema validation and fixture
matching never perform human confirmation, correction, semantic promotion,
block activation or persistent writes.

## Verification and remaining work

Tests exercise deterministic outputs for all operations, exact request matching,
refusal, missing fixtures, duplicate/invalid configuration, response snapshot
isolation, disabled mode, network-call blocking, protocol checks and manager
revalidation/provenance. A backend boundary scenario starts FastAPI in fake mode
and calls all three operations through its configured application component.
This is not the full E2E-012 human-validation/semantic-gap/keyboard workflow,
which still depends on the functional issues.

A PostgreSQL integration test seeds a profile, concepts, stable validated blocks
and a validated relation, compares all profile-owned tables before/after a fake
proposal, then switches to disabled mode and checks the persisted state again.
No provider-generated semantic state is created and existing state remains
available.

Run local provider tests without any database or network service:

```powershell
.venv\Scripts\python -m pytest tests/test_local_providers.py
```

The full suite and local PostgreSQL/Redis helpers are documented in
[backend/README.md](../backend/README.md). Docker Compose development setup is
next in DEPLOY-022; external AI providers remain optional later work.
