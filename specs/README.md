# Tileserver Domain Specs

This project is scoped to self-hosted maps and tile delivery only.

## Domains

- `specs/contracts.spec.md`: Stable shared contracts to avoid circular dependencies.
- `specs/config.spec.md`: Typed runtime configuration and secret validation.
- `specs/storage.spec.md`: Object-store access and range-read semantics.
- `specs/ingest.spec.md`: OSM sync and PMTiles artifact generation.
- `specs/artifact.spec.md`: Artifact catalog, promotion, and rollback.
- `specs/tile_api.spec.md`: Tile request routing, PMTiles lookup, and cache.
- `specs/access.spec.md`: Auth, CORS allowlist, and hotlink protection.
- `specs/observability.spec.md`: Logpush metrics, dashboards, and alerts.
- `specs/control_plane.spec.md`: Admin-only operations for ingest and artifact lifecycle.

## Dependency Graph (Acyclic)

- `contracts`: no domain dependencies
- `config`: no domain dependencies
- `storage`: depends on `config`
- `access`: depends on `config`, `contracts`
- `artifact`: depends on `storage`, `config`, `contracts`
- `ingest`: depends on `storage`, `config`, `contracts`
- `tile_api`: depends on `access`, `artifact`, `storage`, `config`, `contracts`
- `observability`: depends on `contracts`, `artifact`, `config`
- `control_plane`: depends on `ingest`, `artifact`, `config`

## Planned Code Insertion Roots

- `src/contracts/`
- `src/config/`
- `src/domains/storage/`
- `src/domains/ingest/`
- `src/domains/artifact/`
- `src/domains/tile-api/`
- `src/domains/access/`
- `src/domains/observability/`
- `src/domains/control-plane/`
