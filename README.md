# Tileserver

A domain-first TypeScript tileserver scaffold that ships:

- Vector tile delivery from PMTiles artifacts
- Versioned style registry
- Raster tile rendering and static map rendering
- Project-scoped auth, quota enforcement, and usage telemetry
- Operator control plane for ingest/artifacts/projects/styles
- Public docs + examples

## Local quickstart

The default development server uses the checked-in PMTiles fixture. A planet
download and external object store are not required to prove the first tile
request.

```bash
nvm use
npm ci
export DATABASE_URL='file:./dev.db'
npm run demo:start
```

`file:./dev.db` is resolved by Prisma relative to `prisma/schema.prisma`, so the
local database is created at `prisma/dev.db`. In a second terminal, request the
fixture's one known tile with the development token:

```bash
curl --fail-with-body --show-error --dump-header - \
  --header 'Authorization: Bearer demo-public-token' \
  --output tile.mvt \
  http://127.0.0.1:8787/v1/tiles/0/0/0.mvt
wc -c tile.mvt
```

Success is HTTP `200`, `content-type: application/vnd.mapbox-vector-tile`, and
a non-zero byte count. `npm run readiness:check` automates that exact delivery
proof after lint, typecheck, tests, and build.

## What’s included

- `/src/contracts/*` – canonical contracts and event models used for cross-domain boundaries.
- `/src/config/*` – runtime + schema validation for environment and policy knobs.
- `/src/domains/*` – one domain per responsibility (`tile_api`, `raster_api`, `styles`, `render`, `access`, etc.).
- `/specs/*.spec.md` – authoritative domain specs with exports/consumes and verification commands.
- `/specs/README.md` – domain catalog + dependency graph.
- `/specs/release_readiness.md` – exit criteria tracker + current stop-point for release push.

## Runtime requirements

- Node.js 20 LTS or 22 (the optional `@maplibre/maplibre-gl-native` binding ships pre-built binaries for Node 18/20/22 on Linux + macOS; Node 24/25 currently fall back to the placeholder renderer)
- `DATABASE_URL` (Prisma datasource; SQLite supported out of the box, e.g. `file:./dev.db`)
- `OBJECT_STORE_BUCKET`
- `ADMIN_TOKEN`
- Object store mode:
  - `NODE_ENV=development` defaults `OBJECT_STORE_MODE=memory`
  - `NODE_ENV=staging|production` defaults `OBJECT_STORE_MODE=filesystem`
  - `OBJECT_STORE_MODE` can be explicitly set to `memory`, `filesystem`, or `s3-compatible`
  - `memory` mode is fail-fast rejected at startup outside `NODE_ENV=development`

## SaaS persistence baseline

Source of truth for tenant data, audit history, and billing state is Prisma-backed:

| Surface | Backing |
| --- | --- |
| Projects + API keys | `Project`, `ApiKey` |
| Usage + global fuse | `UsageBucket`, `GlobalBudgetBucket` |
| Artifacts + active pointer + rollback | `ArtifactVersion`, `ActiveArtifact`, `ArtifactPromotionHistory` |
| Style registry | `Style`, `StyleVersion` |
| Billing read model | `BillingSnapshot`, `CheckoutSession` |
| Admin audit + jobs | `AdminAuditEvent`, `AdminJob` |
| Ingest idempotency | `IngestRun` |

Run `npm run db:push` to synchronize the local SQLite database with the Prisma schema (the `demo:start` script does this automatically).

## Environment configuration

The following environment variables are required/used at startup:

- `OBJECT_STORE_BUCKET` (required)
- `ADMIN_TOKEN` (required)
- `ALLOWED_TILES_TOKENS` (comma-separated tokens)
- `OBJECT_STORE_MODE` (`memory`, `filesystem`, or `s3-compatible`; defaults to `memory` in development, `filesystem` otherwise)
- `OBJECT_STORE_BUCKET` is the local artifact root path in `filesystem` mode and the bucket name in `s3-compatible` mode

Optional runtime tuning:

- `ALLOWED_ORIGINS` (default `*`)
- `CORS_ALLOW_CREDENTIALS`
- `CORS_MAX_AGE_SECONDS` (default `600`)
- `ENABLE_RATE_LIMIT` (default `true`)
- `RATE_LIMIT_MAX_REQUESTS_PER_MINUTE` (default `120`)
- `STORAGE_MAX_RANGE_BYTES`
- `GLOBAL_REQUEST_BUDGET_PER_MINUTE` (default `0`, disabled; caps total accepted metered requests per minute)
- `CACHE_TTL_SECONDS`
- `METADATA_CACHE_TTL_SECONDS`
- `HEAD_ENABLED`
- `RENDER_TIMEOUT_MS` (default `15000`)
- `RENDER_MAX_CONCURRENT` (default `8`, `0` disables render work)
- `INGEST_SNAPSHOT_ID`
- `INGEST_SNAPSHOT_URL`
- `INGEST_EXPECTED_CHECKSUM`
- `INGEST_MAX_SOURCE_BYTES` (default `10737418240`, 10 GiB)
- Observability: `CACHE_WARN_THRESHOLD`, `CACHE_CRITICAL_THRESHOLD`, `ERROR_WARN_THRESHOLD`, `ERROR_CRITICAL_THRESHOLD`, `OBSERVABILITY_ENABLED`
- `OBSERVABILITY_LOG_SINK` (`none` (default), `stdout`, or `file:<path>`) – external NDJSON delivery telemetry sink, required as `stdout` or `file:<path>` for multi-instance SaaS deployments
- `IDENTITY_MANAGED_AUTH_MODE` (`header` enables the production managed-auth bridge via trusted `x-auth-*` headers; otherwise the dev-only demo-cookie flow remains active)
- `IDENTITY_STATE_FILE` (optional development snapshot path so identity survives process restarts when not on the managed-auth bridge)
- Stripe billing (required for hosted billing flows): `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_<PLAN>` for each billable plan, `STRIPE_WEBHOOK_SECRET` for verified webhook ingestion

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
- `GET /`
- `GET /pricing`
- `GET /legal/terms`
- `GET /legal/privacy`
- `GET /legal/dpa`
- `GET /legal/acceptable-use`
- `GET /status`
- `GET /sign-in`
- `GET /sign-up`
- `GET /app`, `/app/projects`, `/app/projects/new`, `/app/projects/:projectId`, `/app/projects/:projectId/usage`, `/app/styles`, `/app/styles/:styleId`, `/app/billing`, `/app/settings`
- `GET /docs`, `/docs/quickstart`, `/docs/authentication`, `/docs/maplibre`, `/docs/raster`, `/docs/static-maps`, `/docs/styles`, `/docs/api`, `/docs/examples`, `/docs/openapi.json`
- Admin (`/admin/*`): ingest, artifacts (list, promote, rollback), projects (create, key rotation, usage), styles (versions, publish), audit-events, jobs, and health
- Identity (`/app-api/session`, development-only `/auth/demo/sign-in`, development-only `/auth/demo/sign-out`): session resolution plus a development bridge that stays disabled outside development
- Customer console (`/app-api/*`): bootstrap, settings, projects, project usage, published styles, project detail/update, project key rotation, billing summary
- Billing (`/billing/*`, `/webhooks/stripe`): hosted checkout/portal session creation and Stripe webhook sync

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
- [identity](specs/identity.spec.md)
- [billing_sync](specs/billing_sync.spec.md)
- [customer_console](specs/customer_console.spec.md)
- [marketing_site](specs/marketing_site.spec.md)
- [app_console](specs/app_console.spec.md)

## Planning specs

- [frontend_saas](specs/frontend_saas.spec.md) - proposed customer-facing SaaS surface layered on top of the current backend, with marketing, docs, app console, and Stripe-managed billing boundaries.

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
- `src/domains/identity` resolves customer sessions and workspace membership for app surfaces.
- `src/domains/billing-sync` mirrors Stripe-managed billing state into a workspace-safe read model.
- `src/domains/customer-console` aggregates customer-safe bootstrap, project, usage, and snippet payloads.
- `src/domains/marketing-site` serves the public landing, pricing, legal, and auth entry shell.
- `src/domains/app-console` serves the authenticated overview, projects, styles, billing, and settings HTML shell.

## Domain status

