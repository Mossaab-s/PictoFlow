# Technical Architecture V1

## 1. Goal

Define the initial technical architecture for PictoFlow V1.

The architecture must support:
- a Python-based PCL core;
- a FastAPI backend;
- PostgreSQL as persistent source of truth;
- Redis for cache and transient state;
- a TypeScript administration interface;
- optional AI providers;
- PRISM as an optional test/integration provider;
- a generic OpenAI-compatible provider;
- local-first behaviour for the future end-user communication interface.

This document defines the first implementation baseline.

---

## 2. Architecture overview

```
                    USER INTERFACE
             future keyboard / client app
                         |
                         v
                  PictoFlow API
                    FastAPI
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
       PCL Core      PostgreSQL       Redis
          |
          +-- Personal Semantic Space
          +-- Personal Memory
          +-- Communication Sequences
          +-- Validation
          +-- Confidence / Refusal
          +-- Semantic Gap Detection
          +-- Communication Block Engine
          +-- Semantic Audit
          |
          v
               AI Provider Manager
          +--------------+-----------------+
          |              |                 |
          v              v                 v
      FakeProvider   PRISMProvider   OpenAICompatible
                                          |
                           +--------------+--------------+
                           |              |              |
                           v              v              v
                         vLLM           Ollama        other endpoint
```

The administration interface is separate:

```
Admin UI
Next.js + TypeScript
        |
        v
   PictoFlow API
        |
        v
       PCL
```

The Admin UI never reads PostgreSQL directly.

---

## 3. Technology choices

### Backend
- Python
- FastAPI
- Pydantic
- SQLAlchemy
- Alembic
- pytest

### Persistent storage
- PostgreSQL

### Cache / transient state
- Redis

### Admin interface
- Next.js
- TypeScript

### AI integration
- internal `AIProvider` abstraction;
- `FakeProvider`;
- `DisabledProvider`;
- `PRISMProvider`;
- `OpenAICompatibleProvider`.

### Deployment
- Docker Compose for V1.
- local development setup: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

### Observability
- OpenTelemetry compatible instrumentation.

No Kubernetes is required for V1.

---

## 4. Backend package structure

```
backend/
├── app/
│   ├── api/
│   ├── application/
│   ├── domain/
│   │   └── pcl/
│   ├── infrastructure/
│   │   ├── postgres/
│   │   └── redis/
│   ├── ai/
│   │   ├── contracts.py
│   │   ├── manager.py
│   │   └── providers/
│   │       ├── fake.py
│   │       ├── disabled.py
│   │       ├── prism.py
│   │       └── openai_compatible.py
│   └── main.py
├── migrations/
└── tests/
```

### Dependency rule

`app/domain/pcl` must not import:
- FastAPI;
- SQLAlchemy;
- Redis;
- PRISM;
- OpenAI SDKs;
- HTTP clients;
- UI code.

The domain must remain pure Python business logic.

---

## 5. PCL ownership boundaries

The PCL is the authoritative owner of:
- concepts;
- representations;
- semantic relations;
- communication blocks;
- communication sequences;
- validated memory;
- proposal memory;
- validation events;
- confidence decisions;
- Semantic Gap candidates;
- semantic evolution state.

External AI providers do not own these objects.

---

## 6. PostgreSQL responsibilities

PostgreSQL is the persistent source of truth for validated and auditable PCL state.

Initial persistent entities include:
- user_communication_profile;
- concept;
- representation;
- communication_block;
- semantic_relation;
- communication_sequence;
- interpretation;
- validation_event;
- semantic_gap_candidate;
- semantic_audit_event.

### Rule

Persistent semantic truth must never exist only in Redis.

---

## 7. Redis responsibilities

Redis is used for:
- short-lived session state;
- temporary context;
- temporary provider results;
- provider health cache;
- rate limiting;
- short-lived semantic search cache;
- distributed locks if required later.

Redis is **not** the source of truth for:
- validated semantic relations;
- personal long-term memory;
- confirmed communication blocks;
- audit history.

Recommended key patterns:

```
pcl:session:{profile_id}:{session_id}
pcl:provider-health:{provider_id}
pcl:cache:semantic:{profile_id}:{hash}
```

TTL must be used for transient data where appropriate.
Personal cache keys must always include profile scope, including hashed lookups.
See [TRANSIENT_STORAGE.md](TRANSIENT_STORAGE.md) for the CACHE-016 adapter contract
and explicit no-Redis/unavailable behavior.

---

## 8. AI Provider abstraction

Define one provider-neutral interface.

Illustrative contract:

