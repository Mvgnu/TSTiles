---
name: contracts
description: "Shared, stable cross-domain types and event payload contracts"
paths:
  types: src/contracts/types.ts
  service: src/contracts/contracts.ts
  components: src/contracts/events/
  tests: src/contracts/__tests__/
exports:
  - TileCoordinates
  - AuthorizeContext
  - ContractError
  - ContractErrorCode
  - DeliverySignal
  - ArtifactEvent
  - IngestEvent
consumes: []
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/contracts/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/contracts/"
status: ready
---

# Contracts Domain

Owns shared request, response, and event contracts used across domains to prevent circular dependencies.

## Component Insertion Points

- `src/contracts/types.ts`
- `src/contracts/events/delivery-signal.ts`
- `src/contracts/events/artifact-events.ts`
- `src/contracts/events/ingest-events.ts`
- `src/contracts/__tests__/contracts-compatibility.test.ts`

## Public API Contract

- Shared contracts must be backward-compatible under semantic versioning.
- Domain-specific behavior must not live in this domain.

## Owned Invariants

- No runtime dependencies on business domains.
- Only transport-safe and serialization-safe types are exported.

## Error Taxonomy

- `CONTRACT_SCHEMA_INVALID`
- `CONTRACT_VERSION_UNSUPPORTED`

## Caching Semantics

- Not applicable for payload serving.

## Security and Privacy

- Shared types mark sensitive fields for redaction downstream.

## Data Stores

- None.

## Dependency Direction

- May depend on basic language/runtime libraries only.
- Must not depend on any `src/domains/*` module.
