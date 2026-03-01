# Tileserver Domain Specs

This repository follows a spec-first model: every domain owns one markdown contract and one implementation surface.

Current baseline aligns to a Mapbox-style V1 roadmap (vector tiles, styles, raster/static rendering, quotas, docs, and operator control plane).

Storage policy baseline:
- `NODE_ENV=development` defaults to local development mode (`OBJECT_STORE_MODE=memory`).
- `NODE_ENV=staging|production` defaults to object-store-first mode (`OBJECT_STORE_MODE=s3-compatible`).

## Domains

- `specs/contracts.spec.md`: Stable shared contracts to avoid circular dependencies.
- `specs/config.spec.md`: Typed runtime configuration and secret validation.
- `specs/storage.spec.md`: Object-store access and range-read semantics.
- `specs/projects.spec.md`: Project registry, API keys, and project policy.
- `specs/metering.spec.md`: Quota/rate gating and pricing usage meter.
- `specs/ingest.spec.md`: OSM sync and PMTiles artifact generation.
- `specs/artifact.spec.md`: Artifact catalog, promotion, and rollback.
- `specs/tile_resolver.spec.md`: PMTiles tile/metadata resolution without HTTP concerns.
- `specs/styles.spec.md`: Style JSON registry, validation, and versioning.
- `specs/render.spec.md`: Raster/static rendering via pluggable adapters.
- `specs/tile_api.spec.md`: Vector tile request routing and cache policy.
- `specs/raster_api.spec.md`: Raster and static map routing with auth + cache.
- `specs/access.spec.md`: Auth, CORS, key identity, and pre-read quota checks.
- `specs/observability.spec.md`: Logpush metrics, dashboards, and alerts.
- `specs/control_plane.spec.md`: Admin-only operations for ingest/artifacts/styles/projects.
- `specs/studio.spec.md`: Admin style editing and publish flow.
- `specs/docs_site.spec.md`: Public docs and examples.

## Dependency Graph (Acyclic)

- `contracts`: no domain dependencies
- `config`: no domain dependencies
- `storage`: depends on `config`
- `projects`: depends on `config`
- `metering`: depends on `config`, `contracts`, `projects`
- `access`: depends on `config`, `contracts`, `projects`, `metering`
- `artifact`: depends on `storage`, `contracts`
- `tile_resolver`: depends on `artifact`, `storage`, `config`, `contracts`
- `styles`: depends on `storage`, `config`, `contracts`
- `render`: depends on `styles`, `tile_resolver`, `config`, `contracts`
- `ingest`: depends on `storage`, `config`, `contracts`
- `tile_api`: depends on `access`, `tile_resolver`, `config`, `contracts`
- `raster_api`: depends on `access`, `render`, `config`, `contracts`
- `observability`: depends on `contracts`, `config`
- `control_plane`: depends on `ingest`, `artifact`, `styles`, `projects`, `metering`, `config`
- `docs_site`: depends on `contracts` (+ optional `styles`)
- `studio`: depends on `styles` and `control_plane`

## Planned Code Insertion Roots

- `src/contracts/`
- `src/config/`
- `src/domains/storage/`
- `src/domains/projects/`
- `src/domains/metering/`
- `src/domains/ingest/`
- `src/domains/artifact/`
- `src/domains/tile-resolver/`
- `src/domains/styles/`
- `src/domains/render/`
- `src/domains/tile-api/`
- `src/domains/raster-api/`
- `src/domains/access/`
- `src/domains/observability/`
- `src/domains/control-plane/`
- `src/domains/studio/`
- `src/domains/docs-site/`

## Endpoint Contract Summary

- Vector tiles
  - `GET /v1/tiles/:z/:x/:y.mvt`
  - `GET /v1/tiles/metadata`
  - Methods: `GET`, `HEAD`, `OPTIONS`
- Health
  - `GET /v1/health` (via tile API routing surface)
- Styles
  - `GET /v1/styles`
  - `GET /v1/styles/:styleId/style.json`
  - `GET /v1/styles/:styleId/sprites/:name(@2x)?.(png|json)`
  - `GET /v1/fonts/:fontstack/:range.pbf`
- Raster
  - `GET /v1/raster/:styleId/:z/:x/:y.png`
  - `GET /v1/raster/:styleId/:z/:x/:y.webp`
- Static
  - `GET /v1/static/:styleId/:lon,:lat,:zoom/:widthx:height.png`
  - `GET /v1/static/:styleId/:lon,:lat,:zoom/:widthx:height.webp`
- Admin control plane
  - `POST /admin/ingest`
  - `POST /admin/artifacts/:versionId/promote`
  - `POST /admin/artifacts/rollback`
  - `POST /admin/projects`
  - `POST /admin/projects/:id/keys/rotate`
  - `GET /admin/projects/:id/usage`
  - `POST /admin/styles/:styleId/versions`
  - `POST /admin/styles/:styleId/publish/:versionId`
- Docs
  - `GET /docs`
  - `GET /docs/openapi.json`
  - `GET /docs/examples`
  - Method variants: `HEAD /docs`, `OPTIONS /docs`, `HEAD /docs/openapi.json`, `OPTIONS /docs/openapi.json`, `HEAD /docs/examples`, `OPTIONS /docs/examples`
