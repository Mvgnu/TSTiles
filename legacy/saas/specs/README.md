# Tileserver Domain Specs

This repository follows a spec-first model: every domain owns one markdown contract and one implementation surface. A spec's `status` describes that contract's review state; it does not prove route composition, deployment readiness, or production safety.

Current baseline aligns to a Mapbox-style V1 roadmap (vector tiles, styles, raster/static rendering, quotas, docs, and operator control plane) plus the customer-facing SaaS shell (marketing, docs, app console, identity, Stripe-managed billing). The platform is being prepared for a launchable v1: real first-party auth + verification, Brevo transactional email, an operator HTML console at `/ops/*`, and a canonical light-default minimalist design language across every rendered surface.

## Canonical Cross-Cutting Spec

`specs/_cross_cutting.spec.md` is the single source of truth for design language, surface separation (customer vs operator), real auth, Brevo email infrastructure, and SaaS fundamentals (invitations, account/workspace lifecycle, quota notifications). Every UI/auth/email/admin-touching spec embeds a `Cross-Cutting Mandates (Subagent-Blind Reference)` section that summarizes this canonical spec so subagents operating with hard write-gates on a single domain still see the launch-relevant rules inline.

## SaaS Launch Persistence Baseline

The full delivery target is a real, persistent, multi-tenant tileserver SaaS. The persistent backings below are the gold standard for launch:

| Persistent surface | Backing | Notes |
| --- | --- | --- |
| Projects + API keys | Prisma `Project`, `ApiKey` | Source of truth for tenant identity and key verification |
| Usage + global fuse | Prisma `UsageBucket`, `GlobalBudgetBucket` | Source of truth for quota and billing estimates |
| Artifact catalog + active pointer + rollback | Prisma `ArtifactVersion`, `ActiveArtifact`, `ArtifactPromotionHistory` | Source of truth for promoted/rollback-able PMTiles state |
| Style registry | Prisma `Style`, `StyleVersion` | Source of truth for published style documents |
| Billing read model | Prisma `BillingSnapshot`, `CheckoutSession`, `BillingWebhookEvent` | Stripe-mirrored, webhook-driven projection |
| Admin audit + jobs | Prisma `AdminAuditEvent`, `AdminJob` | Persistent audit trail for control-plane mutations and ingest job lifecycle |
| Ingest idempotency | Prisma `IngestRun` | Source-of-truth cache for `(snapshotId, sourceUrl, expectedChecksum)` dedup across workers and restarts |
| Identity (users, workspaces, memberships, sessions) | Prisma `IdentityUser`, `IdentityWorkspace`, `IdentityMembership`, `IdentitySession` | First-party auth backing; managed-auth header bridge optional for SSO |
| Identity (credentials, auth events, lockouts) | Prisma `IdentityCredentialToken`, `IdentityAuthEvent`, `IdentityAuthLockout` | Passwords (argon2id), single-use tokens (SHA-256 hashed), MFA secrets (AES-GCM), audit + lockout counters |
| Email dispatch | Prisma `EmailDispatch`, `EmailSuppression`, `EmailWebhookEvent` | Brevo transactional log + suppression list + at-least-once webhook dedup |
| Object storage (PMTiles bytes) | `OBJECT_STORE_MODE=filesystem` (VPS) or `OBJECT_STORE_MODE=s3-compatible` | `memory` is dev-only and rejected in production/staging |
| Telemetry sink | Logpush/OTLP-style external sink via `OBSERVABILITY_LOG_SINK` | In-process SLO windows are a transient hot-path view only |

Storage policy baseline:
- `NODE_ENV=development` defaults to local development mode (`OBJECT_STORE_MODE=memory`).
- `NODE_ENV=staging|production` defaults to VPS-local PMTiles mode (`OBJECT_STORE_MODE=filesystem`).
- `OBJECT_STORE_MODE=s3-compatible` remains available when object storage is explicitly desired.
- `OBJECT_STORE_MODE=memory` is fail-fast rejected outside `NODE_ENV=development`.

## Domains

