---
name: billing_sync
description: "Workspace billing read model, hosted Stripe session boundaries, and webhook-driven subscription state"
paths:
  types: src/domains/billing-sync/types.ts
  service: src/domains/billing-sync/billing-sync.service.ts
  components: src/domains/billing-sync/
  tests: src/domains/billing-sync/__tests__/
exports:
  - BillingPlanId
  - BillingSubscriptionStatus
  - BillingSnapshot
  - CheckoutSessionInput
  - CheckoutSession
  - BillingPortalSessionInput
  - BillingPortalSession
  - StripeWebhookEvent
  - BillingSyncError
  - BillingSyncErrorCode
  - getWorkspaceBilling
  - createCheckoutSession
  - createBillingPortalSession
  - applyStripeWebhookEvent
consumes:
  - identity.requireSession
  - metering.getBillingPlan
  - metering.listBillingPlans
  - projects.syncWorkspaceProjectPlan
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/billing-sync/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/billing-sync/"
status: ready
---

# Billing Sync Domain

Owns the customer-facing billing read model and the minimal Stripe-managed billing boundary required by the frontend SaaS plan.

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`. Subagents working only on this spec MUST treat the following as binding without reading other specs.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Dark parity uses the matching tokens. Inter sans + JetBrains Mono. WCAG AA, 2px focus ring, keyboard reachable. Billing-sync itself does not render UI but its mirrored state is consumed by `app_console` (`/app/billing`) and `marketing_site` (`/pricing`), both of which honor the design tokens.
- **Surfaces**: customer routes `/`, `/app`, `/app-api`, `/billing`, `/docs`, `/legal`, `/security`, `/status`, `/v1/*` use `app_session`. Billing-sync customer-facing routes (`/app-api/billing`, `/billing/checkout`, `/billing/portal`) require `requireCustomerSession`. Webhook ingestion at `/webhooks/stripe` is unauthenticated by session but signature-verified.
- **Auth**: v1 is first-party email + password + email verification + magic link, owned by `auth_flows`. Customer-facing billing routes require a verified customer session. Managed-auth header bridge supported. Demo bridge gated to `NODE_ENV=development`.
- **Email**: Brevo only via `email.sendTransactionalEmail`. Billing-sync triggers transactional mail in response to mirrored Stripe events: `billing_receipt` on `invoice.paid`, `plan_change_confirmation` on `customer.subscription.updated` (when plan changes), and forwards `quota_exceeded`-equivalent state on `invoice.payment_failed` (via `customer_console` notification surface, no separate email). Send failures never block webhook processing.
- **SaaS fundamentals**: Stripe is the source of truth; billing-sync mirrors only. Workspace `billing_email` defaults to the owner's account email but is overridable in `/app/settings`. Plan-change events propagate onto workspace-owned projects via `projects.syncWorkspaceProjectPlan`.

## Component Insertion Points

- `src/domains/billing-sync/billing-sync.service.ts`
- `src/domains/billing-sync/__tests__/billing-sync-service.test.ts`

## Public API Contract

- `getWorkspaceBilling(workspaceId: string): BillingSnapshot`
- `createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>`
- `createBillingPortalSession(input: BillingPortalSessionInput): Promise<BillingPortalSession>`
- `applyStripeWebhookEvent(event: StripeWebhookEvent): BillingSnapshot`

## Endpoint Surface

- `GET /app-api/billing`
- `POST /billing/checkout`
- `POST /billing/portal`
- `POST /webhooks/stripe`
- `OPTIONS` preflight for all billing and webhook endpoints

## Owned Invariants

- Unknown workspaces resolve to a deterministic free-tier billing snapshot.
- Billing truth is webhook-driven; checkout and portal flows only produce hosted Stripe session references.
- Workspace billing state is keyed by workspace and mirrored from Stripe identifiers when available.
- `checkout.session.completed` also mirrors any provided Stripe customer and subscription identifiers immediately, so later subscription and invoice events can correlate against the in-flight checkout snapshot without waiting for a follow-up subscription update.
- Plan IDs are validated against the metering domain so the app and billing surfaces share one pricing source.
- Exported billing service inputs reject path-like or traversal-style identifiers, including embedded traversal markers, at the source boundary, and mirrored webhook `planId` values are validated across all subscription and invoice event handlers before persistence.
- Exported billing service inputs also fail closed on non-string runtime values for identifiers, URLs, and ISO date fields; malformed direct callers must get `BILLING_SYNC_BAD_REQUEST`, not raw runtime errors.
- Exported billing service inputs also fail closed on malformed runtime webhook string fields such as `type`, `subscriptionStatus`, and `billingEmail`; direct callers must get `BILLING_SYNC_BAD_REQUEST`, not raw string-operation failures.
- Optional mirrored webhook strings such as `billingEmail` also treat blank-string input as omitted instead of failing the whole event, so provider payloads that omit customer email via empty strings preserve the current mirrored value.
- Optional mirrored webhook identifiers and timestamps such as `sessionId`, `stripeCustomerId`, `stripeSubscriptionId`, `occurredAt`, and `currentPeriodEnd` also treat blank-string input as omitted instead of failing the whole event, so provider payload drift preserves the current mirrored correlation and period-end data.
- Exported checkout, portal, and webhook helpers also fail closed on malformed non-object runtime input payloads with `BILLING_SYNC_BAD_REQUEST` instead of leaking raw property-access failures from direct callers.
- Exported billing route helpers also fail closed on malformed runtime request objects or non-string `method` / `path` / header values with `BILLING_SYNC_BAD_REQUEST`, instead of leaking raw property-access failures from direct callers.
- Checkout and portal route helpers also reject malformed non-object request bodies at the route boundary instead of coercing primitives into empty payloads and leaking validation responsibility downstream.
- Exported billing service inputs also fail closed on malformed runtime booleans such as `cancelAtPeriodEnd`; direct webhook callers must not persist non-boolean mirrored state.
- Persisted billing snapshots are re-validated on read and persistence boundaries, so malformed stored plan IDs, statuses, identifiers, or timestamps fail with owned `BILLING_SYNC_BAD_REQUEST` errors instead of leaking invalid mirrored state into billing reads, portal gating, or webhook correlation.
- Invoice webhook handlers also fail closed when the resulting mirrored plan would remain `free`; they do not persist impossible `free + past_due` or `free + paid-invoice` snapshots when Stripe payloads omit `planId` and no existing paid plan is known.
- Checkout completion webhooks also fail closed when they cannot resolve a non-free plan from the pending checkout session, webhook payload, or current snapshot; they do not persist impossible `free + checkout_pending` state.
- Direct subscription create/update mirror events must resolve to a non-free plan; the service fails closed instead of persisting impossible `active` or `trialing` states on the free tier when a webhook payload omits `planId`.
- Terminal subscription deletion events downgrade the mirrored workspace plan back to `free`.
- Confirmed subscription plan changes are propagated onto workspace-owned projects while projects still store `planId` directly.
- Invoice-driven webhook events may refresh mirrored billing email and period-end data, and `invoice.paid` can recover an out-of-order free snapshot into an active paid state when Stripe has already billed a non-free plan.
- The domain never computes invoice state beyond mirroring Stripe lifecycle events into a customer-safe read model.
- User-facing billing routes require identity-backed sessions; webhook sync remains unauthenticated.
- User-facing billing routes must also honor the production managed-auth bridge exposed by `identity`, and their preflight/CORS surface must advertise the trusted `x-auth-*` headers when that bridge is used.
- User-facing billing route preflight/CORS responses must only advertise those trusted `x-auth-*` headers when the managed-auth bridge is enabled, so hosted billing surfaces do not claim unsupported provider headers while local/demo auth is active.
- Webhook preflight must advertise `stripe-signature` on `/webhooks/stripe`, matching the signature-verification header consumed when Stripe webhook signing is enabled.
- Checkout session creation requires `STRIPE_SECRET_KEY` plus plan-specific `STRIPE_PRICE_ID_<PLAN>` configuration.
- Hosted checkout and billing-portal session responses must return absolute `http(s)` URLs; malformed or non-web Stripe URL payloads fail closed at the billing-sync boundary.
- Hosted checkout and portal redirect URLs must stay on the current app origin and only target in-product `/app` or `/pricing` paths. When `Origin` is absent, any `x-forwarded-host`/`host` fallback must still resolve to a clean origin, not a path-bearing or credential-bearing URL fragment.
- When `STRIPE_WEBHOOK_SECRET` is configured, webhook routes require the raw request body so Stripe signatures can be verified.
- That raw signed webhook body may arrive as either a UTF-8 string or a `Uint8Array`, and both shapes must verify identically at the route boundary.

## Error Taxonomy

- `BILLING_SYNC_BAD_REQUEST`
- `BILLING_SYNC_NOT_FOUND`
- `BILLING_SYNC_CONFLICT`

## Data Stores

- Prisma `BillingSnapshot` model holds the mirrored Stripe billing read model keyed by `workspaceId`, including `planId`, `subscriptionStatus`, `stripeCustomerId`, `stripeSubscriptionId`, `billingEmail`, `currentPeriodEnd`, `cancelAtPeriodEnd`, and `lastWebhookAt`.
- Prisma `CheckoutSession` model holds in-flight hosted checkout references (`sessionId`, `workspaceId`, `planId`, `successUrl`, `cancelUrl`, `createdAt`, `expiresAt`) so subscription/invoice events can correlate against the originating checkout when Stripe payloads omit `planId`.
- Prisma `BillingWebhookEvent` model holds processed Stripe event ids (`eventId`, `workspaceId`, `type`, `occurredAt`, `recordedAt`) for at-least-once webhook deduplication.
- Workspace plan propagation onto workspace-owned projects runs through `projects.syncWorkspaceProjectPlan` inside the same persistence boundary so mirrored billing changes and downstream project rows stay aligned.
- Persistent webhook + checkout retention is bounded: rows older than 30 days are swept on an amortized basis (sweep runs after every Nth processed webhook). Sweeps also remove `CheckoutSession` rows whose `expiresAt` has passed, since Stripe's hosted checkout sessions cannot be resumed once expired.

## SaaS Launch Baseline

- The billing read model must be served exclusively from `BillingSnapshot` and never reconstructed from in-memory state, so multi-instance deployments and webhook processors share a single consistent view of subscription state.
- Stripe remains the source of truth; the persistent snapshot is a strictly mirrored, webhook-driven projection used to drive UI and effective plan resolution.
- Hosted checkout/portal session creation must persist the originating `CheckoutSession` row before redirecting customers, so completion webhooks have a deterministic correlation key even if Stripe payload metadata varies.
- Webhook processing must fail closed before persisting impossible mirrored state (`free + checkout_pending`, `free + paid-invoice`, `active`/`trialing` on `free`); such payloads are rejected rather than written through to the persistent snapshot.
- Stripe webhook delivery is at-least-once. `applyStripeWebhookEvent` must dedupe by Stripe event id (`evt_...`) via `BillingWebhookEvent`: a duplicate delivery short-circuits to the current persisted snapshot before any mutation runs. The webhook envelope normalizer propagates `id` from the top-level Stripe payload into the `StripeWebhookEvent.id` field.
- Stripe webhook ordering is not guaranteed. Events whose `occurredAt` is older than the persisted `lastWebhookAt` are recorded for dedup but skipped from snapshot mutation, so a late-arriving older event cannot overwrite newer state.
- Hosted checkout, portal, and webhook routes never break the request path on retention failures; sweeps are best-effort and never block the mutating operation that triggered them.

## Dependency Direction

- May depend on `identity` and `metering`.
- Must not depend on `control_plane`, `tile_api`, or `raster_api`.
