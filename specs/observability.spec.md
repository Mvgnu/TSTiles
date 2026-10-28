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

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain does not render UI directly. Relevant cross-cutting effects for subagents:

- **Auth event log forwarding**: observability optionally consumes `IdentityAuthEvent` rows (from `identity`) when forwarded via the log sink, so external SIEMs can see sign-in successes/failures, lockouts, operator actions. The forwarding mechanism is the same NDJSON `OBSERVABILITY_LOG_SINK` that already carries delivery signals; auth events are emitted with `kind=auth_event` and full redaction of PII fields (`clientIpHash` and `userAgent` only, no raw IP/email).
- **Email dispatch telemetry**: observability also accepts `EmailDispatch` lifecycle events (`pending → sent | failed | suppressed`) for cross-instance dashboards; emitted with `kind=email_dispatch` and the same redaction rules.
- No change to existing delivery telemetry, SLO classification, or alert dispatch behavior.

## Component Insertion Points

- `src/domains/observability/analytics/logpush-schema.ts`
- `src/domains/observability/analytics/metrics-queries.sql`
- `src/domains/observability/analytics/dashboard-spec.json`
- `src/domains/observability/analytics/redaction.ts`
- `src/domains/observability/analytics/slo-policy.ts`
- `src/domains/observability/analytics/alerts.ts`
- `src/domains/observability/analytics/log-sink.ts`
- `src/domains/observability/__tests__/cache-health-signals.test.ts`
- `src/domains/observability/__tests__/log-sink.test.ts`

## Public API Contract

- `evaluateTileSLOs(signal: DeliverySignal): CacheHealthSignal`
- `classifySLOBreach(window: TileTrafficWindow, policy?): "ok" | "warn" | "critical"`

## Owned Invariants

- SLO definitions are stable and versioned.
- Alerting logic uses redacted signal payloads only.
- Metrics are attributable by artifact version and endpoint group.
- Window aggregation clamps stale/future signal timestamps into bounded active windows.
- `OPTIONS` preflight traffic does not increment delivery SLO counters; preflight-only signals must not dilute cache-hit or error-rate calculations for actual tile and metadata delivery.
- `classifySLOBreach(...)` rejects impossible aggregate windows such as negative counters or `cacheHits` / `errors` / `originReads` exceeding `totalRequests`, instead of emitting silent statuses from invalid data.
- `classifySLOBreach(...)` also rejects fractional aggregate counters; request/error/cache totals are integer counts at the exported boundary.
- `evaluateTileSLOs(...)` also rejects malformed direct-call signal payloads with fractional `responseBytes` or `latencyMs`, keeping exported observability input aligned with the integer-valued delivery contract instead of accepting impossible partial-byte or partial-millisecond telemetry.
- `classifySLOBreach(...)` also fails closed on malformed non-object runtime window input with `OBS_SIGNAL_SCHEMA_INVALID` instead of leaking raw property-access failures from direct callers.
- `classifySLOBreach(...)` also validates custom policy shape at the exported boundary and fails with `OBS_SLO_THRESHOLD_MISCONFIGURED` for non-object or malformed runtime policy inputs instead of leaking generic runtime failures.

## Error Taxonomy

- `OBS_SIGNAL_SCHEMA_INVALID`
- `OBS_SLO_THRESHOLD_MISCONFIGURED`
- `OBS_ALERT_DISPATCH_FAILED`

## Caching Semantics

- Observability endpoints are not cache-critical.
- Analytics windows default to 15-minute buckets.

## Security and Privacy

- Never stores raw tokens or full credential-bearing query strings.
- Redacts sensitive headers and referrer fragments before persistence.

## Data Stores

- Per-instance rolling SLO traffic windows (15-minute buckets, 3-window retention) used to evaluate cache and error thresholds at the request boundary.
- External Logpush-style sink and derived metrics tables (Cloudflare Logpush, OTLP collector, or equivalent) for cross-instance aggregation, dashboards, and historical analysis.
- Alert state history for deduplication and suppression windows.

## Request-path emission

- Tile, metadata, raster, and static responses emit a best-effort `DeliverySignal` after the HTTP response is sent (`src/app/demo-server.ts`):
  - `latencyMs` is measured from request received to response flushed.
  - `responseBytes` is derived from the actual response body byte length (or `content-length` for HEAD/204).
  - `statusCode` and `normalizedMethod` come from the routed response.
  - `artifactVersion` is parsed from the `x-tile-cache-key` response header (`{artifactVersion}:{normalizedPath}`) when present; otherwise the signal still records but SLO classification is skipped.
  - `cacheStatus` is `miss` and `originRead` is `true` because this origin has no in-process edge cache; CDN-level cache state is reported by the upstream layer.
- Emission is wrapped in try/catch so signals never break the request path.

## SaaS Launch Baseline

- Per-instance rolling windows are intentionally in-process and bounded; they exist to drive request-time SLO classification, not as the system of record for observability.
- The persistent system of record for delivery telemetry is the configured external sink. The runtime sink is selected via `OBSERVABILITY_LOG_SINK`:
  - `none` (default in development) — no external emission; in-process windows still drive SLO classification.
  - `stdout` — NDJSON delivery and alert records are emitted to `process.stdout`, suitable for container/Kubernetes log collectors and Logpush-equivalent ingestion.
  - `file:<path>` — NDJSON records appended to a local file, suitable for VPS deployments paired with an existing log shipper.
- Multi-instance SaaS deployments must run with `OBSERVABILITY_LOG_SINK=stdout` (or a mounted file path) so dashboards and alerts aggregate across instances.
- Sink emission is best-effort and never breaks the request path: write failures are swallowed, and `kind=none` short-circuits before any IO so observability disabled deployments pay no telemetry cost.
- Sink records carry only redacted data: tokens, signatures, security tokens, credential-bearing query parameters, and URL fragments are stripped before NDJSON serialization.
- SLO alert records are only emitted when classification is `warn` or `critical`; `ok` windows do not generate alert traffic so the sink remains useful as a true alert stream.
- Redaction runs before any signal leaves the process boundary; raw tokens, full credential-bearing query strings, and sensitive headers are stripped before persistence to the external sink.
- Alert dispatch is idempotent within a configurable suppression window keyed by `(artifactVersion, endpointGroup, status)`. Repeats inside the window are short-circuited with `suppressed status=...` and not emitted to the sink, so transient spikes do not produce duplicate pages.
- Suppression window defaults to 5 minutes per key; `setAlertSuppressionWindowMs(...)` can shorten or disable it for tests, and `resetAlertSuppressionState()` clears the in-memory dedup map between cold-start scenarios.

## Dependency Direction

- May depend on `contracts` and `config`.
- Must not depend on `tile_api` response internals.