- `specs/_cross_cutting.spec.md`: Canonical cross-cutting mandates (design, surfaces, auth, email, SaaS fundamentals).
- `specs/release_readiness.md`: Cross-domain exit criteria tracker and stop-point gates for final push.
- `specs/contracts.spec.md`: Stable shared contracts to avoid circular dependencies (includes the new event payloads).
- `specs/config.spec.md`: Typed runtime configuration and secret validation.
- `specs/storage.spec.md`: Object-store access and range-read semantics.
- `specs/projects.spec.md`: Project registry, API keys, and project policy.
- `specs/metering.spec.md`: Quota/rate gating, pricing usage meter, quota-threshold events.
- `specs/ingest.spec.md`: OSM sync and PMTiles artifact generation.
- `specs/artifact.spec.md`: Artifact catalog, promotion, and rollback.
- `specs/tile_resolver.spec.md`: PMTiles tile/metadata resolution without HTTP concerns.
- `specs/styles.spec.md`: Style JSON registry, validation, and versioning.
- `specs/render.spec.md`: Raster/static rendering via pluggable adapters.
- `specs/tile_api.spec.md`: Vector tile request routing and cache policy.
- `specs/raster_api.spec.md`: Raster and static map routing with auth + cache.
- `specs/access.spec.md`: Auth, CORS, key identity, pre-read quota checks, and workspace-suspension propagation.
- `specs/observability.spec.md`: Logpush metrics, dashboards, alerts, and auth/email-event forwarding.
- `specs/control_plane.spec.md`: Operator HTTP API; admits both `ADMIN_API_TOKEN` (machines) and `ops_session` (humans via admin_console).
- `specs/studio.spec.md`: Style editing surface inside the operator console.
- `specs/docs_site.spec.md`: Public docs and examples.
- `specs/identity.spec.md`: Persistent users, workspaces, memberships, sessions, credentials, MFA, auth events, lockouts, roles.
- `specs/email.spec.md`: Brevo transactional email + suppression + webhook ingest. **(new)**
- `specs/auth_flows.spec.md`: First-party email + password + verification, magic link, password reset, invitation, signout. **(new)**
- `specs/admin_console.spec.md`: Operator HTML console at `/ops/*`, role-gated. **(new)**
- `specs/billing_sync.spec.md`: Stripe-managed billing read model, hosted sessions, webhook sync, transactional email triggers.
- `specs/customer_console.spec.md`: Customer-safe app orchestration for projects, usage, styles, billing, memberships, account lifecycle.
- `specs/marketing_site.spec.md`: Public marketing, pricing, legal, and auth entry pages (links into `auth_flows`).
- `specs/app_console.spec.md`: Authenticated app shell for overview, projects, styles, billing, members, security (MFA), account, notifications.
- `specs/design_system.spec.md`: Canonical light-default minimalist visual language + closed-set component primitives.

## Planning Specs

- `specs/frontend_saas.spec.md`: Original customer-facing SaaS direction document. Superseded in detail by the per-domain specs but retained for product narrative.

## Dependency Graph (Acyclic)

- `_cross_cutting`: reference-only, no code dependencies
- `contracts`: no domain dependencies
- `config`: no domain dependencies
- `design_system`: no domain dependencies
- `storage`: depends on `config`
- `projects`: depends on `config`
- `metering`: depends on `config`, `contracts`, `projects`
- `access`: depends on `config`, `contracts`, `projects`, `metering`
- `artifact`: depends on `storage`, `contracts`
- `tile_resolver`: depends on `artifact`, `storage`, `config`, `contracts`
- `styles`: depends on `storage`, `config`, `contracts`
- `render`: depends on `styles`, `tile_resolver`, `config`, `contracts`
- `ingest`: depends on `storage`, `config`, `contracts`
- `tile_api`: depends on `access`, `tile_resolver`, `config`, `contracts`
- `raster_api`: depends on `access`, `render`, `config`, `contracts`
- `observability`: depends on `contracts`, `config`
- `control_plane`: depends on `ingest`, `artifact`, `styles`, `projects`, `metering`, `config`, `identity` (operator session resolution)
- `docs_site`: depends on `contracts`, `design_system` (+ optional `styles`)
- `studio`: depends on `styles` and `control_plane`
- `identity`: depends on `config` only
- `email`: depends on `config`, `contracts`
- `auth_flows`: depends on `identity`, `email`, `design_system`
- `admin_console`: depends on `identity`, `email`, `control_plane`, `projects`, `styles`, `design_system`
- `billing_sync`: depends on `identity`, `metering`, `projects`, `email`
- `customer_console`: depends on `billing_sync`, `identity`, `metering`, `projects`, `styles`, `email`
- `marketing_site`: depends on `docs_site`, `metering`, `design_system`
- `app_console`: depends on `identity`, `customer_console`, `metering`, `design_system`

## Planned Code Insertion Roots

