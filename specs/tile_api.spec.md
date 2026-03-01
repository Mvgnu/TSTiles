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
  - tile_resolver.resolveVectorTile
  - tile_resolver.resolveMetadata
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
- `GET /v1/health` (`GET`, `HEAD`)

## Owned Invariants

- Tile API delegates authorization to `access` and never implements policy directly.
- Cache key includes active artifact identity and normalized tile path.
- Tile/metadata byte resolution is delegated to `tile_resolver`.
- OPTIONS requests are short-circuited for valid tile/metadata paths and do not require token auth.
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

## Data Stores

- No direct object-store reads.
- Reads resolved payloads through `tile_resolver`.

## Dependency Direction

- May depend on `access`, `tile_resolver`, `config`, and `contracts`.
- Must not be depended on by `access`, `artifact`, or `tile_resolver` to avoid cycles.
