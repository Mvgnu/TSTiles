---
name: tile_api
description: "Edge tile delivery API backed by PMTiles range reads and Cloudflare cache"
paths:
  types: src/domains/tile-api/types.ts
  service: src/domains/tile-api/tile-api.service.ts
  components: src/domains/tile-api/routes/
  tests: src/domains/tile-api/__tests__/
exports:
  - TileRequest
  - TileResponse
  - TileMetadataResponse
  - handleTileRequest
  - handleMetadataRequest
consumes:
  - access.authorizeTileRequest
  - artifact.getActiveArtifact
  - storage.ObjectStore
  - config.TileDeliveryPolicy
  - contracts.TileCoordinates
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/tile-api/__tests__/"
  lint: "eslint src/domains/tile-api/"
---

# Tile API Domain

Owns `/tiles/{z}/{x}/{y}.mvt` request handling, PMTiles byte-range resolution, and cache writes at the edge.

## Component Insertion Points

- `src/domains/tile-api/routes/tiles-route.ts`
- `src/domains/tile-api/routes/metadata-route.ts`
- `src/domains/tile-api/routes/health-route.ts`
- `src/domains/tile-api/components/cache-key.ts`
- `src/domains/tile-api/components/active-artifact-resolver.ts`
- `src/domains/tile-api/components/pmtiles-resolver.ts`
- `src/domains/tile-api/components/response-headers.ts`
- `src/domains/tile-api/__tests__/tiles-route.test.ts`

## Public API Contract

- `handleTileRequest(input: TileRequest): TileResponse`
- `handleMetadataRequest(input: TileRequest): TileMetadataResponse`
- Supported methods are `GET`, `HEAD`, and `OPTIONS`.

## Owned Invariants

- Tile API delegates authorization to `access` and never implements policy directly.
- Cache key includes active artifact identity and normalized tile path.
- PMTiles range reads are performed through `storage`.

## Error Taxonomy

- `TILE_BAD_COORDINATES`
- `TILE_NOT_FOUND`
- `TILE_ARTIFACT_UNAVAILABLE`
- `TILE_ORIGIN_READ_FAILED`

## Caching Semantics

- Cache key format: `{artifactVersion}:{normalizedPath}`.
- Auth-only query parameters are excluded from cache key derivation.
- Metadata endpoint cache policy is explicit and separate from tile response policy.

## Security and Privacy

- Never forwards raw auth tokens to object-store requests.
- Denied requests are short-circuited before cache read and origin read.

## Data Stores

- Reads active artifact pointer.
- Reads PMTiles bytes and directory ranges from object storage.

## Dependency Direction

- May depend on `access`, `artifact`, `storage`, `config`, and `contracts`.
- Must not be depended on by `artifact` or `access` to avoid cycles.