Domain front-matter records spec lifecycle, not release evidence. Several specs
are still `in-review`, and `auth_flows` remains `planned`; see
[`specs/release_readiness.md`](specs/release_readiness.md) for current executable
evidence and blockers.

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
| identity | `src/domains/identity/*` | `npm run test:domains` |
| billing_sync | `src/domains/billing-sync/*` | `npm run test:domains` |
| customer_console | `src/domains/customer-console/*` | `npm run test:domains` |
| marketing_site | `src/domains/marketing-site/*` | `npm run test:domains` |
| app_console | `src/domains/app-console/*` | `npm run test:domains` |

## Validation quickstart

- `npm run typecheck`
- `npm run test:domains`
- `npm run test:app`
- `npm run smoke:e2e` (against a running server; defaults to `http://127.0.0.1:8787`)
- Optional health smoke:
  - `/v1/health` (liveness)
  - `/docs` (public docs payload)
  - `/v1/tiles/metadata` (tile metadata JSON)

## Verification

Run these from project root:

- `npm install`
- `npm run db:push` (syncs the local Prisma datasource with the schema)
- `npm run typecheck` (must pass before any release)
- `npm run test:platform` (config + contracts coverage)
- `npm run test:domains` (alias for domain test matrix)
- `npm run test:app` (demo/bootstrap runtime regression coverage)
- `npm run test:integration:s3` (opt-in MinIO/S3-compatible adapter integration)
- `npm run readiness:check` (db push + lint + typecheck + platform/domain/app tests + build + smoke)

CI (`.github/workflows/ci.yml`) enforces:
- `lint`
- `typecheck`
- `test:platform`
- `test:domains`
- `test:app`
- `smoke:e2e` against a built local demo server

S3-compatible integration CI:
- `.github/workflows/s3-integration.yml` runs MinIO-backed storage integration tests.

Post-deploy smoke automation:
- `.github/workflows/vps-smoke.yml` runs `smoke:e2e` against a provided deployed `BASE_URL` using `TILESERVER_SMOKE_TOKEN`.

Optional deep checks:

- `rg -n "status: draft" specs/*.spec.md` should return no results.
- `node -e "require('./package.json')"` to sanity-load project metadata.

## Demo and optional planet data

Open `http://127.0.0.1:8787/demo` after the local quickstart to inspect the
browser demo. The checked-in fixture is intentionally tiny and exists to make
startup, authentication, archive reads, and response headers deterministic.

Planet-scale data is a separate, optional operating mode. Download a PMTiles
archive wherever you keep local data, then set its path explicitly:

```bash
DEMO_PMTILES_PATH=/absolute/path/to/planet.pmtiles npm run demo:start
```

If the configured file or object key is unavailable, the server may still
serve non-delivery surfaces, but `npm run smoke:e2e` and
`npm run readiness:check` fail because shell-only availability is not tile
delivery success.

### Demo defaults

- PMTiles path: `src/domains/tile-resolver/__fixtures__/test_fixture_1.pmtiles`
- Style imports: `assets/styles/seed/style.json`, `assets/styles/seed/style-dark.json`, `assets/styles/seed/style-black.json`, `assets/styles/seed/style-grey.json`, `assets/styles/seed/style-white.json`
- Access token: first token from `ALLOWED_TILES_TOKENS` (defaults to `demo-public-token`)

### Useful env overrides

- `DEMO_PMTILES_PATH=/absolute/path/to/archive.pmtiles`
- `DEMO_PMTILES_KEY=artifacts/planet/20260228.pmtiles` (object-store key; use when explicitly running against `OBJECT_STORE_MODE=s3-compatible`)
- `STYLE_SEED_KEYS=styles/seed/style.json,styles/seed/style-dark.json`
- `DEMO_STYLE_FILES=/abs/path/style.json,/abs/path/style-dark.json` (development/local seed files)
- `PORT=8787`
- `HOST=127.0.0.1`

For VPS-local PMTiles serving, prefer `DEMO_PMTILES_PATH` with
`OBJECT_STORE_MODE=filesystem`. Production readiness additionally requires the
deployment, secrets, managed providers, migrations, and real-data checks listed
in `specs/release_readiness.md`.

## Notes

- Domain implementations are intentionally pure at boundary layers (e.g. routing, auth, cache/header behavior) so policy and renderer concerns stay isolated.
- Caching and quota checks are enforced before heavy render work in the raster/static request path.
- This repo is spec-first: any cross-domain interface change should be reflected first in the owning domain spec.
