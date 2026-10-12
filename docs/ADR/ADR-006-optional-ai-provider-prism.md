# ADR-006 — Optional provider architecture with PRISM compatibility

## Status
Accepted

## Context

PictoFlow must not depend on one model or gateway.

PRISM will be used as an optional development/test integration, while PictoFlow must also support generic compatible endpoints.

## Decision

Create an internal `AIProvider` abstraction with at least:
- FakeProvider;
- DisabledProvider;
- PRISMProvider;
- OpenAICompatibleProvider.

## Consequences

- PRISM is optional;
- generic OpenAI-compatible endpoints are supported;
- switching provider does not modify PCL semantic state;
- provider responses are always unvalidated proposals.
