# Research Landscape — PictoFlow

> Working document. This file summarizes relevant AAC/CAA research, standards and existing initiatives that inform PictoFlow.
>
> PictoFlow is **not** presented here as a medical device, diagnostic system or clinical decision tool. The current project scope is assistive communication.

## 1. Why this research matters

PictoFlow must not reinvent existing AAC concepts.

The research landscape already contains:
- personalized AAC interfaces;
- context-aware pictogram recommendation;
- LLM-assisted AAC;
- dynamic pictogram generation;
- open symbol registries;
- interoperable AAC board formats;
- personalized language models;
- research on agency, identity and privacy in personalized AAC.

The project should therefore focus its research contribution on the part that appears less directly covered:

> A **Personal Communication Layer (PCL)** that owns a persistent, validated **Personal Semantic Space**, independent from the selected AI model and independent from any single pictogram representation.

---

## 2. Existing work relevant to PictoFlow

### 2.1 SPICA — Scalable and Personalized Conversational Agent Framework for AAC Users

**Conference:** IUI 2026  
**DOI:** https://doi.org/10.1145/3742413.3789116

SPICA dynamically indexes and restructures user-relevant information into a personalized knowledge base. It retrieves that knowledge on demand to guide conversation and preserve personalization without requiring the same personalization mechanism to be embedded directly in the base model.

### Relevance to PictoFlow

SPICA strongly supports the idea that personal communication knowledge should live outside the base LLM.

PictoFlow should go further in a different direction:
- structured semantic concepts;
- semantic relations;
- validation state;
- confidence;
- communication blocks;
- Semantic Gap detection;
- explicit refusal;
- model portability.

---

### 2.2 I, Robot? Exploring Ultra-Personalized AI-Powered AAC

**Conference:** CHI 2026  
**DOI:** https://doi.org/10.1145/3772318.3790310

This work studied an ultra-personalized AAC system using months of one AAC user's communication data.

The paper identifies major tensions around:
- agency;
- identity;
- privacy;
- resurfacing personal information in inappropriate contexts;
- the risk that a personalized model selectively amplifies or suppresses parts of a user's identity.

### Relevance to PictoFlow

This work supports a fundamental PictoFlow rule:

> The LLM must not be the authoritative memory of the person.

The PCL must control:
- what is remembered;
- what is validated;
- what is context-specific;
- what can be sent to an external model;
- what can be deleted;
- what remains only a proposal.

---

### 2.3 CPR-SAT — Context-aware pictogram recommendation system

**Publication:** SoftwareX, 2026  
**DOI:** https://doi.org/10.1016/j.softx.2026.102635

CPR-SAT uses a modular architecture separating:
1. linguistic normalization;
2. semantic retrieval;
3. contextual re-ranking.

The published evaluation reports strong pictogram prediction performance and a four-week study with faster communication and fewer interaction taps.

### Relevance to PictoFlow

Important architecture lesson:

> Semantic retrieval and context adaptation do not have to be implemented as one opaque LLM call.

PictoFlow should remain modular and interpretable.

---

### 2.4 SpeakFaster

**Publication:** Nature Communications, 2024  
**Article:** https://www.nature.com/articles/s41467-024-53873-3

SpeakFaster explores LLM-assisted AAC input for eye-gaze typing users and measures reduction in motor actions.

### Relevance to PictoFlow

PictoFlow should measure communication efficiency.

Candidate metrics:
- number of selections required to express a validated intent;
- time to message completion;
- number of corrections;
- number of abandoned sequences;
- reuse rate of newly created communication blocks.

The goal is not only "AI accuracy".

The relevant question is:

> Does the system make communication easier while preserving user agency?

---

### 2.5 Pectogram

**Conference:** ASSETS 2025  
**DOI:** https://doi.org/10.1145/3663547.3759706

Pectogram uses generative AI to transform text into PECS-style image cards and supports custom uploads and generated content to bridge vocabulary gaps.

### Relevance to PictoFlow

