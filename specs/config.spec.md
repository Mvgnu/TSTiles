---
name: config
description: "Runtime configuration loading, validation, and secret wiring"
paths:
  types: src/config/types.ts
  service: src/config/load-config.ts
  components: src/config/schema/
  tests: src/config/__tests__/
exports:
  - RuntimeConfig
  - SecurityConfig
  - TileDeliveryPolicy
  - ObservabilityConfig
  - loadConfig
consumes:
  - platform.environment
  - platform.worker_secrets
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/config/__tests__/"
  lint: "eslint src/config/"
---

# Config Domain

Owns strict configuration schemas, environment parsing, and fail-fast startup validation.

## Component Insertion Points

- `src/config/schema/runtime-schema.ts`
- `src/config/schema/security-schema.ts`
- `src/config/schema/observability-schema.ts`
- `src/config/load-config.ts`
- `src/config/__tests__/load-config.test.ts`

## Public API Contract

- `loadConfig(env: Record<string, string | undefined>): RuntimeConfig`
- Loaders return typed config or throw typed configuration errors.

## Owned Invariants

- All required config is validated at startup.
- Invalid config prevents service start.
- Secret values are never exposed in plain-text logs.

## Error Taxonomy

- `CONFIG_MISSING_REQUIRED`
- `CONFIG_INVALID_VALUE`
- `CONFIG_SECRET_UNAVAILABLE`

## Caching Semantics

- Static config is loaded once per process lifecycle.
- Hot-reload behavior is explicit and opt-in.

## Security and Privacy

- Secrets are read from platform secret stores only.
- Redaction helpers are provided for all config snapshots.

## Data Stores

- Environment variables and secret provider bindings.

## Dependency Direction

- May depend on runtime bindings and schema libraries.
- Must not depend on business domains.
