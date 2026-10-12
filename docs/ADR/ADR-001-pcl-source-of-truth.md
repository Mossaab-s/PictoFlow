# ADR-001 — PCL is the source of truth

## Status
Accepted

## Context

PictoFlow may use external AI providers for interpretation, simplification or representation suggestions.

If semantic truth is stored inside one provider, changing model/provider would risk losing or changing the user's personal communication state.

## Decision

The Personal Communication Layer (PCL) is the authoritative source of truth for personal semantic state.

External AI providers only return proposals.

## Consequences

- AI output cannot directly become validated semantic knowledge.
- Provider replacement does not require semantic migration.
- PictoFlow must operate in no-provider mode.
- PCL persistence is independent from the AI backend.
