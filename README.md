# Tileserver (Mapbox-ish V1)

A domain-first TypeScript tileserver scaffold that ships:

- Vector tile delivery from PMTiles artifacts
- Versioned style registry
- Raster tile rendering and static map rendering
- Project-scoped auth, quota enforcement, and usage telemetry
- Operator control plane for ingest/artifacts/projects/styles
- Public docs + examples

## What’s included

- `/src/contracts/*` – canonical contracts and event models used for cross-domain boundaries.
- `/src/config/*` – runtime + schema validation for environment and policy knobs.
- `/src/domains/*` – one domain per responsibility (`tile_api`, `raster_api`, `styles`, `render`, `access`, etc.).
- `/specs/*.spec.md` – authoritative domain specs with exports/consumes and verification commands.
- `/specs/README.md` – domain catalog + dependency graph.

## Runtime requirements

- Node.js 20+
- `OBJECT_STORE_BUCKET`
- `ADMIN_TOKEN`
- Object store mode:
  - `NODE_ENV=development` defaults `OBJECT_STORE_MODE=memory`
  - `NODE_ENV=staging|production` defaults `OBJECT_STORE_MODE=s3-compatible`
  - `OBJECT_STORE_MODE` can be explicitly set to `memory` or `s3-compatible`

## Environment configuration

The following environment variables are required/used at startup:

- `OBJECT_STORE_BUCKET` (required)
- `ADMIN_TOKEN` (required)
- `ALLOWED_TILES_TOKENS` (comma-separated tokens)
- `OBJECT_STORE_MODE` (`memory` or `s3-compatible`; defaults to `memory` in development, `s3-compatible` otherwise)

Optional runtime tuning:

- `ALLOWED_ORIGINS` (default `*`)
- `CORS_ALLOW_CREDENTIALS`
- `CORS_MAX_AGE_SECONDS` (default `600`)
- `ENABLE_RATE_LIMIT` (default `true`)
- `RATE_LIMIT_MAX_REQUESTS_PER_MINUTE` (default `120`)
- `STORAGE_MAX_RANGE_BYTES`
- `CACHE_TTL_SECONDS`
- `METADATA_CACHE_TTL_SECONDS`
- `HEAD_ENABLED`
- `INGEST_SNAPSHOT_ID`
- `INGEST_SNAPSHOT_URL`
- `INGEST_EXPECTED_CHECKSUM`
- Observability: `CACHE_WARN_THRESHOLD`, `CACHE_CRITICAL_THRESHOLD`, `ERROR_WARN_THRESHOLD`, `ERROR_CRITICAL_THRESHOLD`, `OBSERVABILITY_ENABLED`

## Public API contract (spec-aligned)

- `GET /v1/tiles/:z/:x/:y.mvt` (`GET`, `HEAD`, `OPTIONS`)
- `GET /v1/tiles/metadata` (`GET`, `HEAD`, `OPTIONS`)
- `GET /v1/styles`
- `GET /v1/styles/:styleId/style.json`
- `GET /v1/styles/:styleId/sprites/:name(@2x)?.(png|json)`
- `GET /v1/fonts/:fontstack/:range.pbf`
- `GET /v1/raster/:styleId/:z/:x/:y.(png|webp)`
- `GET /v1/static/:styleId/:lon,:lat,:zoom/:widthx:height.(png|webp)`
- `GET /v1/health`
- `GET /docs`, `/docs/openapi.json`, `/docs/examples`
- Admin (`/admin/*`): ingest, artifacts, projects, styles, and usage endpoints

## Domain spec coverage

- [contracts](specs/contracts.spec.md)
- [config](specs/config.spec.md)
- [storage](specs/storage.spec.md)
- [projects](specs/projects.spec.md)
- [metering](specs/metering.spec.md)
- [artifact](specs/artifact.spec.md)
- [ingest](specs/ingest.spec.md)
- [tile_resolver](specs/tile_resolver.spec.md)
- [styles](specs/styles.spec.md)
- [render](specs/render.spec.md)
- [tile_api](specs/tile_api.spec.md)
- [raster_api](specs/raster_api.spec.md)
- [access](specs/access.spec.md)
- [observability](specs/observability.spec.md)
- [control_plane](specs/control_plane.spec.md)
- [studio](specs/studio.spec.md)
- [docs_site](specs/docs_site.spec.md)

## Project domain map

The system is implemented as one domain per file cluster:

