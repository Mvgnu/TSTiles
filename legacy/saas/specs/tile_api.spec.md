---
name: tile_api
description: "Edge vector tile delivery API backed by tile resolver and edge cache policy"
paths:
  types: src/domains/tile-api/types.ts
  service: src/domains/tile-api/tile-api.service.ts
  components: src/domains/tile-api/routes/
  tests: src/domains/tile-api/__tests__/
exports:
  - TileRequest
  - TileResponse
  - TileMetadataResponse
  - TileApiError
  - TileApiErrorCode
  - handleTileRequest
  - handleMetadataRequest
  - handleHealthRequest
consumes:
  - access.authorizeTileRequest
  - access.resolveAllowedOrigins
  - tile_resolver.resolveVectorTile
  - tile_resolver.resolveMetadata
  - tile_resolver.resolveArchiveProfile
  - tile_resolver.ResolverErrorCode
  - config.TileDeliveryPolicy
  - contracts.AuthorizeContext
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/tile-api/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/tile-api/"
status: ready
---

# Tile API Domain

Owns `/v1/tiles/{z}/{x}/{y}.mvt` request handling (with optional `/v1` prefix normalization), PMTiles byte-range resolution, and cache writes at the edge.

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain delegates auth/quota/suspension checks to `access`; the new `ACCESS_WORKSPACE_SUSPENDED` and `ACCESS_PROJECT_REVOKED` deny reasons map to HTTP `403` here with `cache-control: no-store`. Existing tile-delivery invariants remain unchanged.

## Component Insertion Points

- `src/domains/tile-api/routes/tiles-route.ts`
- `src/domains/tile-api/routes/metadata-route.ts`
- `src/domains/tile-api/components/cache-key.ts`
- `src/domains/tile-api/components/response-headers.ts`
- `src/domains/tile-api/routes/health-route.ts`
- `src/domains/tile-api/__tests__/tiles-route.test.ts`

## Public API Contract

- `handleTileRequest(input: TileRequest): TileResponse`
- `handleMetadataRequest(input: TileRequest): TileMetadataResponse`
- `handleHealthRequest(input: TileRequest): TileResponse`
- Supported methods are `GET`, `HEAD`, and `OPTIONS`.

## Endpoint Surface

- `GET /v1/tiles/{z}/{x}/{y}.mvt`
- `GET /v1/tiles/metadata` (`GET`, `HEAD`, `OPTIONS`)
- `GET /v1/health` (`GET`, `HEAD`, `OPTIONS`)

## Owned Invariants

- Tile API delegates authorization to `access` and never implements policy directly.
- Cache key includes active artifact identity and normalized tile path.
- Tile/metadata byte resolution is delegated to `tile_resolver`.
- Metadata responses include archive zoom or bounds profile when the active PMTiles header is readable, so frontend or docs consumers can discover the real delivery limits of the current artifact.
- Successful tile responses must contain the actual MVT payload resolved from the PMTiles archive, so browser MapLibre clients can consume `/v1/tiles/{z}/{x}/{y}.mvt` directly without the `/demo` PMTiles shortcut.
- OPTIONS requests are short-circuited for valid tile/metadata paths and do not require token auth.
  If a token is provided (e.g., query token), preflight CORS policy is resolved project-scoped; otherwise global allowlist fallback is used.
- Raw path query tokens remain authoritative when callers also pass a sparse `query` object, so `access_token` embedded in `path` is not erased by `query.access_token: undefined`.
- Query-token helpers also skip malformed non-string or blank leading `access_token[]` entries instead of trusting the first array slot and dropping later valid string tokens from direct callers.
- Query maps also fail closed on malformed non-array runtime values at the exported handler boundary, instead of letting object-like query entries drift deeper into tile or metadata request handling.
- Exported request handlers fail closed on non-string runtime `path` values, returning the route-owned bad-request contracts instead of leaking raw string-operation failures from direct callers.
- Exported route wrappers also fail closed on malformed runtime request objects or non-string `method` / `path` / header values, returning the same tile or health bad-request contracts instead of leaking raw property-access failures from direct callers.
- Those exported route wrappers also reject malformed runtime query payloads instead of passing object-shaped junk through to service-layer normalization and only failing later.
- Metadata-path preflight failures use the metadata route’s `TILE_BAD_REQUEST` contract for malformed subpaths instead of leaking the tile-coordinate-specific `TILE_BAD_COORDINATES` code.
- `HEAD` responses are only served when `HEAD_ENABLED=true`; if disabled, handler returns `405` with `HEAD_DISABLED`.
  `HEAD_DISABLED` responses for HEAD requests are body-less.

## Error Taxonomy

- `TILE_BAD_REQUEST`
- `TILE_BAD_COORDINATES`
- `TILE_NOT_FOUND`
- `TILE_ARTIFACT_UNAVAILABLE`
- `TILE_ORIGIN_READ_FAILED`
- `HEAD_DISABLED`

## Caching Semantics

- Cache key format: `{artifactVersion}:{normalizedPath}`.
- Auth-only query parameters are excluded from cache key derivation.
- Metadata endpoint cache policy is explicit and separate from tile response policy.

## Security and Privacy

- Never forwards raw auth tokens to object-store requests.
- Denied requests are short-circuited before cache read and origin read.
- Post-auth resolver failures preserve the resolved request CORS policy (including project-scoped origins) while returning `cache-control: no-store`.

## Data Stores

- No direct object-store reads.
- Reads resolved payloads through `tile_resolver`.

## SaaS Launch Baseline

- The tile API is stateless: it owns request normalization, CORS materialization, response shaping, and cache-control derivation. All identity, quota, and origin reads are delegated to the persistent-backed domains (`access`, `tile_resolver`).
- Cache keys are derived from the active artifact identity and normalized request path; tokens, signatures, and other auth-only query parameters never enter the cache key, so per-tenant cache isolation is preserved without per-token blowup.
- HEAD/OPTIONS handling is config-driven through `HEAD_ENABLED` and never depends on per-instance state.
- Post-auth resolver failures preserve the resolved request CORS policy (project-scoped origins included) while explicitly returning `cache-control: no-store` so transient failures cannot poison shared caches.

## Dependency Direction

- May depend on `access`, `tile_resolver`, `config`, and `contracts`.
- Must not be depended on by `access`, `artifact`, or `tile_resolver` to avoid cycles.
