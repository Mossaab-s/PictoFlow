# PictoFlow

**Personal Communication Layer and adaptive communication interface**

PictoFlow is an open research and development project exploring a new way to build personalized Augmentative and Alternative Communication (AAC/CAA) systems.

The central idea is simple:

> **The communication system should progressively adapt to the person instead of forcing the person to adapt to a fixed tool.**

PictoFlow is not designed around one AI model.

Its core is the **PCL — Personal Communication Layer**: a persistent layer that owns the person's communication memory, validated semantic relationships, communication blocks, confidence state and semantic evolution.

---

## Why PictoFlow?

Existing AAC systems already provide excellent foundations:
- pictogram keyboards;
- personalized boards;
- text-to-speech;
- prediction;
- context-aware suggestions;
- symbol libraries;
- AI-assisted message generation.

PictoFlow does **not** try to replace this work.

The project focuses on a narrower research question:

> Can we build a persistent **Personal Semantic Space** that belongs to one user, evolves only through controlled validation, and remains portable across interfaces, pictogram sets and AI models?

---

## Core idea

A pictogram is not the meaning.

An AI model is not the memory.

The PCL owns the meaning.

```
USER
 |
 v
COMMUNICATION INTERFACE
keyboard / symbols / text / future interfaces
 |
 v
PCL — PERSONAL COMMUNICATION LAYER
 |
 +-- Personal Memory
 +-- Personal Semantic Space
 +-- Communication Sequences
 +-- Validation / Correction
 +-- Confidence / Refusal
 +-- Semantic Gap Detection
 +-- Communication Block Management
 +-- Semantic Evolution Audit
 |
 v
OPTIONAL AI PROVIDER
 |
 +-- GPT
 +-- Mistral
 +-- Claude
 +-- local model
 +-- future model
```

The PCL must remain usable without an external AI provider.

---

# 1. PCL — the core of PictoFlow

The PCL is the project's source of truth.

It owns:
- personal concepts;
- semantic relations;
- communication blocks;
- communication sequences;
- validated memory;
- unvalidated proposals;
- corrections and rejections;
- confidence values;
- Semantic Gap candidates;
- semantic evolution history.

### Fundamental rule

> **AI proposes. PCL controls. Human validates, corrects or rejects.**

An external model can never directly create validated semantic truth.

---

# 2. Personal Semantic Space

Each user has an isolated semantic space.

Example:

```
User A

NOISE
 +-- HEADPHONES
 +-- DISCOMFORT
 +-- LEAVE
```

Another user may have:

```
User B

NOISE
 +-- MUSIC
 +-- CAR
 +-- PLAY
```

The same concept does not automatically imply the same personal associations.

Relations are profile-specific.

No relation is propagated automatically between users.

---

# 3. Concept is not representation

PictoFlow explicitly separates semantic identity from visual representation.

```
Concept != Pictogram
```

Example:

```
Concept: DRINK

Representations:
- text: "Boire"
- pictogram
- personal image
- generated visual
- spoken output
```

This is important for:
- personalization;
- accessibility;
- interoperability;
- licensing;
- changing pictogram libraries without losing meaning.

This direction is compatible with the idea behind the W3C AAC Symbol Registry, which provides semantic mappings across AAC symbol sets.

---

# 4. Communication Blocks

A `CommunicationBlock` is a selectable communication object.

A block can represent:
- one concept;
- one validated intent;
- one validated shortcut.

A block can be:

```
stable
adaptive
```

Stable blocks must never move automatically.

New PCL-created blocks initially enter the adaptive space.

---

# 5. Communication sequences

The user communicates by selecting ordered blocks.

Example:

```
NOISE -> STOP -> LEAVE
```

Order is significant.

A completed sequence does not automatically become semantic knowledge.

It becomes evidence only through the validation workflow.

---

# 6. Validation

Every semantic proposal must support:

```
confirm
correct
reject
```

Authority order:

```
human correction
    >
human confirmation
    >
PCL inference
    >
external AI proposal
```

Corrections never erase the original proposal.

The history remains auditable.

---

# 7. Confidence and refusal

PictoFlow must be capable of saying:

> **I do not understand yet.**

Initial configurable development defaults:

| Confidence | PCL behaviour |
|---|---|
| >= 0.90 | proposal, still correctable |
| 0.65–0.89 | explicit confirmation required |
| 0.40–0.64 | up to three hypotheses |
| < 0.40 | `not_understood` |

These values are not clinical thresholds.

A refusal creates no semantic knowledge.

---

# 8. Memory model

PCL memory is separated into:

### Session memory
Current communication only.

### Context memory
Temporary declared context.

### Proposal memory
Unvalidated hypotheses.

### Validated personal memory
Long-term validated semantic state.

Temporary events must never silently become long-term personal truth.

---

# 9. Semantic Gap

A key PictoFlow research concept is the **Semantic Gap**.

Working definition:

> A recurrent and validated communication intent for which the user's communication space does not yet provide an efficient dedicated representation.

Example:

```
NOISE + STOP + LEAVE
```