- `src/contracts` contains canonical request/response and event contracts.
- `src/config` contains typed runtime configuration.
- `src/domains/storage` handles object-store adapters.
- `src/domains/artifact` stores artifact metadata and promotion flow.
- `src/domains/projects` and `src/domains/metering` own auth + quota state.
- `src/domains/access` performs auth, CORS, and short-circuit deny decisions.
- `src/domains/tile-resolver` resolves PMTiles bytes from storage.
- `src/domains/tile-api` and `src/domains/raster-api` expose vector/raster endpoints.
- `src/domains/styles`, `src/domains/render`, and `src/domains/studio` handle style lifecycle and render input.
- `src/domains/control-plane` owns admin mutation routes.
- `src/domains/docs-site` publishes public docs and OpenAPI-like payloads.
- `src/domains/observability` evaluates cache/latency signals.

## Domain status

Current implementation status is tracked in domain specs (`status: ready` on all domain specs).

| Domain | Primary artifacts | Verification |
| --- | --- | --- |
| contracts | `src/contracts/*`, `src/contracts/contracts.ts` | `npm run typecheck` |
| config | `src/config/*` | `npx vitest run src/config/__tests__/ --globals --passWithNoTests` |
| storage | `src/domains/storage/*` | `npm run test:domains` |
| projects | `src/domains/projects/*` | `npm run test:domains` |
| metering | `src/domains/metering/*` | `npm run test:domains` |
| artifact | `src/domains/artifact/*` | `npm run test:domains` |
| ingest | `src/domains/ingest/*` | `npm run test:domains` |
| tile_resolver | `src/domains/tile-resolver/*` | `npm run test:domains` |
| styles | `src/domains/styles/*` | `npm run test:domains` |
| render | `src/domains/render/*` | `npm run test:domains` |
| tile_api | `src/domains/tile-api/*` | `npm run test:domains` |
| raster_api | `src/domains/raster-api/*` | `npm run test:domains` |
| access | `src/domains/access/*` | `npm run test:domains` |
| observability | `src/domains/observability/*` | `npm run test:domains` |
| control_plane | `src/domains/control-plane/*` | `npm run test:domains` |
| studio | `src/domains/studio/*` | `npm run test:domains` |
| docs_site | `src/domains/docs-site/*` | `npm run test:domains` |

## Validation quickstart

- `npm run typecheck`
- `npm run test:domains`
- Optional health smoke:
  - `/v1/health` (liveness)
  - `/docs` (public docs payload)
  - `/v1/tiles/metadata` (tile metadata JSON)

## Verification

Run these from project root:

- `npm install`
- `npm run typecheck` (must pass before any release)
- `npm run test:domains` (alias for domain test matrix)

Optional deep checks:

- `rg -n "status: draft" specs/*.spec.md` should return no results.
- `node -e "require('./package.json')"` to sanity-load project metadata.

## ExtSSD E2E demo

This repo now includes a runnable local HTTP server that composes all domain routes end to end and exposes a browser demo at `/demo`.

1. Download (or continue downloading) the PMTiles file to your external drive:

   - `mkdir -p /Volumes/ExtSSD/tileserver-data`
   - `curl -L --continue-at - --output /Volumes/ExtSSD/tileserver-data/20260228.pmtiles https://build.protomaps.com/20260228.pmtiles`

2. Start the demo server:

   - `npm run demo:start`

3. Open:

   - `http://127.0.0.1:8787/demo`
   - The demo now includes an interactive MapLibre map backed by `/demo/data.pmtiles`.

### Demo defaults

- PMTiles path: `/Volumes/ExtSSD/tileserver-data/20260228.pmtiles`
- Style imports: `assets/styles/seed/style.json`, `assets/styles/seed/style-dark.json`, `assets/styles/seed/style-black.json`, `assets/styles/seed/style-grey.json`, `assets/styles/seed/style-white.json`
- Access token: first token from `ALLOWED_TILES_TOKENS` (defaults to `demo-public-token`)

### Useful env overrides

- `DEMO_PMTILES_PATH=/Volumes/ExtSSD/tileserver-data/20260228.pmtiles`
- `DEMO_PMTILES_KEY=artifacts/planet/20260228.pmtiles` (object-store key; recommended outside development)
- `STYLE_SEED_KEYS=styles/seed/style.json,styles/seed/style-dark.json`
- `DEMO_STYLE_FILES=/abs/path/style.json,/abs/path/style-dark.json` (development/local seed files)
- `PORT=8787`
- `HOST=127.0.0.1`

## Notes

- Domain implementations are intentionally pure at boundary layers (e.g. routing, auth, cache/header behavior) so policy and renderer concerns stay isolated.
- Caching and quota checks are enforced before heavy render work in the raster/static request path.
- This repo is spec-first: any cross-domain interface change should be reflected first in the owning domain spec.
