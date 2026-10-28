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
  - access.resolveAllowedOrigins
  - render.renderRasterTile
  - render.renderStaticMap
  - render.RenderErrorCode
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

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain delegates auth/quota/suspension checks to `access`; the new `ACCESS_WORKSPACE_SUSPENDED` and `ACCESS_PROJECT_REVOKED` deny reasons map to HTTP `403` here with `cache-control: no-store`. Existing raster/static invariants remain unchanged.

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
- Optional `versionId` query params are forwarded into `render`, so raster/static HTTP routes can target non-published style versions without mutating the published pointer.
- Static map coordinates enforce geographic bounds (`lon: -180..180`, `lat: -85.05112878..85.05112878`).
- Static map image dimensions must be positive integers within the supported max size.
- Decoded raster/static style IDs reject path separators and traversal markers, including exact `.`.
- `HEAD` responses are only served when `HEAD_ENABLED=true`; if disabled, handlers return `405` with `HEAD_DISABLED`.
  `HEAD_DISABLED` responses for HEAD requests are body-less.
- Render calls are timeout-bounded via `config.tileDeliveryPolicy.renderTimeoutMs` (from `RENDER_TIMEOUT_MS`, default `15000`) and return `503` on timeout.
- Render calls enforce per-instance concurrency limits via `config.tileDeliveryPolicy.renderMaxConcurrent` (from `RENDER_MAX_CONCURRENT`, default `8`, `0` to hard-disable renders) and return `503` when saturated.
- OPTIONS preflight requests remain auth-optional, but if a token is provided (e.g., query token) CORS policy is resolved project-scoped; otherwise global allowlist fallback is used.
- Raw path query tokens remain authoritative when callers also pass a sparse `query` object, so `access_token` embedded in `path` is not erased by `query.access_token: undefined`.
- Query-token helpers also skip malformed non-string or blank leading `access_token[]` entries instead of trusting the first array slot and dropping later valid string tokens from direct callers.
- Query maps also fail closed on malformed non-array runtime values at the exported raster/static handler boundary, instead of letting object-like query entries drift deeper into auth or render dispatch.
- Exported raster/static route wrappers also fail closed on malformed runtime request objects or non-string `method` / `path` / header values, returning `RASTER_BAD_REQUEST` instead of leaking raw property-access failures from direct callers.
- Those exported raster/static route wrappers also reject malformed runtime query payloads instead of passing object-shaped junk through to service-layer normalization and only failing later.
- Post-auth render/style failures preserve the resolved request CORS policy (including project-scoped origins) while returning `cache-control: no-store`.

## Error Taxonomy

- `RASTER_BAD_COORDINATES`
- `RASTER_RENDER_FAILED`
- `RASTER_STYLE_NOT_FOUND`
- `RASTER_BAD_REQUEST`
- `STATIC_BAD_REQUEST`
- `HEAD_DISABLED`

## SaaS Launch Baseline

- The raster API is stateless: it owns route normalization, CORS materialization, response shaping, render-timeout/concurrency enforcement, and cache-control derivation. Identity and quota live in the persistent-backed `access` and `metering` domains; rendering lives in `render`.
- Cache keys include style identity (and explicit `versionId` when supplied) plus the active artifact identity so newly promoted/published changes invalidate cleanly without explicit purge calls.
- Render concurrency and timeout are enforced per request through validated runtime config so a single saturated instance can shed load with `503` rather than queuing indefinitely.
- Post-auth render/style failures preserve the resolved request CORS policy (project-scoped origins included) while explicitly returning `cache-control: no-store` so transient render failures cannot poison shared caches.

## Dependency Direction

- May depend on `access`, `render`, `config`, and `contracts`.
- Must not be depended on by `access` or `render`.
