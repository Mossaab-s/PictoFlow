# ADR-004 — Redis is cache and transient state only

## Status
Accepted

## Context

PictoFlow needs fast temporary storage for sessions, provider health and cacheable computations.

## Decision

Use Redis for transient/cache workloads only.

PostgreSQL remains the source of truth for persistent PCL state.

## Consequences

- Redis loss must not destroy validated personal semantic knowledge;
- long-term memory and audit data are never authoritative only in Redis;
- transient keys should use TTL where appropriate.