- `src/contracts/`
- `src/config/`
- `src/domains/design-system/`
- `src/domains/storage/`
- `src/domains/projects/`
- `src/domains/metering/`
- `src/domains/ingest/`
- `src/domains/artifact/`
- `src/domains/tile-resolver/`
- `src/domains/styles/`
- `src/domains/render/`
- `src/domains/tile-api/`
- `src/domains/raster-api/`
- `src/domains/access/`
- `src/domains/observability/`
- `src/domains/control-plane/`
- `src/domains/studio/`
- `src/domains/docs-site/`
- `src/domains/identity/`
- `src/domains/email/` **(new)**
- `src/domains/auth-flows/` **(new)**
- `src/domains/admin-console/` **(new)**
- `src/domains/billing-sync/`
- `src/domains/customer-console/`
- `src/domains/marketing-site/`
- `src/domains/app-console/`

## Endpoint Contract Summary

### Customer surface

- Vector tiles
  - `GET /v1/tiles/:z/:x/:y.mvt`
  - `GET /v1/tiles/metadata`
  - Methods: `GET`, `HEAD`, `OPTIONS`
- Health
  - `GET /v1/health` (via tile API routing surface)
- Marketing
  - `GET /`
  - `GET /pricing`
  - `GET /legal/terms`
  - `GET /legal/privacy`
  - `GET /legal/dpa`
  - `GET /legal/acceptable-use`
  - `GET /security`
  - `GET /status`
- Auth flows (`auth_flows.spec.md`)
  - `GET /sign-up`, `POST /sign-up`
  - `GET /sign-in`, `POST /sign-in`
  - `POST /sign-out`
  - `GET /verify-email`, `GET /verify-email/:token`, `POST /verify-email/resend`
  - `GET /forgot-password`, `POST /forgot-password`
  - `GET /reset-password/:token`, `POST /reset-password/:token`
  - `POST /magic-link/request`, `GET /magic-link/:token`
  - `GET /accept-invite/:token`, `POST /accept-invite/:token`
- Styles
  - `GET /v1/styles`
  - `GET /v1/styles/:styleId/style.json`
  - `GET /v1/styles/:styleId/sprites/:name(@2x)?.(png|json)`
  - `GET /v1/fonts/:fontstack/:range.pbf`
- Raster
  - `GET /v1/raster/:styleId/:z/:x/:y.png`
  - `GET /v1/raster/:styleId/:z/:x/:y.webp`
- Static
  - `GET /v1/static/:styleId/:lon,:lat,:zoom/:widthx:height.png`
  - `GET /v1/static/:styleId/:lon,:lat,:zoom/:widthx:height.webp`
- Docs
  - `GET /docs`, `/docs/quickstart`, `/docs/authentication`, `/docs/maplibre`, `/docs/raster`, `/docs/static-maps`, `/docs/styles`, `/docs/api`, `/docs/examples`
  - `GET /docs/openapi.json`
  - Method variants: `HEAD`, `OPTIONS` for shell paths
- Customer console (HTML)
  - `GET /app`
  - `GET /app/projects`, `GET /app/projects/new`, `GET /app/projects/:projectId`
  - `GET /app/projects/:projectId/usage?window=day|month`
  - `GET /app/styles`, `GET /app/styles/:styleId`
  - `GET /app/billing`
  - `GET /app/settings`
  - `GET /app/settings/members` **(new)**
  - `GET /app/settings/security`, `GET /app/settings/security/password`, `GET /app/settings/security/mfa` **(new)**
  - `GET /app/settings/account`, `GET /app/settings/account/export`, `GET /app/settings/account/delete` **(new)**
  - `GET /app/notifications` **(new)**
- Customer JSON (`/app-api/*`)
  - `GET /app-api/session`
  - `GET /app-api/bootstrap`, `GET /app-api/settings`, `PATCH /app-api/settings`
  - `GET /app-api/projects`, `POST /app-api/projects`
  - `GET /app-api/projects/:projectId`, `PATCH /app-api/projects/:projectId`
  - `GET /app-api/projects/:projectId/usage?window=day|month`
  - `POST /app-api/projects/:projectId/keys/rotate`
  - `GET /app-api/styles`, `GET /app-api/styles/:styleId`
  - `GET /app-api/billing`
  - `GET /app-api/memberships` **(new)**
  - `POST /app-api/memberships/invite` **(new)**
  - `POST /app-api/memberships/:userId/remove` **(new)**
  - `POST /app-api/workspace/transfer-ownership` **(new)**
  - `POST /app-api/workspace/delete` **(new)**
  - `POST /app-api/workspace/restore` **(new)**
  - `POST /app-api/workspace/export` **(new)**
  - `POST /app-api/security/password` **(new)**
  - `POST /app-api/security/mfa/enroll` **(new)**
  - `POST /app-api/security/mfa/disable` **(new)**
  - `GET /app-api/notifications` **(new)**
