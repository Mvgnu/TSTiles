---
name: access
description: "Authorization, CORS, API key identity resolution, and quota prechecks for vector/raster/static requests"
paths:
  types: src/domains/access/types.ts
  service: src/domains/access/access.service.ts
  components: src/domains/access/policies/
  tests: src/domains/access/__tests__/
exports:
  - AuthorizeContext
  - AuthorizeResult
  - DenyReason
  - authorizeTileRequest
  - buildCorsHeaders
consumes:
  - config.SecurityConfig
  - contracts.AuthorizeContext
  - projects.resolveProjectIdentity
  - projects.ProjectPolicy
  - metering.consumeRequestUnit
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/access/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/access/"
status: ready
---

# Access Domain

Owns request validation before vector/raster/static bytes are served.

## Component Insertion Points

- `src/domains/access/policies/origin-allowlist.ts`
- `src/domains/access/policies/token-validator.ts`
- `src/domains/access/policies/cors-headers.ts`
- `src/domains/access/policies/request-shape-validator.ts`
- `src/domains/access/policies/token-redaction.ts`
- `src/domains/access/policies/rate-limit.ts`
- `src/domains/access/__tests__/authorize-tile-request.test.ts`

## Public API Contract

- `authorizeTileRequest(input: AuthorizeContext): AuthorizeResult`
- `buildCorsHeaders(input: AuthorizeResult): Record<string, string>`
- Inputs include method, path, normalized query, headers, client metadata.
- Outputs include `allow`, `denyReason`, and sanitized identity (`projectId:keyIdHash` fragment or `"anon"` fallback).
- Validates request shape for `tiles`, `raster`, and `static` request families.

## Owned Invariants

- Auth and quota are evaluated before any cache lookup and before any object-store read.
- Access owns CORS policy calculation; downstream domains must not override policy.
- CORS policy is derived from resolved project policy when `allowedOrigins` is configured, with global config as fallback.
- Access never logs raw API keys or raw token values.

## Error Taxonomy

- `ACCESS_UNAUTHORIZED`
- `ACCESS_ORIGIN_DENIED`
- `ACCESS_RATE_LIMITED`
- `ACCESS_QUOTA_EXCEEDED`
- `ACCESS_BAD_REQUEST`

- Metering `rate_limit` outcomes map to `ACCESS_RATE_LIMITED`; metering `quota` outcomes map to `ACCESS_QUOTA_EXCEEDED`.

## Caching Semantics

- Auth-only query parameters are excluded from tile cache keys.
- Dynamic CORS headers are applied per request to cached and uncached responses.

## Security and Privacy

- Token format and allowlist policy come from validated runtime config.
- Redaction rules apply to logs, traces, and deny payloads.

## Data Stores

- Reads security config and token metadata.
- Reads project/key identity and policy via `projects`.
- Writes/reads fast quota counters via `metering`.

## Dependency Direction

- May depend on `config`, `contracts`, `projects`, and `metering`.
- Must not depend on request handlers (`tile_api`, `raster_api`) or data domains (`artifact`, `ingest`).
