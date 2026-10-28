---
name: storage
description: "Object-store access, range reads, retry policy, and error normalization"
paths:
  types: src/domains/storage/types.ts
  service: src/domains/storage/storage.service.ts
  components: src/domains/storage/adapters/
  tests: src/domains/storage/__tests__/
exports:
  - StorageError
  - StorageErrorCode
  - ObjectStore
  - ObjectMetadata
  - RangeReadRequest
  - RangeReadResult
  - RetryPolicy
  - createObjectStore
consumes:
  - config.RuntimeConfig
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/storage/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/storage/"
status: ready
---

# Storage Domain

Owns object-store IO behavior, especially HTTP range semantics for PMTiles reads.

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain does not render UI and is not affected by the auth/email cross-cutting changes. Existing invariants (filesystem vs s3-compatible vs memory-dev-only, range-read bounds, sidecar content-type metadata) remain unchanged.

## Component Insertion Points

- `src/domains/storage/adapters/s3-compatible-client.ts`
- `src/domains/storage/adapters/range-reader.ts`
- `src/domains/storage/adapters/retry-policy.ts`
- `src/domains/storage/adapters/error-mapper.ts`
- `src/domains/storage/__tests__/range-reader.test.ts`

## Public API Contract

- `createObjectStore(config: RuntimeConfig): ObjectStore`
- `ObjectStore.getRange(input: RangeReadRequest): RangeReadResult`
- `ObjectStore.head(key: string): ObjectMetadata`

## Owned Invariants

- All range requests enforce bounded, validated byte intervals.
- Transport errors are normalized into typed storage errors.
- Retries are deterministic and capped by policy.
- `OBJECT_STORE_MODE=filesystem` supports immutable PMTiles writes and range reads under a configured local root, so a VPS can serve directly from uploaded artifacts without pre-rasterizing into S3.
- Filesystem-backed objects persist explicit content-type metadata across later `head` and `getRange` reads instead of falling back to extension inference after the initial write.
- That persisted filesystem content-type metadata is also reused by strict local `file://` reads when the sidecar metadata file is present, so ad hoc local verification paths stay consistent with normal filesystem-backed object reads.
- Malformed filesystem sidecar metadata also fails closed to normal content-type inference instead of taking down `head` / `getRange` reads, so corrupted `.meta.json` files cannot break storage availability.
- Unreadable or wrong-shaped filesystem sidecar metadata paths also fail closed to normal content-type inference instead of taking down `head` / `getRange` reads, so broken `.meta.json` paths cannot break storage availability.
- `OBJECT_STORE_MODE=s3-compatible` uses endpoint/credential-backed object IO (validated against MinIO integration coverage).
- Ad hoc `file://` object keys are strict local file URLs only and reject credentials, hostnames, query strings, and fragments so local development reads cannot smuggle credential-like URL state into filesystem resolution.
- Exported object-store entry points fail closed on non-string runtime object keys and content types instead of leaking raw runtime string-operation failures from direct callers.
- The exported `createObjectStore(...)` factory also fails closed on malformed runtime config input, including unsupported `storage.mode` values, instead of leaking raw property-access failures or silently falling back to the wrong backend.
- Exported object-store writes also fail closed on malformed non-`Uint8Array` payloads instead of leaking raw `.byteLength` access from direct callers.
- Exported object-store entry points also fail closed on malformed runtime range bounds, so direct `getRange(...)` callers cannot leak non-integer `start`/`end` values into range math.
- Exported object-store range reads also fail closed on malformed non-object runtime request payloads instead of leaking raw property-access failures from direct callers.

## Error Taxonomy

- `STORAGE_NOT_FOUND`
- `STORAGE_RANGE_INVALID`
- `STORAGE_PRECONDITION_FAILED`
- `STORAGE_TIMEOUT`

## Caching Semantics

- Storage layer itself does not implement edge cache policy.
- Adapter-level memoization is limited to safe metadata reads.

## Security and Privacy

- Credentials stay in memory only and are never serialized to logs.
- Request diagnostics redact signed URLs and auth headers.

## Data Stores

- Primary PMTiles backing store, either:
  - a local filesystem root (`OBJECT_STORE_MODE=filesystem`, with `OBJECT_STORE_BUCKET` treated as the root path), or
  - an S3-compatible bucket (`OBJECT_STORE_MODE=s3-compatible`).
- Ad hoc local file-backed reads are also supported through `file://` object keys.
- `OBJECT_STORE_MODE=memory` is a development-only convenience and is not a valid SaaS-launch backing.

## SaaS Launch Baseline

- Production and staging deployments must run with either `filesystem` or `s3-compatible` storage; `memory` is fail-fast rejected outside development by the config domain.
- Filesystem-backed deployments publish PMTiles directly under `OBJECT_STORE_BUCKET` so a single VPS instance can serve tiles without object storage; sidecar `.meta.json` content-type metadata is the source of truth for object content type and is preserved across restarts.
- S3-compatible deployments must use endpoint/credential-backed object IO and are validated against MinIO integration coverage so PMTiles range reads behave identically to AWS S3 range semantics.
- Range-read retry policy is deterministic and capped; the storage domain never silently swallows transport errors and never falls back to an unconfigured backing.

## Dependency Direction

- May depend on `config` and transport clients.
- Must not depend on `tile_api`, `artifact`, `ingest`, or `access`.
