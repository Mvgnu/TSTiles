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
  - RenderError
  - RenderErrorCode
  - renderRasterTile
  - renderStaticMap
consumes:
  - styles.getStyle
  - tile_resolver.resolveVectorTile
  - config.TileDeliveryPolicy
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/render/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/render/"
status: ready
---

# Render Domain

Owns raster tile and static image rendering, isolated from vector hot-path delivery.

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain is pure compute downstream of `access` (which now denies on workspace suspension / soft-delete). No direct cross-cutting effects — existing invariants remain unchanged.

## Component Insertion Points

- `src/domains/render/adapters/remote-renderer-client.ts`
- `src/domains/render/adapters/local-native-renderer.ts`
- `src/domains/render/render.service.ts`

## Public API Contract

- `renderRasterTile({ styleId, z, x, y, format, versionId? }): RenderedImage`
- `renderStaticMap({ styleId, lon, lat, zoom, width, height, overlays?, format, versionId? }): RenderedImage`

## Owned Invariants

- Renderer accepts style IDs/versions, not arbitrary user style JSON.
- Style IDs and optional version IDs must reject path separators and traversal markers, including exact `.`, at the render boundary.
- Style IDs and optional version IDs also fail closed on non-string runtime values at the render boundary instead of leaking raw string-operation failures from direct callers.
- `renderRasterTile(...)` and `renderStaticMap(...)` also fail closed on malformed non-object runtime request input instead of leaking raw property-access failures from direct callers.
- Render output cache keys include style version and artifact identity.
- Static map overlays are normalized and forwarded into the renderer backend, not only the cache key, so overlay-bearing requests produce distinct rendered output.
- Static map overlays are validated as a real string array at the render boundary, so malformed overlay containers or entries return `RENDER_BAD_REQUEST` instead of leaking generic runtime failures or being coerced into character lists.
- Raster tile requests also validate `z`, `x`, and `y` as integer tile coordinates at the render boundary, so malformed fractional coordinate input returns `RENDER_BAD_REQUEST` before tile resolution.
- Rendering is performed exclusively by the local `@maplibre/maplibre-gl-native` binding. There is no remote-renderer indirection; the previous `RENDER_BACKEND=remote` plumbing was removed because it added a code path with no production wiring.
- Static map lon/lat conversion keeps `lon=180` on the east-edge tile boundary.
- Static map coordinates are validated for Web Mercator bounds (`lon: -180..180`, `lat: -85.05112878..85.05112878`) before tile resolution.

## Error Taxonomy

- `RENDER_STYLE_NOT_FOUND`
- `RENDER_TILE_RESOLVE_FAILED`
- `RENDER_BACKEND_UNAVAILABLE`
- `RENDER_BAD_REQUEST`

## SaaS Launch Baseline

- **Adapter chain**: cartographic rendering is performed by `@maplibre/maplibre-gl-native` (Node binding, registered as an optional dependency so install succeeds on hosts without a pre-built wheel). The adapter:
  1. `renderLocally` builds a browser-style style document, instantiates a maplibre-native `Map`, and serves the renderer's `request` callback directly from owned domains:
     - **Tile** (kind 4): fetched from PMTiles via `tile-resolver.resolveArchiveTile` (no HTTP roundtrip).
     - **Glyph** (kind 5), **SpriteImage** (kind 6), **SpriteJSON** (kind 7): routed through the styles domain's static asset handler so labels and POI icons render correctly.
     - Other kinds receive an empty buffer so the renderer doesn't retry.
  2. The renderer outputs raw RGBA which is encoded to PNG or WebP using `sharp` (libvips). Both formats are real: PNG carries the `89 50 4E 47` signature, WebP carries `RIFF....WEBP`.
- **No silent fallback**: when the maplibre-native binding is unavailable (missing pre-built wheel for the running Node ABI, missing system libs, etc.) the renderer logs a one-time `[render] FATAL` message to stderr with actionable guidance and every raster/static request returns `RENDER_BACKEND_UNAVAILABLE` (mapped to HTTP `503`). No fake bytes; no smoke hiding the operational issue.
- The native binding ships pre-built binaries for Node 18 (ABI 115), Node 20 (ABI 127), and Node 22 (ABI 137) on Linux x64/arm64 and macOS x64/arm64. **Production deployments must run Node 20 LTS or 22** for raster/static rendering. Node 24/25 surface 503 until upstream ABI binaries are published or the binding is built from source.
- For raster tile requests, the source `(z, x, y)` is converted to a tile-center `(lon, lat)` and the tile zoom is used as the render zoom — the renderer composites the same tile pyramid the browser would request.
- For static map requests, the requested `(lon, lat, zoom, width, height)` is forwarded to the renderer directly.
- The render domain is stateless: each request resolves the configured backend through `config.tileDeliveryPolicy.renderBackend`, fetches the published style document and required tiles, and returns rendered bytes without local rendering caches.
- Per-instance render concurrency (`RENDER_MAX_CONCURRENT`) and per-request timeouts (`RENDER_TIMEOUT_MS`) are enforced at the render boundary so a single instance cannot be saturated by long-running renders.
- Cache keys for raster/static output include the published style version identity and active artifact identity; promotion/rollback or style publish events invalidate downstream caches by changing those identities rather than requiring explicit purge calls.
- Renderer adapters are pluggable (remote-renderer client or local-native renderer) and selected exclusively from validated runtime config; the domain refuses to start with an unsupported backend identifier.

## Dependency Direction

- May depend on `styles`, `tile_resolver`, and `config`.
- Must not depend on HTTP routing domains (`tile_api`, `raster_api`).