Repeated several times and repeatedly validated as:

```
"The noise bothers me and I want to leave."
```

If no dedicated active block represents that intent:

```
=> Semantic Gap Candidate
```

This does **not** automatically create a pictogram.

---

# 10. Controlled creation

The creation flow is deliberately controlled.

```
Semantic Gap Candidate
        |
human approval
        |
CommunicationBlock Candidate
        |
semantic meaning
        |
optional visual proposal
        |
human validation / modification / rejection
        |
active adaptive block
```

The PCL initiates the process.

A generative model may help create a visual representation, but it never decides the meaning and never activates the result.

---

# 11. Adaptive keyboard

The keyboard is a **projection of PCL state**.

It does not own meaning.

Initial logical zones:

### Stable zone
Critical validated blocks with fixed positions.

### Personal zone
User-specific active communication vocabulary.

### Adaptive zone
Validated but non-stable blocks.

The keyboard must remain usable when AI services are unavailable.

---

# 12. AI portability

AI providers are optional and replaceable.

Expected provider-neutral operations:

```
interpret()
simplify()
suggestBlockRepresentation()
health()
```

A provider:
- receives bounded context from the PCL;
- returns unvalidated proposals;
- cannot write directly into the semantic space;
- can be disabled;
- can be replaced without rebuilding the user's communication memory.

---

# 13. Interoperability

PictoFlow should build on existing AAC standards instead of inventing unnecessary proprietary formats.

Research targets include:
- **W3C AAC Symbol Registry**
- **Open Board Format (OBF / OBZ)**
- **OpenAAC logging formats**

The internal PCL model may remain richer while exposing compatible projections.

---

# 14. Symbol licensing

Symbol assets and semantic concepts are separate objects.

Every external visual representation should preserve:
- source;
- source reference;
- license;
- attribution;
- commercial-use permission.

Example: ARASAAC currently distributes its pictograms under **CC BY-NC-SA**, which excludes commercial use under the standard permission.

This is why PictoFlow must never treat one symbol library as the semantic foundation of the product.

---

# 15. What PictoFlow is not

Current project boundaries:

PictoFlow does **not** perform:
- autism diagnosis;
- medical diagnosis;
- clinical assessment;
- automatic emotion recognition;
- continuous behavioural video analysis;
- medical recommendations;
- autonomous interpretation of unknown gestures;
- global semantic learning across users.

PictoFlow is currently an **assistive communication research project**.

---

# 16. First MVP scope

The first implementation should cover:

- UserCommunicationProfile;
- Concept;
- Representation;
- CommunicationBlock;
- SemanticRelation;
- CommunicationSequence;
- Interpretation;
- ValidationEvent;
- memory separation;
- confidence and refusal;
- SemanticGapCandidate;
- controlled block creation;
- stable/adaptive keyboard projection;
- semantic audit trail;
- AI provider abstraction;
- deterministic no-provider end-to-end test.

The V1 stack is defined in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the
accepted [architecture decisions](docs/ADR/): Python/FastAPI, Pydantic,
SQLAlchemy/Alembic, PostgreSQL, Redis and Next.js/TypeScript administration.
AI providers remain optional and replaceable.

---

# 17. First end-to-end scenario

Known validated relations:

```
NOISE -> DISCOMFORT : 0.91
NOISE -> LEAVE      : 0.84
```

User selects:

```
NOISE -> STOP -> LEAVE
```

Expected lifecycle:

1. keyboard emits selections;
2. sequence preserves order;
3. PCL generates or receives a proposal;
4. confidence determines handling;
5. user confirms, corrects or rejects;
6. validation is recorded;
7. validated memory changes only after validation;
8. audit records the history;
9. validated repetition may create a Semantic Gap candidate;
10. approved gap may create a block candidate;
11. human validation activates the new adaptive block;
12. stable blocks remain unchanged.

---

# 18. Research foundation

PictoFlow is informed by active AAC research and existing standards.

Important starting references include:

- **SPICA — IUI 2026**  
  Personalized knowledge base architecture for AAC users.  
  https://doi.org/10.1145/3742413.3789116

- **I, Robot? — CHI 2026**  
  Ultra-personalized AAC, agency, identity and privacy.  
  https://doi.org/10.1145/3772318.3790310

- **CPR-SAT — SoftwareX 2026**  
  Modular context-aware pictogram recommendation.  
  https://doi.org/10.1016/j.softx.2026.102635

- **SpeakFaster — Nature Communications 2024**  
  LLM-assisted AAC with communication-effort measurements.  
  https://www.nature.com/articles/s41467-024-53873-3

- **Pectogram — ASSETS 2025**  
  Generative AI for dynamic PECS-style cards.  
  https://doi.org/10.1145/3663547.3759706

- **UC Berkeley Personalized Communication Companion — 2025**  
  Pictograms, context, user profiles and LLM-based generation.  
  https://www.ischool.berkeley.edu/projects/2025/personalized-communication-companion

- **W3C AAC Symbol Registry**  
  https://www.w3.org/TR/aac-registry/

