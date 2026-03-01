---
name: raster_api
description: "HTTP routing for raster tiles and static maps with caching + auth"
paths:
  types: src/domains/raster-api/types.ts
  service: src/domains/raster-api/raster-api.service.ts
  components: src/domains/raster-api/routes/
  tests: src/domains/raster-api/__tests__/
exports:
  - handleRasterTileRequest
  - handleStaticMapRequest
consumes:
  - access.authorizeTileRequest
  - render.renderRasterTile
  - render.renderStaticMap
  - config.TileDeliveryPolicy
  - contracts.AuthorizeContext
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/raster-api/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/raster-api/"
status: ready
---

# Raster API Domain

Owns HTTP request handling for raster tiles and static images.

## Endpoints

- `GET /v1/raster/:styleId/:z/:x/:y.(png|webp)`
- `GET /v1/static/:styleId/:lon,:lat,:zoom/:widthx:height.(png|webp)`
- `HEAD` support for raster/static responses
- `OPTIONS` for CORS preflight

## Component Insertion Points

- `src/domains/raster-api/routes/raster-route.ts`
- `src/domains/raster-api/routes/static-route.ts`
- `src/domains/raster-api/routes/health-route.ts`
- `src/domains/raster-api/__tests__/raster-api-routes.test.ts`

## Owned Invariants

- Uses `access` authorization and CORS decisions.
- Quota checks run before render work begins.
- Cache key excludes auth query params and includes style/version identity.
- Static map coordinates enforce geographic bounds (`lon: -180..180`, `lat: -90..90`).
- `HEAD` responses are only served when `HEAD_ENABLED=true`; if disabled, handlers return `405` with `HEAD_DISABLED`.
  `HEAD_DISABLED` responses for HEAD requests are body-less.

## Error Taxonomy

- `RASTER_BAD_COORDINATES`
- `RASTER_RENDER_FAILED`
- `RASTER_STYLE_NOT_FOUND`
- `RASTER_BAD_REQUEST`
- `STATIC_BAD_REQUEST`
- `HEAD_DISABLED`

## Dependency Direction

- May depend on `access`, `render`, `config`, and `contracts`.
- Must not be depended on by `access` or `render`.
