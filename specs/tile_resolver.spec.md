---
name: tile_resolver
description: "Raw tile byte resolution from PMTiles via range reads (no auth, no HTTP)"
paths:
  types: src/domains/tile-resolver/types.ts
  service: src/domains/tile-resolver/tile-resolver.service.ts
  components: src/domains/tile-resolver/pmtiles/
  tests: src/domains/tile-resolver/__tests__/
exports:
  - TileCoordinates
  - ResolvedTile
  - ResolverError
  - ResolverErrorCode
  - resolveVectorTile
  - resolveMetadata
  - validateTileCoordinates
consumes:
  - artifact.getActiveArtifact
  - artifact.listArtifacts
  - storage.ObjectStore
  - config.TileDeliveryPolicy
  - contracts.TileCoordinates
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/tile-resolver/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/tile-resolver/"
status: ready
---

# Tile Resolver Domain

Owns byte-level vector tile and metadata resolution from active PMTiles artifacts.

## Component Insertion Points

- `src/domains/tile-resolver/pmtiles/coordinates.ts`
- `src/domains/tile-resolver/pmtiles/directory-resolver.ts`
- `src/domains/tile-resolver/pmtiles/range-reader.ts`
## Public API Contract

- `resolveVectorTile({ z, x, y, artifactId? }): ResolvedTile`
- `resolveMetadata({ artifactId? }): ResolvedMetadata`
- `validateTileCoordinates(coords): ContractError | null`

## Owned Invariants

- Must not read request headers or access tokens.
- Must not compute CORS or HTTP response headers.
- Returns response-header seeds only (`etagSeed`, `contentType`, `byteLength`).

## Error Taxonomy

- `RESOLVER_BAD_COORDINATES`
- `RESOLVER_TILE_NOT_FOUND`
- `RESOLVER_ARTIFACT_UNAVAILABLE`
- `RESOLVER_ORIGIN_READ_FAILED`

## Dependency Direction

- May depend on `artifact`, `storage`, `config`, and `contracts`.
- Must not depend on `access`, `tile_api`, `raster_api`, or `render`.
