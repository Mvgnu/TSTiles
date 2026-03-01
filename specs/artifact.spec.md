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

## Component Insertion Points

- `src/domains/artifact/catalog/register-artifact.ts`
- `src/domains/artifact/catalog/get-active-artifact.ts`
- `src/domains/artifact/catalog/promote-artifact.ts`
- `src/domains/artifact/catalog/rollback-artifact.ts`
- `src/domains/artifact/catalog/list-artifacts.ts`
- `src/domains/artifact/catalog/validate-artifact.ts`
- `src/domains/artifact/catalog/garbage-collect.ts`
- `src/domains/artifact/__tests__/artifact-promotion.test.ts`

## Public API Contract

- `registerArtifact(version: ArtifactVersion): void`
- `getActiveArtifact(): ActiveArtifactPointer`
- `promoteArtifact(versionId: string): ActiveArtifactPointer`
- `rollbackArtifact(): ActiveArtifactPointer`
- `listArtifacts(): ArtifactVersion[]`
- `garbageCollectArtifacts(): string[]`

## Owned Invariants

- Active pointer updates are atomic.
- Only validated artifacts can be promoted.
- Active artifact is never deleted by retention jobs.
- Rollback history is bounded to prevent unbounded in-memory growth.

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

- Artifact catalog store (metadata + states).
- Active pointer store with compare-and-set semantics.

## Dependency Direction

- May depend on `storage` and `contracts`.
- Must not depend on `tile_api` or `ingest`.
