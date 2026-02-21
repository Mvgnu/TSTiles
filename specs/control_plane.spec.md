---
name: control_plane
description: "Operator-only endpoints for ingest, artifact lifecycle, and operational controls"
paths:
  types: src/domains/control-plane/types.ts
  service: src/domains/control-plane/control-plane.service.ts
  components: src/domains/control-plane/routes/
  tests: src/domains/control-plane/__tests__/
exports:
  - triggerIngest
  - listArtifactsEndpoint
  - promoteArtifactEndpoint
  - rollbackArtifactEndpoint
  - healthStatusEndpoint
consumes:
  - ingest.runIngestPipeline
  - artifact.listArtifacts
  - artifact.promoteArtifact
  - artifact.rollbackArtifact
  - config.SecurityConfig
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/control-plane/__tests__/"
  lint: "eslint src/domains/control-plane/"
---

# Control Plane Domain

Owns protected operational actions and diagnostics for administrators.

## Component Insertion Points

- `src/domains/control-plane/routes/admin-artifacts-route.ts`
- `src/domains/control-plane/routes/admin-promote-route.ts`
- `src/domains/control-plane/routes/admin-rollback-route.ts`
- `src/domains/control-plane/routes/admin-ingest-route.ts`
- `src/domains/control-plane/routes/health-route.ts`
- `src/domains/control-plane/auth/admin-auth.ts`
- `src/domains/control-plane/__tests__/control-plane-routes.test.ts`

## Public API Contract

- `triggerIngest(): JobReference`
- `listArtifactsEndpoint(): ArtifactSummary[]`
- `promoteArtifactEndpoint(versionId: string): ActiveArtifactPointer`
- `rollbackArtifactEndpoint(): ActiveArtifactPointer`

## Owned Invariants

- All control-plane endpoints require admin authentication.
- Mutating operations are auditable and idempotent where feasible.
- Health endpoints never expose sensitive configuration details.

## Error Taxonomy

- `CONTROL_PLANE_UNAUTHORIZED`
- `CONTROL_PLANE_FORBIDDEN`
- `CONTROL_PLANE_CONFLICT`
- `CONTROL_PLANE_DEPENDENCY_FAILED`

## Caching Semantics

- Admin endpoints are uncached by default.
- Health status endpoint may be short-cached for burst protection.

## Security and Privacy

- Admin auth uses dedicated credentials separate from tile access tokens.
- Audit logs include actor identity and operation outcome.

## Data Stores

- Reads artifact catalog and pointer state through domain APIs.
- Persists operation audit entries and job run metadata.

## Dependency Direction

- May depend on `ingest`, `artifact`, and `config`.
- Must not be depended on by core request-path domains (`tile_api`, `access`).
