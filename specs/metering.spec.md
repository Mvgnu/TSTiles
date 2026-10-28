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
  - getBillingPlan
  - listBillingPlans
  - getUsageSummary
  - computeBillingEstimate
consumes:
  - contracts.DeliverySignal
  - config.TileDeliveryPolicy
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

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain does not render UI directly. Relevant cross-cutting effects for subagents:

- **Quota notifications**: metering MUST emit a typed `QUOTA_THRESHOLD_CROSSED` event when a workspace's monthly usage first crosses 80% and again when it first crosses 100% within the same monthly bucket. The event payload (`workspaceId`, `planId`, `usagePercent`, `window`, `thresholdId`) is consumed by `customer_console` which dispatches the corresponding `quota_approaching` / `quota_exceeded` email via the `email` domain and surfaces a banner in `app_console`. Idempotency key for the email dispatch is `(workspaceId, planId, monthlyWindowStart, thresholdPercent)` so re-entry across instances does not double-fire.
- **Workspace suspension**: when the owning workspace carries `suspendedAt`, `consumeRequestUnit` MUST deny with `denyReason: workspace_suspended` (mapped to `ACCESS_WORKSPACE_SUSPENDED` upstream). Usage continues to be recorded for forensic purposes but cannot be served against the suspended workspace.
- **Hard cap (100%)**: at 100% monthly usage, metering returns `denyReason: quota` and the upstream `access` domain returns `429 QUOTA_EXCEEDED` until the monthly window rolls over OR the workspace upgrades via Stripe Checkout (which propagates a new plan via `billing_sync` → `projects.syncWorkspaceProjectPlan`).
- **Global budget fuse**: existing `GLOBAL_REQUEST_BUDGET_PER_MINUTE` retained as the cross-tenant safety net.

## Component Insertion Points

- `src/domains/metering/metering.service.ts`

## Public API Contract

- `consumeRequestUnit(identity, endpointGroup): QuotaDecision` where `endpointGroup` is `tiles | raster | static`
- `recordDeliverySignal(signal: DeliverySignal): void` (fire-and-forget, non-blocking)
- `getBillingPlan(planId: string): BillingPlan`
- `listBillingPlans(): BillingPlan[]`
- `getUsageSummary(projectId: string, window: UsageCounterWindow): UsageSummary[]`
- `UsageSummary` includes request counts keyed by project/key/window/group.
- `computeBillingEstimate(summary, plan?): BillingEstimate`
- `ProjectPolicy.quotas` may include minute/day/month request ceilings depending on project configuration.

## Owned Invariants

- Allow/deny decisions are fast and deterministic.
- Delivery-signal recording is async and lossy; quota checks are strict, deterministic, and always checked first.
- Raw keys are never persisted; all records use hashed key identity.
- Metered identity tokens (`projectId`, `keyHash`, `planId`) must reject padded, path-like, or traversal-style values, including exact `.`, at the source boundary.
- Exported metering helpers also fail closed on non-string runtime `endpointGroup` and `planId` inputs: malformed endpoint groups are denied without counting usage, and malformed billing-plan lookups fall back to the free plan instead of leaking raw string-operation failures.
- `recordDeliverySignal(...)` also fails closed on malformed non-object or badly shaped runtime signal payloads instead of leaking raw property-access failures from direct callers.
- `getUsageSummary(...)` also fails closed on malformed runtime window input, returning an empty summary instead of leaking invalid values into bucket selection or storage queries.
- `getUsageSummary(...)` also fails closed on malformed persisted usage-bucket rows, skipping invalid stored records instead of leaking malformed summary entries out of the metering domain.
- `computeBillingEstimate(...)` normalizes usage-summary and explicit-plan `planId` values trim- and case-insensitively before matching, so exported billing estimates stay aligned with `getBillingPlan(...)`.
- `computeBillingEstimate(...)` also fails closed on malformed non-object runtime usage summaries instead of leaking raw property-access failures from direct callers.
- `computeBillingEstimate(...)` also rejects malformed summary counts such as negative or non-finite `requestCount` values instead of emitting nonsensical negative billing output.
- `computeBillingEstimate(...)` also rejects malformed explicit billing plans whose numeric fields are non-finite, negative, or non-integer where whole-request allowances are expected, instead of emitting nonsensical billing output from impossible plan metadata.
- Minute window breaches return `denyReason: rate_limit`.
- Optional global minute fuse (`GLOBAL_REQUEST_BUDGET_PER_MINUTE`) caps total accepted metered requests across endpoint groups.

## Error Taxonomy

- `METERING_BAD_IDENTITY`

Quota/rate-limit outcomes are returned in `QuotaDecision.denyReason` (`quota` or `rate_limit`) rather than thrown as typed errors.

## Pricing Meter

- Plan defines free monthly allowance and overage price per 1k requests.
- Billing estimate runs on monthly buckets keyed by project and plan.

## Data Stores

- Prisma `UsageBucket` model for per-project/per-key/per-window/per-endpoint-group request counts.
- Prisma `GlobalBudgetBucket` model for the cross-tenant minute-window service fuse.
- Bucket retention is bounded by window age; expired bucket rows are eligible for cleanup and never participate in quota or estimate decisions.

## SaaS Launch Baseline

- Quota and rate-limit decisions must be derived from the persistent `UsageBucket` and `GlobalBudgetBucket` rows so usage is consistent across multiple service instances and survives process restarts.
- In-memory counters are acceptable only as a transient hot-path cache in front of the persistent buckets and must not be the source of truth for quota gating or billing estimates.
- Billing-plan metadata stays in code as the authoritative pricing catalog; pricing changes ship through code and are reflected immediately in summaries and estimates.

## Dependency Direction

- May depend on `contracts` and `projects`.
- Must not depend on request routing domains.