Dynamic pictogram generation already exists as a research direction.

Therefore this is **not** PictoFlow's primary innovation.

PictoFlow's intended distinction is:

> The PCL detects a validated, recurrent communication need with no efficient representation and then starts a controlled creation workflow.

Generation is only one possible step in that workflow.

---

### 2.6 Personalized Communication Companion — UC Berkeley

**Project:** UC Berkeley School of Information, 2025  
**URL:** https://www.ischool.berkeley.edu/projects/2025/personalized-communication-companion

The project combines:
- ARASAAC pictograms;
- user profiles;
- context;
- LLM-generated sentences;
- caregiver customization;
- pictogram comprehension testing.

### Relevance to PictoFlow

This is close to the initial PictoFlow concept.

PictoFlow should distinguish itself through:
- PCL ownership of semantic state;
- explicit concept/representation separation;
- validated semantic relations;
- explicit confidence and refusal;
- Semantic Gap detection;
- provider independence.

---

## 3. Standards and interoperability

### 3.1 W3C AAC Symbol Registry

**Specification:** https://www.w3.org/TR/aac-registry/

The W3C registry, co-published with Blissymbolics Communication International, contains more than 5,000 AAC concepts/symbol references and is designed to support semantic mapping between symbol sets.

### Architectural consequence

PictoFlow must separate:

```
Concept
    !=
Representation
```

A personal concept should be able to reference several representations.

Example:

```
Concept: DRINK

Representations:
- text: "Boire"
- pictogram set A
- pictogram set B
- personal photo
- generated visual
- audio representation
```

The semantic identity must survive if the visual representation changes.

---

### 3.2 Open Board Format (OBF / OBZ)

**Documentation:** https://www.openboardformat.org/docs  
**OpenAAC docs:** https://www.openaac.org/docs

Open Board Format provides an open representation for AAC communication boards and allows users to import/export personal vocabulary between AAC products.

OpenAAC also documents an Open Logging Format for AAC session data.

### Architectural consequence

PictoFlow should not invent a proprietary board format unless required.

Future interoperability should consider:
- OBF / OBZ import;
- OBF / OBZ export;
- mapping PictoFlow CommunicationBlocks to interoperable board representations.

The PCL semantic model can remain richer than OBF while offering an interoperable projection.

---

## 4. Symbol libraries and licensing

### ARASAAC

**Terms:** https://arasaac.org/terms-of-use

ARASAAC resources are distributed under **CC BY-NC-SA**.

Important consequence:
- non-commercial use is allowed under the stated license and attribution requirements;
- commercial use is excluded without specific authorization.

PictoFlow must never store a pictogram asset without its provenance and license metadata.

Recommended representation metadata:

```
representation_id
concept_id
source
source_reference
license
attribution
commercial_use_allowed
asset_reference
```

### OpenSymbols

**Website:** https://www.opensymbols.org/

OpenSymbols aggregates tens of thousands of open-licensed communication symbols from multiple sources.

Licenses differ between symbol sets.

### Architectural consequence

A symbol search result is not automatically legally usable in every PictoFlow distribution mode.

The representation layer must preserve per-asset licensing information.

---

## 5. Research position of PictoFlow

Existing work already covers much of the following:

| Capability | State of the art |
|---|---|
| Pictogram keyboard | mature |
| AAC personalization | mature / active |
| Context-aware suggestions | active research |
| LLM-assisted AAC | active research |
| Dynamic/generated pictograms | exists |
| User profiles | exists |
| Personal knowledge bases | exists |
| Open board interoperability | exists |
| Semantic symbol registries | exists |

The current PictoFlow research hypothesis is concentrated on:

| PictoFlow direction | Current position |
|---|---|
| Personal Semantic Space owned by the user profile | core research direction |
| PCL as authoritative memory independent of LLM | core architecture |
| Human-validated semantic evolution | core architecture |
| Explicit confidence and refusal | core architecture |
| Semantic Gap detection from validated history | core research direction |
| Controlled creation of a new communication representation | core workflow |
| Portability across AI providers | core architecture |
| Concept / representation separation | required foundation |