- Billing
  - `POST /billing/checkout`
  - `POST /billing/portal`
- Dev-only (`NODE_ENV=development`)
  - `POST /auth/demo/sign-in`
  - `POST /auth/demo/sign-out`

### Webhook ingestion

- `POST /webhooks/stripe`
- `POST /webhooks/brevo` **(new)**

### Operator surface

- Admin HTTP API (existing, retained — `ADMIN_API_TOKEN` or `ops_session`)
  - `POST /admin/ingest`
  - `GET /admin/artifacts`
  - `POST /admin/artifacts/:versionId/promote`
  - `POST /admin/artifacts/rollback`
  - `POST /admin/projects`
  - `POST /admin/projects/:projectId/keys/rotate`
  - `GET /admin/projects/:projectId/usage`
  - `POST /admin/styles/:styleId/versions`
  - `POST /admin/styles/:styleId/publish/:versionId`
  - `GET /admin/health`
  - `GET /admin/audit-events?limit=:limit`
  - `GET /admin/jobs?limit=:limit`
- Admin HTML console (`admin_console.spec.md`, `ops_session` only) **(new)**
  - `GET /ops/sign-in`, `POST /ops/sign-in`
  - `POST /ops/sign-out`
  - `GET /ops` (overview)
  - `GET /ops/artifacts`, `POST /ops/artifacts/:versionId/promote`, `POST /ops/artifacts/rollback`
  - `GET /ops/ingest`, `POST /ops/ingest/start`
  - `GET /ops/styles`, `GET /ops/styles/:styleId`, `POST /ops/styles/:styleId/versions`, `POST /ops/styles/:styleId/publish/:versionId`
  - `GET /ops/projects`, `GET /ops/projects/:projectId`, `POST /ops/projects/:projectId/keys/rotate`, `GET /ops/projects/:projectId/usage`
  - `GET /ops/audit`
  - `GET /ops/jobs`
  - `GET /ops/abuse`, `POST /ops/abuse/warn`, `POST /ops/abuse/suspend`, `POST /ops/abuse/unsuspend`
  - `GET /ops/operators`, `POST /ops/operators/grant`, `POST /ops/operators/revoke`

## Historical Launch Slice Plan

The slices below record the original implementation plan. They are not a live
completion checklist: implementation has moved since the plan was written, and
the current executable evidence and blockers are tracked in
`specs/release_readiness.md`.

Current spec front-matter is intentionally mixed:

- `in-review`: `tile_resolver`, `design_system`, `marketing_site`, `app_console`.
- `planned`: `auth_flows` (implementation exists, but its spec owner has not yet
  reconciled the lifecycle marker).
- `ready`: the remaining domain contracts; this means ready as a contract, not
  production-verified.

### Slice 0 — Spec audit (this turn)
- **Owner**: PM (no implementation)
- **Outputs**: `_cross_cutting.spec.md`, new specs (`email`, `auth_flows`, `admin_console`), rewritten `design_system.spec.md`, extended `identity.spec.md`, cross-cutting embeds across all UI/auth/email/admin-touching specs, engine-spec cross-cutting pointers, new event contracts in `contracts.spec.md`, updated `README.md` and `release_readiness.md`.
- **Status**: historical plan; superseded by the readiness tracker.

### Slice 1 — Design system primitives
- **Owner**: subagent (`design_system`)
- **Write paths**: `src/domains/design-system/**`
- **Scope**: emit canonical CSS tokens (light + dark), font loading via `/v1/fonts/*`, and the closed-set component primitives (`Button`, `Input`, `Card`, `Banner`, `Badge`, `CodeBlock`, `CopyRow`, `KeyReveal`, `Modal`, `Drawer`, `Toast`, `Table`, `Tabs`, `Sidebar`, `TopNav`, `Breadcrumbs`, `EmptyState`, `MapPreview`, `StatGrid`, `UsageMeter`, `PlanCard`). Replace any inline hex / brutalist styling currently present.
- **Exit gate**: typecheck + tests pass; downstream domains can `import` and render without surface-specific styling.

### Slice 2 — Identity persistence extensions
- **Owner**: subagent (`identity`)
- **Write paths**: `src/domains/identity/**`, `prisma/schema.prisma` (PM-escalation required for schema)
- **Scope**: add Prisma models (`IdentityCredentialToken`, `IdentityAuthEvent`, `IdentityAuthLockout`) and new columns on `IdentityUser` / `IdentityWorkspace`; argon2id wrapper, SHA-256 token wrapper, lockout counters; new exported functions (`createUser`, `setPasswordHash`, `verifyPasswordHash`, `createCredentialToken`, `consumeCredentialToken`, `createOperatorSession`, `requireCustomerSession`, `requireOperatorSession`, role grant/revoke, soft/hard delete, audit + lockout helpers).
- **Exit gate**: typecheck + tests pass; first-party password / token / role / lockout / audit flows all exercised by unit tests.

