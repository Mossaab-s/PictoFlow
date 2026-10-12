# ADR-003 — PostgreSQL before graph database

## Status
Accepted

## Context

PictoFlow contains semantic relations and therefore resembles a graph.

However the expected V1 graph size per profile is limited and the query model is not yet complex enough to justify a dedicated graph database.

## Decision

Use PostgreSQL for V1 semantic persistence.

Do not introduce Neo4j in V1.

## Consequences

- lower operational complexity;
- one persistent database;
- relational constraints remain available;
- graph technology can be reconsidered later if real query patterns require it.
