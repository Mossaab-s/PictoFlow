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
# Optional authentication, set locally:
# PICTOFLOW_PROVIDER_API_KEY=...
```

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
compatible adapter uses `response_format={"type":"json_object"}` and verifies a
completed response before parsing. JSON mode does not imply schema validity;
Pydantic remains the authoritative transport check. See the official
[Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

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
bounded request/schema in a user message. This supplies the user turn required
by endpoints such as Groq while keeping request content explicitly treated as data.

Changing provider configuration or closing its HTTP client does not migrate,
rewrite or erase PCL objects. Tests use mocked endpoints for all operations,
parsing failures, unavailable health, native PRISM metadata and unsupported
capabilities. These automated tests require no real model endpoint or paid call.
The deployed Groq integration was also checked with synthetic interpretation
and simplification requests on `qwen/qwen3.8-27b`, using the authenticated model
identifier returned by its catalogue. See the official
[Groq compatibility guide](https://console.groq.com/docs/openai) and
[server deployment configuration](SERVER_DEPLOYMENT.md).
