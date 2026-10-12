# Business API and technical observability

The business router exposes profile-scoped REST/JSON operations under `/api/v1`.
OpenAPI at `/docs` documents typed request and response schemas. No semantic
operation accepts a bare object UUID without profile scope.

| Path under `/api/v1/profiles/{profile_id}` | Operations |
| --- | --- |
| `/concepts` | List/create; rename by concept UUID |
| `/relations` | List/propose; confidence; human feedback; corrected replacement |
| `/representations` | List/create/update; human feedback; archive |
| `/blocks` | List/propose; human feedback; representation selection |
| `/sequences` | Start; scoped read by ID; selection/undo/clear/complete/cancel; completed history; interpretation |
| `/interpretations` | List; scoped read by ID; explicit confirm/correct/reject feedback |
| `/memory` | Separate validated/proposal reads; explicit DELETE erasure |
| `/suggestions` | List/detect gaps; human approval/rejection; proposed block creation |
| `/keyboard` | Read projection; explicit manual position/stability changes |
| `/audit` | Chronological history; optional typed target filter |

Profile identity inventory/creation are `/api/v1/profiles`; selected provider
health is `/api/v1/providers`. Feedback bodies require an explicit human role
and action. Only correction accepts/requires `corrected_value`. Relation meaning
correction uses the dedicated correction endpoint: the old relation is rejected
without changing endpoints, and a distinct replacement is accepted in the same
transaction, with the human correction and its derived rejection/confirmation
facts preserved.

Without a database, liveness remains available and business routes return 503.
`/api/v1/readiness` reports process health, observed Redis availability and whether
database configuration exists; it does not assert continuous database readiness.
All validation/provider/database errors return redacted, static messages.

Authentication remains outside the specified V1 administration/isolation issues.
The supplied launch commands bind to localhost. Profile scoping is not a login
or a permission model; this prototype is not a production access-control system.

## OpenTelemetry

Set `PICTOFLOW_OBSERVABILITY_ENABLED=true` for SDK traces, metrics and structured
technical logs. Default is disabled. No exporter, collector or vendor is required
or contacted automatically. Applications embedding the factory may attach a
standard span processor to `app.state.telemetry.traces`; the `Telemetry` class
also accepts a span exporter and metric reader for local tools/tests. See the
official [Python instrumentation guide](https://opentelemetry.io/docs/languages/python/instrumentation/).

Each HTTP response exposes `X-Trace-ID`. Enabled provider operations share the
request's trace context. Signals cover HTTP duration/status, provider duration
and success/failure/result state, database errors, Redis availability and process
health. Metrics contain bounded technical dimensions; profile UUIDs are omitted.

Only approved fields enter logs. Raw communication text, selected sequences,
request bodies, prompts, provider responses, SQL parameters, exception messages
and personal memory are not recorded. Exception auto-recording is disabled on
spans; failures record only their class. Tests inspect logs and exported spans
for payload leakage, verify parent/child correlation, metrics and disabled mode.