### Slice 3 — Email domain (Brevo)
- **Owner**: subagent (`email`)
- **Write paths**: `src/domains/email/**`, `prisma/schema.prisma` (PM-escalation for new tables)
- **Scope**: Prisma models (`EmailDispatch`, `EmailSuppression`, `EmailWebhookEvent`), Brevo HTTP client (no SDK), console + file dev sinks, closed-set template renderers, suppression check, webhook route at `/webhooks/brevo`, idempotency enforcement, retry budget, redaction.
- **Exit gate**: typecheck + tests pass; smoke covers `console` sink with one template per closed key; `EMAIL_PROVIDER=brevo` path mocked at the HTTP boundary.

### Slice 4 — Auth flows
- **Owner**: subagent (`auth_flows`)
- **Write paths**: `src/domains/auth-flows/**`
- **Scope**: signup, signin, signout, verify-email, forgot/reset-password, magic-link, accept-invite routes; CSRF infra; rate-limit + lockout integration with identity; auth shell rendered via design-system; managed-auth bridge precedence; demo-bridge dev gating.
- **Exit gate**: typecheck + tests pass; smoke covers happy path signup → verify → signin → reset → magic-link; unhappy paths (lockout, expired token, CSRF mismatch) covered.

### Slice 5 — Customer console expansion
- **Owner**: subagent (`customer_console`)
- **Write paths**: `src/domains/customer-console/**`
- **Scope**: add memberships endpoints (`GET/POST /app-api/memberships`, invite, remove, transfer-ownership), workspace lifecycle (delete soft, restore, export), security endpoints (`POST /app-api/security/password`, MFA enroll/disable), notifications listing (`GET /app-api/notifications`), email triggers for invitation/removal/key-rotation/export/account-deletion.
- **Exit gate**: typecheck + tests pass; smoke covers invitation accept → member joined → key rotation receipt → quota approaching banner.

### Slice 6 — App console expansion
- **Owner**: subagent (`app_console`)
- **Write paths**: `src/domains/app-console/**`
- **Scope**: new HTML pages (`/app/settings/members`, `/app/settings/security/*`, `/app/settings/account/*`, `/app/notifications`); replace any inline styling with design-system primitives; remove demo sign-out from production shell; surface managed-auth provider's sign-out URL when enabled.
- **Exit gate**: typecheck + tests pass; smoke covers each new page; visual review on light + dark.

### Slice 7 — Admin console
- **Owner**: subagent (`admin_console`)
- **Write paths**: `src/domains/admin-console/**`
- **Scope**: `/ops/sign-in`, `/ops/sign-out`, overview, artifacts, ingest, styles, projects, audit, jobs, abuse, operators pages; MFA enforcement on operator sign-in; confirmation modals with reason capture; operator session cookie scope.
- **Exit gate**: typecheck + tests pass; smoke covers operator sign-in → MFA challenge → promote artifact → audit event recorded → suspend workspace → unsuspend.

### Slice 8 — Cross-cutting wiring
- **Owner**: subagent (`access`, `metering`, `projects`, `billing_sync`, `control_plane`)
- **Write paths**: only inside each named domain's existing paths
- **Scope**: thread workspace-suspension propagation through `access` and `metering`; emit `QuotaThresholdEvent` from `metering`; emit transactional emails from `billing_sync` on Stripe webhook events; admit `ops_session` on `/admin/*` in `control_plane`; record operator-attributable audit events when ops_session is present.
- **Exit gate**: typecheck + tests pass; suspending a workspace from `/ops/abuse` denies subsequent `/v1/*` requests with `403 ACCESS_WORKSPACE_SUSPENDED`; `invoice.paid` webhook delivers a `billing_receipt` email.

### Slice 9 — Polish and launch readiness
- **Owner**: subagent (cross-cutting)
- **Write paths**: smoke scripts, CI workflows, `release_readiness.md`
- **Scope**: update `npm run smoke:e2e` to cover new routes; add CI gate for `EMAIL_PROVIDER=console` smoke; verify all new env vars validate at startup; update README env table; tick `release_readiness.md` gates.
- **Exit gate**: `npm run readiness:check` green with all new gates checked.