This table is a working assessment, not a patentability or novelty opinion.

---

## 6. The PictoFlow Semantic Gap

PictoFlow uses the term **Semantic Gap** with a specific internal meaning.

A Semantic Gap is **not** merely a failed symbol search.

Working definition:

> A Semantic Gap is a recurrent and validated communication intent for which the user's current communication space does not yet provide an efficient dedicated representation.

Candidate evidence:

```
repeated sequence
+ repeated human validation/correction toward the same intent
+ no existing active block for that intent
= Semantic Gap candidate
```

Example:

```
NOISE + STOP + LEAVE

Repeated several times.

Validated meaning:
"The noise bothers me and I want to leave."

No dedicated block exists.

=> Semantic Gap Candidate
```

The candidate does not create a pictogram automatically.

---

## 7. Research principles adopted by PictoFlow

### 7.1 User agency

The system must not silently replace the user's expression with AI-generated language.

### 7.2 Human validation

AI output is a proposal.

No AI-generated semantic relation becomes validated automatically.

### 7.3 Privacy

The PCL should send external models only the minimum bounded context needed for a task.

### 7.4 No global semantic transfer by default

A relationship learned for one user must not automatically become a relationship for another user.

### 7.5 Explicit uncertainty

The system must be able to return:

```
not_understood
```

without inventing a meaning.

### 7.6 Model independence

Changing GPT, Mistral, Claude, a local model or another provider must not require rebuilding the person's semantic space.

---

## 8. Recommended research questions

### RQ1 — Semantic ownership

Can a user's personal communication meaning be represented independently from:
- the LLM;
- the pictogram library;
- the device interface?

### RQ2 — Validated adaptive learning

Can a communication vocabulary evolve from repeated user interactions while ensuring that only explicitly validated signals affect long-term semantic memory?

### RQ3 — Semantic Gap detection

Can recurrent validated sequences reliably identify missing communication representations?

### RQ4 — Communication efficiency

Does adding a validated personal communication block reduce:
- number of actions;
- time to communicate;
- corrections;
- communication abandonment?

### RQ5 — Portability

Can the same Personal Semantic Space be used across multiple:
- AI providers;
- pictogram sets;
- devices;
- interaction interfaces?

---

## 9. Initial evaluation model

Do not start by asking:

> "Does the AI understand the user?"

Prefer measurable functional questions.

### Before

Measure:
- actions per message;
- completion time;
- corrections;
- abandoned sequences.

### Intervention

PCL observes validated use and proposes a Semantic Gap candidate.

A new CommunicationBlock is human-approved.

### After

Measure:
- actions per same intent;
- completion time;
- correction rate;
- actual use of the new block.

This provides an objective first evaluation without making clinical claims.

---

## 10. Sources

- SPICA: https://doi.org/10.1145/3742413.3789116
- I, Robot?: https://doi.org/10.1145/3772318.3790310
- CPR-SAT: https://doi.org/10.1016/j.softx.2026.102635
- SpeakFaster: https://www.nature.com/articles/s41467-024-53873-3
- Pectogram: https://doi.org/10.1145/3663547.3759706
- UC Berkeley Personalized Communication Companion: https://www.ischool.berkeley.edu/projects/2025/personalized-communication-companion
- W3C AAC Symbol Registry: https://www.w3.org/TR/aac-registry/
- Open Board Format: https://www.openboardformat.org/docs
- OpenAAC documentation: https://www.openaac.org/docs
- ARASAAC Terms of Use: https://arasaac.org/terms-of-use
- OpenSymbols: https://www.opensymbols.org/

---

## 11. Status

This document is a **research foundation** for the project.

It should evolve with:
- additional peer-reviewed papers;
- feedback from AAC users;
- orthophonists / speech-language therapists;
- educators;
- caregivers;
- accessibility specialists;
- legal/privacy review.