```python
class AIProvider(Protocol):
    async def interpret(
        self,
        request: InterpretationRequest
    ) -> InterpretationProposal:
        ...

    async def simplify(
        self,
        request: SimplificationRequest
    ) -> SimplificationProposal:
        ...

    async def suggest_representation(
        self,
        request: RepresentationRequest
    ) -> RepresentationProposal:
        ...

    async def health(self) -> ProviderHealth:
        ...
```

Provider output is always a proposal.

A provider must never mutate PCL repositories directly.
The implemented protocol lives in `backend/app/ai/protocol.py`; its Pydantic
models and bounded input/output rules are documented in
[AI_CONTRACTS.md](AI_CONTRACTS.md).

---

## 9. Required providers

### FakeProvider

Purpose:
- deterministic automated tests;
- local development;
- end-to-end tests without network access.

### DisabledProvider

Purpose:
- explicit no-AI mode;
- prove PCL remains operational without an AI backend.

### OpenAICompatibleProvider

Purpose:
- connect to any compatible endpoint through configurable:
  - base URL;
  - API key;
  - model identifier.

Target compatibility includes:
- vLLM;
- Ollama where compatible;
- LM Studio;
- internal gateways;
- future OpenAI-compatible systems.

### PRISMProvider

Purpose:
- optional PictoFlow integration with PRISM;
- first advanced provider used for development/testing;
- preserve access to PRISM-specific metadata when available.

Possible PRISM metadata may include:
- trace ID;
- selected model;
- routing confidence;
- domain;
- provider;
- refusal;
- latency;
- cost/token information.

These fields must remain optional.

PictoFlow must not require PRISM to operate.

---

## 10. Structured AI responses

Free-form provider text must not be directly applied to PCL state.

Provider responses must first be validated against Pydantic contracts.

Example:

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

If provider output cannot be parsed into the expected contract:
- return a provider error;
- do not create semantic knowledge.

---

## 11. Admin interface

Technology:
- Next.js
- TypeScript

Initial admin sections:

```
/admin/profiles
/admin/profiles/{id}/concepts
/admin/profiles/{id}/representations
/admin/profiles/{id}/semantic-space
/admin/profiles/{id}/keyboard
/admin/profiles/{id}/memory
/admin/profiles/{id}/suggestions
/admin/profiles/{id}/audit
/admin/providers
```

The admin interface must communicate only through PictoFlow API endpoints.

No direct database connection from Next.js.

---

## 12. API style

Use REST + JSON.

FastAPI-generated OpenAPI is the first API contract.

Domain state transitions must be explicit endpoints/actions rather than silent side effects.

Examples:

```
POST /api/v1/profiles
POST /api/v1/profiles/{id}/concepts
POST /api/v1/profiles/{id}/sequences
POST /api/v1/interpretations/{id}/confirm
POST /api/v1/interpretations/{id}/correct
POST /api/v1/interpretations/{id}/reject
POST /api/v1/semantic-gaps/{id}/approve
POST /api/v1/semantic-gaps/{id}/reject
```

Endpoint details remain implementation tasks.

---

## 13. Security baseline

Mandatory from V1:
- every profile-scoped query must include profile scope;
- no cross-profile semantic query;
- API keys remain server-side;
- secrets are never shipped to clients;
- logs must not contain raw communication content by default;
- external provider calls receive bounded context only.

Repository-level queries must always enforce profile isolation.

---

## 14. Observability

Use OpenTelemetry-compatible tracing/metrics/logging.

Do not log raw personal communication payloads by default.

Prefer technical metadata such as:
- event type;
- pseudonymous/profile hash if needed;
- sequence length;
- confidence;
- provider;
- duration;
- result state.

---

## 15. Vector search

Vector search is **not required for V1**.

If later required, the preferred first option is PostgreSQL + pgvector.

Embeddings must remain assistive search signals only.

```
embedding similarity != validated semantic relation
```

No embedding similarity can directly create validated PCL knowledge.

---

## 16. Explicitly rejected for V1

Do not introduce:
- microservices;
- Kubernetes;
- Kafka;
- Neo4j;
- Elasticsearch;
- mandatory LLM dependency;
- fine-tuning pipeline;
- autonomous agents;
- continuous multimodal surveillance;
- facial emotion recognition.

These may only be reconsidered after validated product need.

---

## 17. Repository target structure

```
PictoFlow/
├── backend/
│   ├── app/
│   ├── migrations/
│   └── tests/
├── admin/
├── docs/
│   ├── FUNCTIONAL_SPECIFICATION.md
│   ├── RESEARCH_LANDSCAPE.md
│   ├── ARCHITECTURE.md
│   └── ADR/
└── deploy/
    └── docker-compose.yml
```

---

## 18. Architecture rule to preserve

> The PCL must remain portable across databases, interfaces and AI providers.

The PCL domain must be testable without:
- PostgreSQL;
- Redis;
- FastAPI;
- PRISM;
- an LLM;
- the admin interface.
