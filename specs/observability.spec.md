---
name: observability
description: "Logpush analytics, cache hit telemetry, and alerting for tile delivery health"
paths:
  types: src/domains/observability/types.ts
  service: src/domains/observability/observability.service.ts
  components: src/domains/observability/analytics/
  tests: src/domains/observability/__tests__/
exports:
  - TileTrafficWindow
  - CacheHealthSignal
  - evaluateTileSLOs
  - classifySLOBreach
consumes:
  - contracts.DeliverySignal
  - config.ObservabilityConfig
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/observability/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/observability/"
status: ready
---

# Observability Domain

Owns cache ratio monitoring, origin egress tracking, and operational alerts for the tileserver platform.

## Component Insertion Points

- `src/domains/observability/analytics/logpush-schema.ts`
- `src/domains/observability/analytics/metrics-queries.sql`
- `src/domains/observability/analytics/dashboard-spec.json`
- `src/domains/observability/analytics/redaction.ts`
- `src/domains/observability/analytics/slo-policy.ts`
- `src/domains/observability/analytics/alerts.ts`
- `src/domains/observability/__tests__/cache-health-signals.test.ts`

## Public API Contract

- `evaluateTileSLOs(signal: DeliverySignal): CacheHealthSignal`
- `classifySLOBreach(window: TileTrafficWindow, policy?): "ok" | "warn" | "critical"`

## Owned Invariants

- SLO definitions are stable and versioned.
- Alerting logic uses redacted signal payloads only.
- Metrics are attributable by artifact version and endpoint group.
- Window aggregation clamps stale/future signal timestamps into bounded active windows.

## Error Taxonomy

- `OBS_SIGNAL_SCHEMA_INVALID`
- `OBS_SLO_THRESHOLD_MISCONFIGURED`

## Caching Semantics

- Observability endpoints are not cache-critical.
- Analytics windows default to 15-minute buckets.

## Security and Privacy

- Never stores raw tokens or full credential-bearing query strings.
- Redacts sensitive headers and referrer fragments before persistence.

## Data Stores

- Logpush sink dataset and derived metrics tables.
- Alert state history for deduplication and suppression windows.

## Dependency Direction

- May depend on `contracts` and `config`.
- Must not depend on `tile_api` response internals.
