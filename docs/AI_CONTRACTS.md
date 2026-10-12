# Optional AI boundary contracts

AI-018 introduces Pydantic request/response models in
`backend/app/ai/contracts.py` and the structural `AIProvider` protocol in
`backend/app/ai/protocol.py`. These modules do not import repositories, database
adapters, HTTP clients or provider SDKs. The PCL domain does not import them.

## Interface

Every provider exposes a stable `provider_id` and four asynchronous operations:

| Operation | Request | Response |
| --- | --- | --- |
| `interpret` | `InterpretationRequest` | `InterpretationProposal` |
| `simplify` | `SimplificationRequest` | `SimplificationProposal` |
| `suggest_representation` | `RepresentationRequest` | `RepresentationProposal` |
| `health` | None | `ProviderHealth` |

The protocol describes method signatures. Its runtime structural check does not
validate returned data or verify that a concrete implementation is asynchronous.
Adapters must parse/revalidate external responses using the Pydantic models.
No provider receives a repository or a method to promote semantic state.

Credentials, prompts and routing are outside AI-018. AI-019 now implements
FakeProvider, DisabledProvider and a validation manager, documented in
[LOCAL_PROVIDERS.md](LOCAL_PROVIDERS.md). External integrations follow in
AI-020/AI-021. The API starts with AI operations disabled by default.

## Bounded requests

`InterpretationRequest` preserves the order and repeated selections of
`SelectedBlock` objects. Each block contains only its ID, selected label and
meaning supplied by the application. Optional `SemanticHint` objects describe
relations selected from validated PCL state. Context is a list of declared labels,
not an arbitrary profile object.

The application must select these objects within the active profile, check that
hints are validated, and decide which information may be sent. The transport
schema itself does not prove ownership, human approval or semantic truth.

`SimplificationRequest` carries bounded external text and optional allowed
meanings. `RepresentationRequest` receives meaning already approved by the
human workflow, an optional label and bounded representation constraints. It
does not contain an approval command or authorize block activation.

| Field | Development limit |
| --- | --- |
| Selected blocks | 1–32; order and repetition preserved |
| Declared context labels | At most 8, each at most 256 characters |
| Validated semantic hints | At most 16 |
| Semantic meaning text | 1–512 characters |
| Simplification input/output or candidate text | 1–4000 characters |
| Allowed meanings for simplification | At most 64 |
| Representation constraints | At most 8, each at most 256 characters |
| Representation label | 1–256 characters |
| Visual description | 1–2000 characters |
| Interpretation candidates | At most 3 |
| Provider metadata | At most 16 KiB in UTF-8 JSON |

Text fields reject whitespace-only values without trimming or rewriting the
person's expression. All requests include a bounded language identifier,
defaulting to `fr` for development; callers may specify another identifier.
These are initial transport limits, not clinical thresholds or final product
retention policy. Unknown fields, including whole-profile memory or credentials,
are rejected.

## Responses remain proposals

Interpretation returns either:

- `proposal`, with 1–3 candidates;
- `not_understood`, with no candidates.

Each candidate requires an intent key, text and finite numeric confidence in
`[0, 1]`. Strings such as `"0.8"`, booleans, NaN and infinity are rejected.
Simplification and representation responses always have `status="proposal"`;
their confidence is optional but obeys the same bounds when supplied.

No output accepts `validated`, `confirmed`, `corrected`, `active`, an activation
flag or a validation flag. PCL confidence-policy states such as
`confirmation_required` are also excluded from provider output. A provider
refusal is external evidence; the PCL retains ownership of the final handling
decision. A score of 1.0 remains unvalidated.

Example compatible with the architecture baseline:

```json
{
  "status": "proposal",
  "candidates": [
    {
      "intent": "LEAVE_DUE_TO_NOISE",
      "text": "Le bruit me gêne et je veux partir.",
      "confidence": 0.78
    }
  ]
}
```

Representation output suggests a label, optional visual description and spoken
text. It has no semantic update, asset activation or keyboard placement method.

## Optional metadata and health

Every response can omit metadata entirely. `ProviderMetadata` has optional
provider ID, trace ID, selected model/provider, routing confidence, latency,
token counts and cost. Confidence is bounded; counts and technical metrics must
be nonnegative and finite.

Vendor-specific fields belong under the optional JSON `extensions` object,
limited to 32 top-level entries and the total metadata byte limit. For example:

```json
{
  "trace_id": "trace-1",
  "routing_confidence": 0.9,
  "extensions": {
    "prism": {"domain": "communication", "refusal": false}
  }
}
```

Metadata is provenance, not validation or personal memory. Extension data is
opaque and must not drive PCL validation. No OpenAI/PRISM field is mandatory.

`ProviderHealth` requires generic `provider_id` and one of `available`,
`unavailable` or `disabled`. It may list the three supported operation names,
without duplicates, and provide a bounded technical error code. It does not
expose raw provider error text or require vendor metadata.

## Parsing and verification

Use `Model.model_validate(payload)` or `Model.model_validate_json(json_text)`.
Models reject extra fields, use finite/strict numeric constraints, revalidate
nested model instances and are frozen against ordinary field assignment.
Sequence/candidate collections are tuples. JSON schemas can be generated with
`Model.model_json_schema()`.

Do not use `model_construct()` or `model_copy(update=...)` as external-input
validation: those Pydantic APIs can bypass checks. The application boundary must
revalidate returned objects, including objects supplied by a local provider.
Metadata extensions contain JSON dictionaries and are not deeply immutable;
revalidation rechecks nested values and size limits.

Human confirmation is a separate domain operation. Pydantic schema validation
only checks the transport contract and never validates a meaning for the person.
Schema failures must be handled as provider errors without changing PCL state.
Formatted validation errors hide input values; technical logging should record
the error class/location rather than raw payloads or full validation-error data.

Unit tests cover each contract, JSON round trips/schema export, request bounds,
ordering, confidence boundaries, malformed candidates, refusal consistency,
attempted validation/activation, optional vendor metadata, metadata limits and
nested-instance revalidation. The isolated domain import test still runs with
third-party packages disabled.
