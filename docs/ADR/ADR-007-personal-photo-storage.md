# ADR-007 — Bounded personal photos in PostgreSQL

## Status

Accepted for the V1 personal-photo workflow.

## Context

A touch may display a personal photo while retaining its concept, word and
keyboard position. The photo must be profile scoped, persist across deployments,
and be backed up with its semantic history. A filesystem/object-store write and
a PostgreSQL transaction would require orphan reconciliation after failures.

## Decision

Store normalized photo pixels in a separate PostgreSQL `photo_asset` table,
referencing a `Representation` of the same profile through a composite foreign
key. Keep the binary payload outside the domain entities and semantic audit.
Accept static JPEG/PNG/WebP up to 5 MiB and 20 million input pixels; retain a
metadata-free JPEG of at most 1024 × 1024 and 2 MiB. Preserve concept identity
and explicit human validation. Do not send photos to AI providers.

New touches, media, representations and audit commit together. Replacements are
explicit human decisions. Deleting an unused photo removes its pixels and archives
its representation atomically, retaining semantic history. Complete profile-memory
erasure includes its media. A populated table blocks implicit migration downgrade.

## Consequences

Full PostgreSQL backups cover both photo pixels and PCL state. Deployments require
no extra media volume and no file reconciliation. Bounded small images are suitable
for this prototype; large original files are deliberately not retained. Increased
database and backup size should guide a later explicit migration to object storage,
including scoped access, reconciliation and coordinated backups.
