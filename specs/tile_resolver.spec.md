---
name: tile_resolver
description: "Raw tile byte resolution from PMTiles via range reads (no auth, no HTTP)"
bar:
  reference: "Protomaps PMTiles JavaScript library"
  property: "A maintainer can trace one coordinate request through bounded range reads to exact tile bytes, with errors that preserve the failing boundary."
paths:
  types: src/domains/tile-resolver/types.ts
  service: src/domains/tile-resolver/tile-resolver.service.ts
  components: src/domains/tile-resolver/pmtiles/
  tests: src/domains/tile-resolver/__tests__/
exports:
  - TileCoordinates
  - ResolvedTile
  - ResolvedArchiveProfile
  - ResolverError
  - ResolverErrorCode
  - resolveVectorTile
  - resolveMetadata
  - resolveArchiveProfile
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
status: in-review
---

# Tile Resolver Domain

Owns byte-level vector tile and metadata resolution from active PMTiles artifacts.

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain is pure compute downstream of `access` (which now denies on workspace suspension / soft-delete). No direct cross-cutting effects — existing invariants remain unchanged.

## Component Insertion Points

- `src/domains/tile-resolver/pmtiles/coordinates.ts`
- `src/domains/tile-resolver/pmtiles/archive-source.ts`
## Public API Contract

- `resolveVectorTile({ z, x, y, artifactId? }): Promise<ResolvedTile>`
- `resolveMetadata({ artifactId? }): Promise<ResolvedMetadata>`
- `resolveArchiveProfile({ artifactId? }): Promise<ResolvedArchiveProfile>`
- `validateTileCoordinates(coords): ContractError | null`

## Owned Invariants

- Must not read request headers or access tokens.
- Must not compute CORS or HTTP response headers.
- Returns response-header seeds only (`etagSeed`, `contentType`, `byteLength`).
- Explicit artifact IDs must reject path separators and traversal markers, including exact `"."`, at the resolver boundary.
- Explicit artifact IDs also fail closed on non-string runtime values at the resolver boundary instead of leaking raw string-operation failures from direct callers.
- `resolveVectorTile(...)` also fails closed on malformed runtime input objects instead of leaking raw property-access failures before coordinate validation runs.
- `resolveMetadata(...)` and `resolveArchiveProfile(...)` also fail closed on malformed runtime input objects, treating them as omitted artifact selection instead of leaking raw property-access failures from direct callers.
- Exposes archive zoom or bounds profile from the active PMTiles header so downstream domains can publish accurate `minzoom` and `maxzoom` limits instead of hardcoding delivery ceilings.
- Tile bytes must be resolved through actual PMTiles directory lookup and decompression, not synthetic byte slicing based on the requested path.
- A single tile resolve performs bounded PMTiles origin IO fanout using archive header/directory reads plus one tile-content read, with cache reuse across repeated requests to the same artifact within the same backing object-store instance.

## Error Taxonomy

- `RESOLVER_BAD_COORDINATES`
- `RESOLVER_TILE_NOT_FOUND`
- `RESOLVER_ARTIFACT_UNAVAILABLE`
- `RESOLVER_ORIGIN_READ_FAILED`

## SaaS Launch Baseline

- The resolver is stateless: every tile resolution reads the persistent active artifact pointer through `artifact.getActiveArtifact()` and resolves bytes through the configured `storage` backing without local catalog state.
- Per-instance archive/header/directory caches are keyed by `(artifactId, objectStore)` and exist purely as a hot-path optimization; promotion or rollback in the artifact domain invalidates downstream cache entries by changing the active artifact identity.
- Bounded origin-read fanout (one header read + one directory read + one tile read per cold archive) is enforced regardless of the configured backing so a misbehaving caller cannot fan out unbounded range reads against object storage.

## Dependency Direction

- May depend on `artifact`, `storage`, `config`, and `contracts`.
- Must not depend on `access`, `tile_api`, `raster_api`, or `render`.
