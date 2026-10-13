# Optional HTTP providers

AI-020 implements Chat Completions JSON mode against a configured compatible
endpoint; AI-021 implements PRISM's native `/api/v1/routing/query` contract.
Neither adapter receives a repository or a complete profile. Requests are built
from explicitly selected, scoped PCL data and passed through the provider manager.

## Configuration

Keep these server-side:

```ini
PICTOFLOW_AI_PROVIDER=openai-compatible
PICTOFLOW_PROVIDER_BASE_URL=http://127.0.0.1:11434/v1
PICTOFLOW_PROVIDER_MODEL=your-model-id
PICTOFLOW_PROVIDER_TIMEOUT_SECONDS=30
PICTOFLOW_PROVIDER_RESPONSE_FORMAT=json_object
# Optional authentication, set locally:
# PICTOFLOW_PROVIDER_API_KEY=...
```

For endpoints/models supporting strict Structured Outputs, set
`PICTOFLOW_PROVIDER_RESPONSE_FORMAT=json_schema`. The compatible adapter sends
the complete schema with `strict: true`. This remains opt-in so other compatible
endpoints can keep JSON Object Mode. The setting is forwarded by both Compose
stacks and is never a browser credential.

The deployed Groq model `qwen/qwen3.8-27b` supports strict mode according to the
[Groq Structured Outputs documentation](https://console.groq.com/docs/structured-outputs).
Enable this setting in the private server environment when deploying the phrase
schema correction. Real calls using synthetic data validated interpretation,
simplification and representation proposals in this mode.

For PRISM, configure its origin (without a `/v1` suffix), select `prism` mode and
provide its API key locally if required. The native adapter sends `X-API-Key`;
the compatible adapter sends Bearer authentication. Capabilities are configured
as a JSON tuple/list through `PICTOFLOW_PRISM_CAPABILITIES`; defaults are
`["interpret", "simplify"]`. Representation suggestion requires explicitly adding
`suggest_representation` when the endpoint/model supports structured proposals.
Unsupported capabilities raise `ProviderUnsupportedCapability` without a call.

PRISM integration was checked against the local PRiSm-Key153 routing router and
request/response schemas. Its query is bounded to 4000 characters; requests that
do not fit raise a typed payload error rather than silently losing context.
The adapter supplies no user ID, requests no full decision trace and does not
enable cloud/generalist bypass. PRISM routing policy remains owned by PRISM.

Use an address reachable from the backend process. Container-local `127.0.0.1`
does not reach a host provider. No credentials are exposed by the admin console,
provider-health endpoint or error responses.

## Parsing and failure

All three operations request JSON matching the PictoFlow proposal schema. The
compatible adapter defaults to `response_format={"type":"json_object"}` and verifies a
completed response before parsing. JSON mode does not imply schema validity;
Pydantic remains the authoritative transport check. See the official
[Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

Output schemas omit provider-owned metadata while retaining **all transitively
referenced `$defs`**. Dropping the scalar aliases used by candidate fields creates
dangling references and can result in an empty or invalid provider proposal,
which the API rejects with 502. Regression tests resolve every reference for all
three operations. In strict mode, all object properties are required and objects
are closed. Nullable scalars use explicit type unions. Interpretation uses a
transport-only `result` union to encode both allowed outcomes: a proposal with
one to three candidates, or a refusal with none. Pydantic still validates the
unwrapped proposal, including confidence bounds and prohibition of validation
commands. A malformed reply creates no interpretation or validated memory; the
completed selection remains available. The UI explains an unusable AI response
without displaying provider payloads.

Transport is bounded by timeout and a 1 MiB response limit, does not retry,
follow redirects, inherit proxy environment settings or log payloads. Base URLs
cannot contain credentials, queries or fragments. Errors contain static messages
with no raw response or secret URL. A malformed output creates no PCL state.

PRISM maps `model_response` into the same contracts, translates an interpretation
refusal to `not_understood`, and preserves available technical metadata: trace,
routed model/engine, classification confidence, domain, routing outcome, latency
and optional token/cost fields. Routing confidence is never PCL validation.

## No-provider operation and replacement

`InterpretationService` resolves blocks/concepts and at most 16 validated hints
within the active profile; contracts limit selections to 32 and declared context
to 8 items. A disabled/unavailable provider may fall back to literal selected
labels at .5 confidence. This is an unvalidated communication proposal, not an
inference about the person's intended meaning. Invalid provider output fails
explicitly instead of falling back into guessed knowledge.

The compatible adapter puts application rules in a system message and the
bounded request in a user message. In strict mode the output schema is sent only
through `response_format`, avoiding duplicate technical instructions in the user
turn. JSON Object Mode and PRISM still include the schema with the request.
This supplies the user turn required
by endpoints such as Groq while keeping request content explicitly treated as data.

## Message formulation prompts

Each operation has its own instructions, following common proposal-only and
data-not-instructions rules. Interpretation describes communication using words
or pictograms: express a short first-person message, preserve useful selected
words, order of meaning, repetition and negation, and avoid invented possession,
past events, actors, objects or causes. Explicitly selected emotions may be
expressed; association hints alone do not justify inventing an emotion or adding
an unselected word. Simple requests and standalone Yes/No/Stop do not require
inventing a narrative. Examples illustrate these rules, without becoming context
for the current message. Ambiguity may produce several proposals or refusal.

The scoped request builder sends readable concept labels in `meaning` and in
validated `semantic_hints`. Canonical keys such as `USER_...` remain unchanged in
PostgreSQL and are not exposed as semantic vocabulary. Block UUIDs still identify
the selected touches. A corrected touch label and its personal concept label can
differ; both are preserved. Proposed, rejected and foreign-profile relations
remain excluded. Only the bounded selected vocabulary and relevant validated
hints are sent, not the profile's complete memory.

The prompt lives in `backend/app/ai/providers/http.py`. Its interpretation
examples include Boire → « Je voudrais boire. », Maman + Boire + Eau →
« Maman, je voudrais boire de l'eau. », Manger + Oui → « Je voudrais manger,
oui. », Non + Manger → « Je ne veux pas manger. », and Content →
« Je suis content. ». A context such as
« sans préférence personnelle réelle » should not be inserted into a synthetic
formulation test: it can conflict with expressing a request. Synthetic test data
should be marked outside the model request, rather than by denying its content.

Strict JSON validates structure, not fidelity to the person's intended meaning.
The model's confidence remains a proposal score; confirmations and corrections
remain explicit human actions. Real comparisons use synthetic requests in a
separate process and do not write results into the PCL or change the running
provider configuration. Small comparisons are illustrative, not an accuracy
guarantee.

Changing provider configuration or closing its HTTP client does not migrate,
rewrite or erase PCL objects. Tests use mocked endpoints for all operations,
parsing failures, unavailable health, native PRISM metadata and unsupported
capabilities. These automated tests require no real model endpoint or paid call.
The deployed Groq integration was also checked with synthetic interpretation
and simplification requests on `qwen/qwen3.8-27b`, using the authenticated model
identifier returned by its catalogue. See the official
[Groq compatibility guide](https://console.groq.com/docs/openai) and
[server deployment configuration](SERVER_DEPLOYMENT.md).
