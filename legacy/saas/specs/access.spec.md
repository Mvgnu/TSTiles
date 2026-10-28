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
  - resolveAllowedOrigins
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

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain does not render UI directly. Relevant cross-cutting effects for subagents:

- **Workspace suspension propagation**: when a project token resolves to a project whose owning workspace is suspended (`IdentityWorkspace.suspendedAt IS NOT NULL`), `authorizeTileRequest` MUST deny with `ACCESS_WORKSPACE_SUSPENDED` (HTTP `403`). The deny payload includes `Retry-After: 0` and a `cache-control: no-store` directive so transient suspension state cannot poison shared caches.
- **Workspace soft-delete propagation**: when a token resolves to a project whose owning workspace is soft-deleted (`IdentityWorkspace.deletedAt IS NOT NULL`), `authorizeTileRequest` MUST deny with `ACCESS_PROJECT_REVOKED`.
- **Quota mapping**: metering `denyReason: workspace_suspended` maps to `ACCESS_WORKSPACE_SUSPENDED`; existing `rate_limit` and `quota` mappings retained.
- **Customer vs operator surfaces**: access is purely the customer delivery surface (`/v1/*`). Operator routes (`/admin/*`, `/ops/*`) never reach this domain. Customer session cookies are never consulted here — access is token-only.

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
  Static map shape validation includes geographic bounds for lon/lat inputs (`lon: -180..180`, `lat: -85.05112878..85.05112878`).
- Decoded raster/static style IDs reject path separators and traversal markers, including exact `.`.

## Owned Invariants

- Auth and quota are evaluated before any cache lookup and before any object-store read.
- Security rate-limit checks execute before quota consumption so throttled requests do not burn quota.
- Security rate-limit keys are identity-scoped for authenticated requests and `clientIp`-scoped for anonymous requests (with safe fallback bucket when IP is unavailable).
- Access owns CORS policy calculation; downstream domains must not override policy.
- CORS policy is derived from resolved project policy when `allowedOrigins` is configured, with global config as fallback.
- Explicitly denied origins are emitted with `Access-Control-Allow-Origin: null` (unless wildcard policy is configured) to avoid permissive deny-response sharing.
- `resolveAllowedOrigins` may derive project-scoped CORS from optional token context for preflight/OPTIONS without consuming quota units.
- Exported auth and preflight-origin helpers honor `query.access_token` directly when `rawToken` is not pre-extracted, so browser-style query-token consumers stay inside the access-domain contract.
- Query-token helpers fail closed on malformed runtime `access_token` array entries instead of leaking raw string-operation failures from direct callers.
- Query-token helpers also fail closed on malformed non-array runtime `access_token` values; authorization returns `ACCESS_BAD_REQUEST`, while preflight-origin resolution falls back to the global allowlist instead of treating malformed token objects as valid project-scoped input.
- The exported access authorization surface must fail closed on non-string runtime request paths with `ACCESS_BAD_REQUEST`, instead of leaking raw string-operation failures from direct callers.
- The exported `buildCorsHeaders(...)` helper must fail closed on malformed runtime auth results, origin values, or `allowedOrigins` payloads, including blank allowlist entries, by returning restrictive CORS headers (`Access-Control-Allow-Origin: null`, `Cache-Control: no-store`) instead of leaking raw property-access or string-operation failures.
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
- Reads project/key identity and policy via `projects` (Prisma-backed).
- Writes/reads quota counters via `metering` (Prisma-backed).
- Per-instance rolling rate-limit counters in process memory keyed by sanitized identity (or `clientIp` for anonymous traffic) used to enforce minute-window throttling at the edge.

## SaaS Launch Baseline

- Quota gating is delegated to the persistent metering buckets so customer-visible monthly allowances stay consistent across instances and process restarts.
- The per-instance rate-limit counters are intentionally non-persistent and bounded; they enforce burst protection at the edge ahead of the persistent quota check, and are scoped per-identity (not per-anonymous-bucket) so anonymous abuse from one client cannot starve other anonymous traffic.
- CORS policy is derived from the persistent project policy when a token is supplied (including for OPTIONS preflight) and falls back to the global `ALLOWED_ORIGINS` config when no token is present. Wildcard policy is supported only when explicitly configured.
- Token redaction runs before any access decision is logged or surfaced; raw API tokens never appear in logs, traces, or deny payloads.

## Dependency Direction

- May depend on `config`, `contracts`, `projects`, and `metering`.
- Must not depend on request handlers (`tile_api`, `raster_api`) or data domains (`artifact`, `ingest`).
