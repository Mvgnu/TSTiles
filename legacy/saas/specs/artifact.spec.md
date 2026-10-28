---
name: artifact
description: "Versioning, metadata, promotion, and rollback for PMTiles releases"
paths:
  types: src/domains/artifact/types.ts
  service: src/domains/artifact/artifact.service.ts
  components: src/domains/artifact/catalog/
  tests: src/domains/artifact/__tests__/
exports:
  - ArtifactVersion
  - ActiveArtifactPointer
  - registerArtifact
  - getActiveArtifact
  - promoteArtifact
  - rollbackArtifact
  - listArtifacts
  - garbageCollectArtifacts
consumes:
  - storage.ObjectMetadata
  - contracts.ArtifactEvent
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/artifact/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/artifact/"
status: ready
---

# Artifact Domain

Owns artifact metadata, active version selection, and safe promotion or rollback of tile datasets.

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. Artifact is operator-owned and consumed by the operator surface at `/ops/artifacts/*` (see `admin_console.spec.md`). No customer-surface or auth/email touchpoints — existing invariants remain unchanged.

## Component Insertion Points

- `src/domains/artifact/artifact.service.ts` (Prisma-backed implementation of registration, promotion, rollback, listing, and garbage collection)
- `src/domains/artifact/catalog/validate-artifact.ts` (pure version-shape validation)
- `src/domains/artifact/__tests__/artifact-promote.test.ts`

## Public API Contract

- `registerArtifact(version: ArtifactVersion): Promise<void>`
- `getActiveArtifact(): Promise<ActiveArtifactPointer>`
- `promoteArtifact(versionId: string): Promise<ActiveArtifactPointer>`
- `rollbackArtifact(): Promise<ActiveArtifactPointer>`
- `listArtifacts(): Promise<ArtifactVersion[]>`
- `garbageCollectArtifacts(keepLatest?: number): Promise<string[]>`

## Owned Invariants

- Active pointer updates are atomic.
- Only validated artifacts can be promoted.
- Artifact version IDs must reject path separators and traversal markers, including exact `"."`, at registration and promotion boundaries.
- Artifact promotion also fails closed on non-string runtime `versionId` inputs instead of leaking raw string-operation failures from direct callers.
- Artifact registration fails closed on malformed runtime artifact objects and non-string/non-boolean fields instead of leaking raw string-operation failures from direct callers.
- Artifact registration rejects non-integer or non-finite `byteSize`; stored object sizes are positive whole-byte counts.
- Active artifact is never deleted by retention jobs.
- Rollback history is bounded and persisted alongside the active pointer so multi-instance deployments observe a single rollback target.

## SaaS Launch Baseline

- The artifact catalog, active pointer, and rollback history are persisted to the Prisma `ArtifactVersion`, `ActiveArtifact`, and `ArtifactPromotionHistory` models. Promotion, rollback, registration, listing, and garbage collection run as Prisma transactions and survive process restarts.
- The artifact service exposes async APIs only; in-memory catalog state has been removed. Multi-instance deployments observe a single consistent catalog because the persistent store is the only source of truth.
- Garbage collection enumerates the persistent catalog and uses the persisted active pointer plus the retained `ArtifactPromotionHistory` rows as the protection set, so retention jobs cannot orphan or remove the currently active artifact or any version reachable through rollback.
- Promotion is transactional: the previous active pointer is appended to history, then the new pointer is upserted, all in one Prisma `$transaction`. Rollback consumes the most recent history row inside a transaction so concurrent rollbacks cannot replay a stale pointer twice.

## Error Taxonomy

- `ARTIFACT_NOT_FOUND`
- `ARTIFACT_NOT_VALIDATED`
- `ARTIFACT_PROMOTION_CONFLICT`
- `ARTIFACT_ROLLBACK_UNAVAILABLE`

## Caching Semantics

- Promotion changes the active artifact identity immediately.
- Downstream cache keys must include active artifact identity.

## Security and Privacy

- Control-plane writes must be authenticated and auditable.
- Artifact metadata logs exclude secret storage credentials.

## Data Stores

- Prisma `ArtifactVersion` model holds artifact metadata: `id`, `datasetId`, `storageKey`, `sizeBytes` (`BigInt` to support multi-gigabyte planet artifacts; narrowed to JS `number` at the domain boundary, clamped to `Number.MAX_SAFE_INTEGER` defensively), `format`, `validatedAt`, `createdAt`, `checksum`, `validated`, and serialized `metadata` JSON.
- Prisma `ActiveArtifact` model holds the current promoted pointer (`datasetId @id`, `versionId`, `activeSince`).
- Prisma `ArtifactPromotionHistory` model holds the rollback history per dataset (`datasetId`, `versionId`, `activeSince`, `recordedAt`); rollback consumes the most recent history row inside the same transaction that updates the active pointer.

## Dependency Direction

- May depend on `storage` and `contracts`.
- Must not depend on `tile_api` or `ingest`.
