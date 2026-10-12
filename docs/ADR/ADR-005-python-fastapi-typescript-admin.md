# ADR-005 — Python/FastAPI backend and TypeScript admin

## Status
Accepted

## Context

PictoFlow needs:
- a Python-native environment for semantic/AI experimentation;
- a typed API;
- a separate administration interface.

## Decision

V1 stack:
- Python;
- FastAPI;
- Pydantic;
- SQLAlchemy;
- Alembic;
- PostgreSQL;
- Redis;
- Next.js + TypeScript for administration.

## Consequences

- PCL domain remains pure Python;
- FastAPI is an adapter, not the domain;
- Next.js communicates only through the backend API;
- AI experimentation remains straightforward in Python.