- **Open Board Format / OpenAAC**  
  https://www.openboardformat.org/docs  
  https://www.openaac.org/docs

A more detailed review is available in:

**[docs/RESEARCH_LANDSCAPE.md](docs/RESEARCH_LANDSCAPE.md)**

---

# 19. Functional specification

The current functional baseline is documented in:

**[docs/FUNCTIONAL_SPECIFICATION.md](docs/FUNCTIONAL_SPECIFICATION.md)**

The technical implementation baseline is defined separately in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Embeddings, final end-user UI,
symbol library and production hosting remain open decisions. PostgreSQL is
the V1 persistent store; a dedicated graph database is deferred. No external
AI provider is required.

---

# 20. Development roadmap

Start with the technical foundation in this order:

**#14 → #15 → #16 → #18 → #19 → #22**.

Profile isolation (#24) is required from the first repositories and cache keys.
Define the PCL-001 and REP-013 domain contracts before finalizing the DB-015
persistence mappings. AI-018/AI-019 implement the concrete contracts and local
providers covered by the broader AI-011 ownership requirements.

Then continue with the functional roadmap:

1. **PCL Core**
2. **Personal Semantic Space**
3. **Personal Memory**
4. **Communication Sequences**
5. **Validation / Correction / Rejection**
6. **Confidence / Refusal**
7. **Semantic Gap Detection**
8. **Controlled CommunicationBlock creation**
9. **Adaptive Keyboard projection**
10. **Semantic Evolution Audit**
11. **AI Provider abstraction**
12. **End-to-End PCL scenario**

See the repository Issues tab for detailed acceptance criteria.

---

# 21. Contributors wanted

PictoFlow requires more than software development.

Contributions and critical review are especially welcome from:
- AAC/CAA users;
- speech-language therapists / orthophonists;
- educators;
- caregivers;
- accessibility specialists;
- software architects;
- developers;
- AI / NLP researchers;
- HCI researchers;
- privacy and security specialists;
- legal / GDPR / AI Act specialists;
- researchers working on assistive communication.

The project should be built **with the people concerned, not only for them**.

---

# 22. Project status

**Early development / research phase**

The FastAPI bootstrap (#14) provides health endpoints, environment configuration
and domain boundary tests. PostgreSQL persistence (#15) adds profile-scoped
repositories, initial PCL mappings and an Alembic migration. See
[backend/README.md](backend/README.md) for local setup, migrations and verification,
and [docs/PERSISTENCE.md](docs/PERSISTENCE.md) for storage boundaries. Optional Redis
transient storage (#16) now provides profile-scoped keys, mandatory TTLs and
explicit disabled/unavailable behavior; see
[docs/TRANSIENT_STORAGE.md](docs/TRANSIENT_STORAGE.md).
The optional AI boundary (#18) now defines bounded Pydantic contracts and an
async provider protocol; see [docs/AI_CONTRACTS.md](docs/AI_CONTRACTS.md).
Local providers (#19) now support deterministic fixture-based testing and an
explicit disabled mode, with request/response revalidation; see
[docs/LOCAL_PROVIDERS.md](docs/LOCAL_PROVIDERS.md).
The local Compose setup (#22) is available in
[deploy/docker-compose.yml](deploy/docker-compose.yml), with startup, migration,
test and verification instructions in [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).
PCL-001 supplies the independent domain core and explicit interpretation feedback;
see [docs/PCL_CORE.md](docs/PCL_CORE.md). SEM-002 adds personal semantic operations,
validated neighbour queries and atomic PostgreSQL history;
see [docs/SEMANTIC_SPACE.md](docs/SEMANTIC_SPACE.md).
The complete local prototype now includes memory, sequence lifecycle, human
feedback, confidence/refusal, Semantic Gaps, controlled blocks, keyboard projection,
audit, representations, optional HTTP providers and the initial administration.
See [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md) for the acceptance
map, verification and a disposable demo. A LAN test instance is deployed on
[10.0.0.121:3000](http://10.0.0.121:3000). Server deployment and backup commands
are documented in [docs/SERVER_DEPLOYMENT.md](docs/SERVER_DEPLOYMENT.md).
The profile's AI quality report and synthetic evaluation command are described
in [docs/AI_QUALITY.md](docs/AI_QUALITY.md).
Local TLS, certificate trust and account activation are described in
[docs/LOCAL_HTTPS.md](docs/LOCAL_HTTPS.md).
Encrypted server backups and isolated recovery rehearsals are described in
[docs/SERVER_BACKUPS.md](docs/SERVER_BACKUPS.md).
Personal accounts, per-profile permissions and activation after HTTPS setup are
documented in [docs/ACCESS_CONTROL.md](docs/ACCESS_CONTROL.md).

Current priorities:
- validate the semantic model;
- challenge the concept with AAC professionals and users;
- validate the integrated prototype with realistic communication scenarios;
- refine the end-user interface and accessibility through user feedback;
- measure communication efficiency before expanding the AI layer.

---

## Principle to keep

> **The LLM is replaceable. The person's communication space is not.**
