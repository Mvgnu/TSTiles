---
name: control_plane
description: "Operator-only endpoints for ingest, artifact lifecycle, styles, projects, and usage controls"
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
  - createProjectEndpoint
  - rotateApiKeyEndpoint
  - getProjectUsageEndpoint
  - createStyleVersionEndpoint
  - publishStyleVersionEndpoint
  - healthStatusEndpoint
consumes:
  - ingest.runIngestPipeline
  - artifact.listArtifacts
  - artifact.registerArtifact
  - artifact.promoteArtifact
  - artifact.rollbackArtifact
  - styles.createStyleVersion
  - styles.publishStyleVersion
  - projects.createProject
  - projects.rotateApiKey
  - metering.getUsageSummary
  - config.SecurityConfig
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/control-plane/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/control-plane/"
status: ready
---

# Control Plane Domain

Owns protected operational actions and diagnostics for administrators.

## Component Insertion Points

- `src/domains/control-plane/routes/admin-artifacts-route.ts`
- `src/domains/control-plane/routes/admin-promote-route.ts`
- `src/domains/control-plane/routes/admin-rollback-route.ts`
- `src/domains/control-plane/routes/admin-ingest-route.ts`
- `src/domains/control-plane/routes/admin-rotate-api-key-route.ts`
- `src/domains/control-plane/routes/admin-project-usage-route.ts`
- `src/domains/control-plane/routes/admin-create-style-version-route.ts`
- `src/domains/control-plane/routes/admin-publish-style-version-route.ts`
- `src/domains/control-plane/routes/health-route.ts`
- `src/domains/control-plane/auth/admin-auth.ts`
- `src/domains/control-plane/__tests__/control-plane-routes.test.ts`

## Public API Contract

- `triggerIngest(): JobReference`
- `listArtifactsEndpoint(): ArtifactSummary[]`
- `promoteArtifactEndpoint(versionId: string): ActiveArtifactPointer`
- `rollbackArtifactEndpoint(): ActiveArtifactPointer`
- `createProjectEndpoint(input): Project`
- `rotateApiKeyEndpoint(projectId: string): ApiKeyRecord`
- `getProjectUsageEndpoint(projectId: string, window): UsageSummary`
- `createStyleVersionEndpoint(styleId: string, input): StyleVersion`
- `publishStyleVersionEndpoint(styleId: string, versionId: string): StyleVersion`

## Endpoint Surface

- `POST /admin/ingest`
- `GET /admin/artifacts`
- `POST /admin/artifacts/:versionId/promote`
- `POST /admin/artifacts/rollback`
- `POST /admin/projects`
- `POST /admin/projects/:projectId/keys/rotate`
- `GET /admin/projects/:projectId/usage?window=day|month`
- `POST /admin/styles/:styleId/versions`
- `POST /admin/styles/:styleId/publish/:versionId`
- `GET /admin/health`

## Owned Invariants

- All control-plane endpoints require admin authentication.
- Mutating operations are auditable and idempotent where feasible.
- Health endpoints never expose sensitive configuration details.
- Admin-only project key operations never return raw key material after initial issuance.
- In-memory job/audit telemetry uses bounded retention to avoid unbounded process memory growth.

## Error Taxonomy

- `CONTROL_PLANE_UNAUTHORIZED`
- `CONTROL_PLANE_FORBIDDEN`
- `CONTROL_PLANE_CONFLICT`
- `CONTROL_PLANE_DEPENDENCY_FAILED`
- Request validation errors (e.g., invalid usage window) return `400` with descriptive message.

## Caching Semantics

- Admin endpoints are uncached by default.
- Health status endpoint may be short-cached for burst protection.

## Security and Privacy

- Admin auth uses dedicated credentials separate from tile access tokens.
- Audit logs include actor identity and operation outcome.

## Data Stores

- Reads artifact catalog and pointer state through domain APIs.
- Reads project/style/usage state through owned domains.
- Persists operation audit entries and job run metadata.

## Dependency Direction

- May depend on `ingest`, `artifact`, `styles`, `projects`, `metering`, and `config`.
- Must not be depended on by request-path domains (`tile_api`, `raster_api`, `access`).
