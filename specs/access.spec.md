---
name: access
description: "Authorization, CORS, and request-shape enforcement for tile delivery"
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
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/access/__tests__/"
  lint: "eslint src/domains/access/"
---

# Access Domain

Owns request validation before tile bytes are served.

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
- Outputs include `allow`, `denyReason`, and sanitized auth identity.

## Owned Invariants

- Auth is evaluated before any cache lookup and before any object-store read.
- Access owns CORS policy calculation; downstream domains must not override policy.
- Access never logs raw token values.

## Error Taxonomy

- `ACCESS_UNAUTHORIZED`
- `ACCESS_ORIGIN_DENIED`
- `ACCESS_RATE_LIMITED`
- `ACCESS_BAD_REQUEST`

## Caching Semantics

- Auth-only query parameters are excluded from tile cache keys.
- Dynamic CORS headers are applied per request to cached and uncached responses.

## Security and Privacy

- Token format and allowlist policy come from validated runtime config.
- Redaction rules apply to logs, traces, and deny payloads.

## Data Stores

- Reads security config and token metadata.
- Writes optional rate-limit counters if configured.

## Dependency Direction

- May depend on `config` and `contracts`.
- Must not depend on `tile_api`, `artifact`, or `ingest`.
