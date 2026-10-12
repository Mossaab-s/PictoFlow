# ADR-002 — Separate Concept from Representation

## Status
Accepted

## Context

The same semantic meaning may be represented by:
- pictogram;
- text;
- personal photo;
- generated visual;
- audio.

Symbol libraries may change and have different licenses.

## Decision

Semantic `Concept` and user-facing `Representation` are separate domain objects.

## Consequences

- changing an image does not change semantic identity;
- one concept can have multiple representations;
- symbol provenance/license can be managed independently;
- interoperability is easier.
