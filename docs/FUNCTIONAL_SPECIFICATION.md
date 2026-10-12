# PictoFlow Functional Specification — Working Baseline

## 1. Purpose

PictoFlow is an assistive communication project centered on a **Personal Communication Layer (PCL)**.

The project explores a communication system that adapts progressively to one person's validated communication habits without making an AI model the owner of that person's language.

PictoFlow is currently a research and development project.

It is **not** currently presented as:
- a diagnostic system;
- a medical decision tool;
- an emotion-recognition system;
- a replacement for a speech-language therapist;
- a system that autonomously interprets a person's behaviour.

---

## 2. Product vision

> Build a communication tool that adapts to the person instead of forcing the person to adapt to the tool.

The visible interface may be a pictogram keyboard.

The core product is not the keyboard.

The core product is the **PCL**.

---

## 3. Core architecture

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
OPTIONAL AI PROVIDER LAYER
 |
 +-- GPT
 +-- Mistral
 +-- Claude
 +-- local model
 +-- future provider
```

The external model is replaceable.

The PCL is not.

---

## 4. PCL responsibilities

The PCL is the single source of truth for the personal communication system.

It owns:
- concepts;
- semantic relations;
- communication blocks;
- validated sequences;
- temporary proposals;
- confirmed interpretations;
- corrections;
- rejections;
- confidence values;
- Semantic Gap candidates;
- history of semantic evolution.

The PCL must work without an external LLM.

---

## 5. Concept versus representation

This separation is mandatory.

```
Concept != Pictogram
```

A concept represents meaning.

A representation expresses that meaning through an interface.

Example:

```
Concept:
DRINK

Possible representations:
- text "Boire"
- pictogram
- personal photo
- generated visual
- spoken output
```

Changing the representation must not change the concept identity.

---

## 6. Personal Semantic Space

Each user has a separate semantic space.

Example:

```
Profile A

NOISE
 +-- HEADPHONES
 +-- DISCOMFORT
 +-- LEAVE
```

Another profile may have:

```
Profile B

NOISE
 +-- MUSIC
 +-- CAR
 +-- PLAY
```

No relation is transferred automatically from Profile A to Profile B.

### Relation requirements

A semantic relation must have:
- source;
- target;
- type;
- confidence;
- validation state;
- validation count;
- rejection count;
- history.

Confidence is not validation.

---

## 7. CommunicationBlock

A CommunicationBlock is a selectable communication object.

It may represent:
- a concept;
- a validated intent;
- a validated shortcut.

A block may have:
- label;
- visual representation;
- spoken text;
- semantic reference;
- stability status;
- origin;
- validation status.

### Stability

```
stable
adaptive
```

A newly approved PCL suggestion enters as `adaptive`.

Stable items must never move automatically.

---

## 8. Communication sequence

A communication sequence is an ordered list of selected blocks.

Example:

```
NOISE -> STOP -> LEAVE
```

Order matters.

This sequence is different from:

```
LEAVE -> STOP -> NOISE
```

Completing a sequence does not automatically create semantic knowledge.

---

## 9. Validation model

Every important semantic proposal must support:

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

A correction must preserve the original proposal in history.

---

## 10. Confidence and refusal

Every interpretation candidate has a confidence value.

Initial configurable product defaults:

```
>= 0.90
direct proposal, still correctable

0.65 - 0.89
confirmation required

0.40 - 0.64
up to three hypotheses

< 0.40
not_understood
```

These values are development defaults, not clinical thresholds.

The PCL must be able to return:

```
not_understood
```

No semantic knowledge is created from a refusal.

---

## 11. Memory model

The PCL must separate at least:

### Session memory

Current interaction only.

### Context memory

Temporary declared context relevant to the current communication.

### Proposal memory

Unvalidated hypotheses.

### Validated personal memory

Long-term validated semantic information.

Temporary interaction history must never become long-term truth automatically.

---

## 12. Semantic Gap

Working definition:

> A recurrent and validated communication intent for which the user's current communication space has no efficient dedicated representation.

Initial development conditions:

- repeated sequence;
- same validated intent multiple times;
- no existing active block already represents that intent.

Initial test defaults:

```
minimum occurrences = 5
minimum validated same-intent events = 4
```

These are implementation defaults only.

### Important rule

A Semantic Gap creates a candidate.

It does not create a pictogram automatically.

---

## 13. Controlled block creation

```
Semantic Gap Candidate
        |
