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

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. Ingest is operator-owned and consumed by the operator surface at `/ops/ingest` (see `admin_console.spec.md`). No customer-surface or auth/email touchpoints — existing invariants remain unchanged.

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
- Artifact publish completes before completion event emission.
- Duplicate runs are idempotent for the same source snapshot identity (`snapshotId + sourceUrl + expectedChecksum`).
- Source payload size is bounded by `INGEST_MAX_SOURCE_BYTES` before conversion/publish.
- Publish targets follow the storage domain configuration, including VPS-local filesystem roots for direct PMTiles serving.
- `file://` snapshot sources are strict local file URLs only and reject credentials, hostnames, query strings, and fragments so ingest cannot accept credential-like URL state through ad hoc local source paths.
- The exported ingest service surface must also fail closed on non-string runtime `snapshotId`, `sourceUrl`, and `expectedChecksum` fields with owned ingest errors instead of leaking raw string-operation failures from direct callers.
- The exported ingest service surface also fails closed on malformed non-object runtime snapshot payloads instead of leaking raw property-access failures from direct callers.
- The exported `emitIngestCompleted(...)` helper also validates runtime report shape and rejects malformed string, byte-size, or boolean fields with owned ingest errors instead of leaking bad event payloads from direct callers.

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

- Temporary workspace for intermediate files (cleaned up after each run regardless of outcome).
- Storage-backed PMTiles publish target:
  - local filesystem root for VPS-style direct serving, or
  - S3-compatible object storage when explicitly configured.
- Prisma `IngestRun` model holds the idempotency cache for `(snapshotId + sourceUrl + expectedChecksum)`. Successful runs persist their report (`artifactId`, `artifactKey`, `checksum`, `byteSize` (`BigInt` to support multi-gigabyte planet snapshots; narrowed to JS `number` at the domain boundary), `validated`, `startedAt`, `completedAt`, `durationMs`, `validationSummary`) keyed by the canonical cache key.

## SaaS Launch Baseline

- The ingest idempotency cache is Prisma-backed, so re-entrant runs with the same `(snapshotId, sourceUrl, expectedChecksum)` survive process restarts and stay deduplicated across multiple ingest workers without a shared in-memory cache.
- The per-process ingest lock still serializes concurrent runs of the same cache key inside a single worker. Cross-worker concurrency is bounded by the persistent `IngestRun` row: the second worker reads the persisted result rather than re-fetching/converting/publishing.
- Successful runs publish through the `storage` domain to the configured persistent backing (filesystem on VPS-style deployments, S3-compatible object storage when wired) and emit `ArtifactEvent` payloads consumed by the persistent artifact catalog.
- Ingest never writes the active artifact pointer; promotion is owned by the operator-triggered control-plane flow and lives entirely inside the `artifact` domain's persistent pointer.
- Source-size fuses (`INGEST_MAX_SOURCE_BYTES`) and conversion timeouts cap upstream/work cost so ingest cannot uncontrollably consume bandwidth or compute under abusive snapshot inputs.

## Dependency Direction

- May depend on `storage`, `config`, and `contracts`.
- Must not depend on `artifact`, `access`, or `tile_api`.
