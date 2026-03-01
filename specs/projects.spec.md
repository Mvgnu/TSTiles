---
name: projects
description: "Project registry, API key issuance/verification, and per-project delivery policies"
paths:
  types: src/domains/projects/types.ts
  service: src/domains/projects/projects.service.ts
  components: src/domains/projects/
  tests: src/domains/projects/__tests__/
exports:
  - Project
  - ApiKeyRecord
  - ProjectIdentity
  - ProjectCreationInput
  - ProjectPolicy
  - resolveProjectIdentity
  - verifyApiKey
  - listProjects
  - createProject
  - rotateApiKey
  - getProjectPolicy
consumes:
  - config.SecurityConfig
  - contracts.ContractError
  - contracts.ContractErrorCode
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/projects/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/projects/"
status: ready
---

# Projects Domain

Owns everything that turns a provided API token into a sanitized project identity and project policy.

## Component Insertion Points

- `src/domains/projects/projects.service.ts`
- `src/domains/projects/__tests__/projects-service.test.ts`

## Public API Contract

- `verifyApiKey(rawToken: string): ApiKeyRecord | null`
- `resolveProjectIdentity(ctx): { projectId: string; keyId: string; keyHash: string; keyIdHash: string; planId: string } | null`
- `listProjects(): Project[]`
- `createProject(input): Project`
- `rotateApiKey(projectId: string): ApiKeyRecord`
- `getProjectPolicy(projectId: string): ProjectPolicy`

## Project Policy Surface

- Allowed origins (optional per project).
- Allowed endpoint groups (`tiles`, `raster`, `static` / `staticMaps`).
- Quota policy (minute/day/month limits).
- Cache behavior overrides (restricted use).

## Owned Invariants

- Never returns raw token values; only key identifiers and hashed key identities.
- Supports multiple active keys per project for key rotation.
- Store adapters are deterministic, unit-testable, and side-effect minimal.

## Error Taxonomy

- `PROJECTS_KEY_INVALID`
- `PROJECTS_KEY_REVOKED`
- `PROJECTS_PROJECT_NOT_FOUND`
- `PROJECTS_POLICY_INVALID`

## Data Stores

- In-memory adapter for tests/dev.
- KV/SQLite/Postgres adapters for production deployments.

## Dependency Direction

- May depend on `config` and `contracts`.
- Must not depend on request-path domains (`tile_api`, `raster_api`, `access`).