human approval
        |
CommunicationBlock Candidate
        |
label + semantic meaning
        |
optional visual proposal
        |
human validation / modification / rejection
        |
active adaptive block
```

An external AI can propose a representation.

It cannot activate a block.

---

## 14. Keyboard model

The keyboard is a projection of PCL state.

It does not own semantic knowledge.

Required logical zones:

### Stable zone
Essential validated elements with fixed positions.

### Personal zone
User-specific active vocabulary.

### Adaptive zone
Validated but non-stable elements.

The keyboard must remain usable when external AI is unavailable.

---

## 15. AI provider abstraction

External AI is optional.

Required provider-neutral capabilities:

```
interpret()
simplify()
suggestBlockRepresentation()
health()
```

Provider rules:
- output is always unvalidated;
- provider cannot write directly into PCL state;
- provider receives only bounded context supplied by the PCL;
- provider can be disabled;
- switching provider does not migrate the semantic space.

---

## 16. Audit

Semantic evolution must be traceable.

Audit events include:
- concept creation/update;
- relation proposal/validation/rejection;
- interpretation proposal/confirmation/correction/rejection;
- Semantic Gap creation;
- block proposal/validation/rejection;
- stability changes.

Audit is append-only.

History is not the same as validated semantic memory.

---

## 17. Symbol and representation licensing

Every external visual representation must retain:
- source;
- source reference;
- license;
- attribution;
- commercial-use status.

This is mandatory because symbol libraries use different licenses.

The semantic layer must never depend on ownership of one particular symbol asset.

---

## 18. Interoperability direction

PictoFlow should investigate compatibility with:
- W3C AAC Symbol Registry;
- Open Board Format (OBF / OBZ);
- OpenAAC logging standards.

The PCL may remain richer internally while exposing/importing interoperable projections.

---

## 19. MVP boundaries

### Included

- one UserCommunicationProfile;
- concepts;
- representations;
- CommunicationBlocks;
- semantic relations;
- communication sequences;
- validation / correction / rejection;
- confidence / refusal;
- memory separation;
- Semantic Gap candidates;
- controlled block creation;
- stable + adaptive keyboard projection;
- audit;
- optional provider abstraction;
- deterministic no-provider end-to-end scenario.

### Explicitly excluded

- diagnosis;
- automated clinical assessment;
- emotion recognition;
- continuous video analysis;
- automatic interpretation of untrained gestures;
- medical recommendations;
- global learning across users;
- automatic activation of AI-generated pictograms;
- requirement for a cloud LLM.

---

## 20. Initial end-to-end scenario

Known validated relations:

```
NOISE -> DISCOMFORT : 0.91
NOISE -> LEAVE      : 0.84
```

Stable/adaptive blocks allow:

```
NOISE -> STOP -> LEAVE
```

Expected flow:

1. user selects the blocks;
2. sequence preserves order;
3. PCL produces or receives an interpretation proposal;
4. confidence policy determines next action;
5. human confirms/corrects/rejects;
6. validation event is stored;
7. validated memory changes only after explicit validation;
8. audit stores the history;
9. validated repetition may create a Semantic Gap candidate;
10. approved gap may create a new CommunicationBlock candidate;
11. human validation activates the new adaptive block;
12. stable keyboard items remain unchanged.

---

## 21. Success metrics for first prototype

Measure functional communication, not "AI intelligence".

Candidate metrics:
- actions required per validated message;
- time to complete message;
- correction rate;
- rejection rate;
- abandoned sequences;
- reuse rate of personal blocks;
- number of proposals resulting in validated Semantic Gaps;
- reduction in interaction effort after a new block is introduced.

---

## 22. Open questions

These remain intentionally undecided:

- programming language;
- frontend framework;
- database technology;
- graph storage technology;
- embedding model;
- LLM provider;
- pictogram generation provider;
- final UI design;
- final symbol library;
- clinical validation protocol;
- regulatory qualification;
- retention periods;
- production hosting architecture.

They must not be silently decided in implementation issues without an explicit project decision.
