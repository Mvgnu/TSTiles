---
name: ingest
description: "OSM source sync and transformation into PMTiles artifacts"
paths:
  types: src/domains/ingest/types.ts
  service: src/domains/ingest/ingest.service.ts
  components: src/domains/ingest/pipeline/
  tests: src/domains/ingest/__tests__/
exports:
  - PlanetSnapshot
  - IngestRunReport
  - runIngestPipeline
  - emitIngestCompleted
  - buildDefaultSnapshot
consumes:
  - osm.planet_latest
  - storage.ObjectStore
  - config.RuntimeConfig
  - contracts.IngestEvent
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/ingest/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/ingest/"
status: ready
---

# Ingest Domain

Owns download, verification, and conversion workflows from upstream OSM data to deployable PMTiles artifacts.

## Component Insertion Points

- `src/domains/ingest/pipeline/fetch-planet.ts`
- `src/domains/ingest/pipeline/verify-checksum.ts`
- `src/domains/ingest/pipeline/convert-to-pmtiles.ts`
- `src/domains/ingest/pipeline/probe-output.ts`
- `src/domains/ingest/pipeline/publish-artifact.ts`
- `src/domains/ingest/pipeline/lock.ts`
- `src/domains/ingest/pipeline/emit-events.ts`
- `src/domains/ingest/__tests__/ingest-pipeline.test.ts`

## Public API Contract

- `runIngestPipeline(snapshot: PlanetSnapshot): IngestRunReport`
- `emitIngestCompleted(report: IngestRunReport): IngestEvent`
- Output includes artifact key, checksum, byte size, and validation summary.

## Owned Invariants

- Ingest never mutates active artifact pointer directly.
- Upload completes before completion event emission.
- Duplicate runs are idempotent for the same source snapshot identity (`snapshotId + sourceUrl + expectedChecksum`).
- Source payload size is bounded by `INGEST_MAX_SOURCE_BYTES` before conversion/publish.

## Error Taxonomy

- `INGEST_SOURCE_UNAVAILABLE`
- `INGEST_SOURCE_TOO_LARGE`
- `INGEST_CHECKSUM_FAILED`
- `INGEST_CONVERSION_FAILED`
- `INGEST_PUBLISH_FAILED`

## Caching Semantics

- Ingest does not manage delivery caches.
- Emits immutable artifact identifiers used by downstream cache keys.

## Security and Privacy

- Upstream credentials are read from secrets and never logged.
- Conversion logs redact local temp paths that expose host topology.

## Data Stores

- Temporary workspace for intermediate files.
- Object-store write target for PMTiles artifact upload.

## Dependency Direction

- May depend on `storage`, `config`, and `contracts`.
- Must not depend on `artifact`, `access`, or `tile_api`.
