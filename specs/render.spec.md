---
name: render
description: "Raster tile + static map rendering from vector tiles and style documents (pluggable renderer)"
paths:
  types: src/domains/render/types.ts
  service: src/domains/render/render.service.ts
  components: src/domains/render/adapters/
  tests: src/domains/render/__tests__/
exports:
  - RasterTileRequest
  - StaticMapRequest
  - RenderedImage
  - renderRasterTile
  - renderStaticMap
consumes:
  - styles.getStyle
  - tile_resolver.resolveVectorTile
  - config.RuntimeConfig
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/render/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/render/"
status: ready
---

# Render Domain

Owns raster tile and static image rendering, isolated from vector hot-path delivery.

## Component Insertion Points

- `src/domains/render/adapters/remote-renderer-client.ts`
- `src/domains/render/adapters/local-native-renderer.ts`
- `src/domains/render/render.service.ts`

## Public API Contract

- `renderRasterTile({ styleId, z, x, y, format, versionId? }): RenderedImage`
- `renderStaticMap({ styleId, lon, lat, zoom, width, height, overlays?, format, versionId? }): RenderedImage`

## Owned Invariants

- Renderer accepts style IDs/versions, not arbitrary user style JSON.
- Render output cache keys include style version and artifact identity.
- Renderer backend is pluggable (`remote` first, `local-native` later).
- Static map lon/lat conversion keeps `lon=180` on the east-edge tile boundary.

## Error Taxonomy

- `RENDER_STYLE_NOT_FOUND`
- `RENDER_TILE_RESOLVE_FAILED`
- `RENDER_BACKEND_UNAVAILABLE`
- `RENDER_BAD_REQUEST`

## Dependency Direction

- May depend on `styles`, `tile_resolver`, and `config`.
- Must not depend on HTTP routing domains (`tile_api`, `raster_api`).
