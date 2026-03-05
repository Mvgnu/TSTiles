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
- `OBJECT_STORE_MODE=s3-compatible` uses endpoint/credential-backed object IO (validated against MinIO integration coverage).

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

- Primary object store bucket(s) for PMTiles and metadata blobs.
- Development-only local file-backed reads are supported through `file://` object keys.

## Dependency Direction

- May depend on `config` and transport clients.
- Must not depend on `tile_api`, `artifact`, `ingest`, or `access`.
