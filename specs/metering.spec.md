---
name: metering
description: "Per-key usage counters, quota enforcement, and pricing meter"
paths:
  types: src/domains/metering/types.ts
  service: src/domains/metering/metering.service.ts
  components: src/domains/metering/
  tests: src/domains/metering/__tests__/
exports:
  - UsageUnit
  - UsageCounterWindow
  - QuotaDecision
  - UsageSummary
  - BillingPlan
  - BillingEstimate
  - MeteringError
  - MeteringErrorCode
  - consumeRequestUnit
  - recordDeliverySignal
  - getUsageSummary
  - computeBillingEstimate
consumes:
  - contracts.DeliverySignal
  - projects.ProjectPolicy
  - projects.getProjectPolicy
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/metering/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/metering/"
status: ready
---

# Metering Domain

Owns usage accounting and quota gating before cache/origin reads.

## Component Insertion Points

- `src/domains/metering/metering.service.ts`

## Public API Contract

- `consumeRequestUnit(identity, endpointGroup): QuotaDecision` where `endpointGroup` is `tiles | raster | static`
- `recordDeliverySignal(signal: DeliverySignal): void` (fire-and-forget, non-blocking)
- `getUsageSummary(projectId: string, window: UsageCounterWindow): UsageSummary[]`
- `UsageSummary` includes request counts keyed by project/key/window/group.
- `computeBillingEstimate(summary, plan?): BillingEstimate`
- `ProjectPolicy.quotas` may include minute/day/month request ceilings depending on project configuration.

## Owned Invariants

- Allow/deny decisions are fast and deterministic.
- Delivery-signal recording is async and lossy; quota checks are strict, deterministic, and always checked first.
- Raw keys are never persisted; all records use hashed key identity.
- Minute window breaches return `denyReason: rate_limit`.

## Error Taxonomy

- `METERING_BAD_IDENTITY`

Quota/rate-limit outcomes are returned in `QuotaDecision.denyReason` (`quota` or `rate_limit`) rather than thrown as typed errors.

## Pricing Meter

- Plan defines free monthly allowance and overage price per 1k requests.
- Billing estimate runs on monthly buckets keyed by project and plan.

## Dependency Direction

- May depend on `contracts` and `projects`.
- Must not depend on request routing domains.
