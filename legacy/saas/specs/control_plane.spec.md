---
name: control_plane
description: "Operator-only endpoints for ingest, artifact lifecycle, styles, projects, and usage controls"
paths:
  types: src/domains/control-plane/types.ts
  service: src/domains/control-plane/control-plane.service.ts
  components: src/domains/control-plane/routes/
  tests: src/domains/control-plane/__tests__/
exports:
  - triggerIngest
  - listArtifactsEndpoint
  - promoteArtifactEndpoint
  - rollbackArtifactEndpoint
  - createProjectEndpoint
  - rotateApiKeyEndpoint
  - getProjectUsageEndpoint
  - createStyleVersionEndpoint
  - publishStyleVersionEndpoint
  - healthStatusEndpoint
  - listAuditEventsEndpoint
  - listJobsEndpoint
consumes:
  - ingest.runIngestPipeline
  - ingest.buildDefaultSnapshot
  - artifact.listArtifacts
  - artifact.registerArtifact
  - artifact.promoteArtifact
  - artifact.rollbackArtifact
  - styles.createStyleVersion
  - styles.publishStyleVersion
  - projects.createProject
  - projects.listProjects
  - projects.rotateApiKey
  - metering.getUsageSummary
  - config.SecurityConfig
  - identity.requireOperatorSession
  - identity.getSession
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/control-plane/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/control-plane/"
status: ready
---

# Control Plane Domain

Owns protected operational actions and diagnostics for administrators. The HTTP API surface (`/admin/*`) continues to accept `ADMIN_API_TOKEN` for machine automation and now ALSO accepts `ops_session` cookies for operator-attributable calls originating from the admin console at `/ops/*` (see `admin_console.spec.md`).

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`. Subagents working only on this spec MUST treat the following as binding without reading other specs.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Control-plane is HTTP-only and does not render UI itself — but its responses are consumed by `admin_console` (HTML at `/ops/*`) which honors design-system tokens.
- **Surfaces**: customer routes `/`, `/app`, `/app-api`, `/billing`, `/docs`, `/legal`, `/security`, `/status`, `/v1/*` use `app_session`. Operator routes `/admin/*` (HTTP API) and `/ops/*` (HTML console) use either `ADMIN_API_TOKEN` (for `/admin/*` automation only) or `ops_session` (for human operator actions on both `/admin/*` and `/ops/*`). Roles: `customer_member`, `customer_owner`, `operator` — one session is exactly one role. Control-plane never accepts `app_session` and never serves customer-only payloads.
- **Auth**: operator role is granted/revoked via `admin_console`. Initial operator seeded via `INITIAL_OPERATOR_EMAIL`. MFA mandatory for operators. `ops_session` is preferred for human actions because it produces an attributable audit event tied to the operator user ID rather than a shared-token `machine:<hashed>` actor.
- **Email**: Brevo only via `email.sendTransactionalEmail`. Control-plane operations triggered by an operator that emit customer-visible side effects use the templates owned by other domains: e.g., operator-initiated key rotation triggers `key_rotated_receipt` via `customer_console`; operator abuse warnings trigger `abuse_warning` via `admin_console`.
- **SaaS fundamentals**: every mutating control-plane operation persists an `AdminAuditEvent` row with the operator's user ID (when authenticated via `ops_session`) or the hashed machine token (when authenticated via `ADMIN_API_TOKEN`). Long-running ingest jobs persist a lifecycle through `AdminJob`. Health endpoint probes Prisma connectivity. Audit/job retention bounded to 30 days, amortized sweeps.

## Component Insertion Points

- `src/domains/control-plane/routes/admin-artifacts-route.ts`
- `src/domains/control-plane/routes/admin-promote-route.ts`
- `src/domains/control-plane/routes/admin-rollback-route.ts`
- `src/domains/control-plane/routes/admin-ingest-route.ts`
- `src/domains/control-plane/routes/admin-rotate-api-key-route.ts`
- `src/domains/control-plane/routes/admin-project-usage-route.ts`
- `src/domains/control-plane/routes/admin-create-style-version-route.ts`
- `src/domains/control-plane/routes/admin-publish-style-version-route.ts`
- `src/domains/control-plane/routes/admin-audit-events-route.ts`
- `src/domains/control-plane/routes/admin-jobs-route.ts`
- `src/domains/control-plane/routes/health-route.ts`
- `src/domains/control-plane/auth/admin-auth.ts`
- `src/domains/control-plane/__tests__/control-plane-routes.test.ts`

## Public API Contract

- `triggerIngest(): Promise<JobMetadata>`
- `listArtifactsEndpoint(): Promise<ArtifactSummary[]>`
- `promoteArtifactEndpoint(versionId: string): Promise<ActiveArtifactPointer>`
- `rollbackArtifactEndpoint(): Promise<ActiveArtifactPointer>`
- `createProjectEndpoint(input): Promise<Project>`
- `rotateApiKeyEndpoint(projectId: string): Promise<IssuedApiKey>`
- `getProjectUsageEndpoint(projectId: string, window): Promise<UsageSummary>`
- `createStyleVersionEndpoint(styleId: string, input): Promise<StyleVersion>`
- `publishStyleVersionEndpoint(styleId: string, versionId: string): Promise<StyleVersion>`
- `healthStatusEndpoint(): Promise<HealthStatus>`
- `listAuditEventsEndpoint(limit?: number): Promise<AuditEvent[]>`
- `listJobsEndpoint(limit?: number): Promise<JobMetadata[]>`

## Endpoint Surface

- `POST /admin/ingest`
- `GET /admin/artifacts`
- `POST /admin/artifacts/:versionId/promote`
- `POST /admin/artifacts/rollback`
- `POST /admin/projects`
- `POST /admin/projects/:projectId/keys/rotate`
- `GET /admin/projects/:projectId/usage?window=day|month`
- `POST /admin/styles/:styleId/versions`
- `POST /admin/styles/:styleId/publish/:versionId`
- `GET /admin/health`
- `GET /admin/audit-events?limit=:limit` (default 100, max 500)
- `GET /admin/jobs?limit=:limit` (default 50, max 200)

## Owned Invariants

- All control-plane endpoints require admin authentication.
- Mutating operations are auditable and idempotent where feasible.
- Health endpoints never expose sensitive configuration details.
- Admin-only project key operations return raw key material only at issuance/rotation time.
- Job and audit telemetry retention is bounded; the in-memory hot cache is a transient view backed by the persisted audit/job records used for compliance and incident review.
- Admin actor attribution is canonicalized (raw token vs `Bearer` token forms map to the same hashed actor handle).
- Admin route parameters for project/style/artifact/version identifiers must reject path separators and traversal markers, including embedded `..` markers, consistently at the HTTP boundary and inside the exported control-plane service surface.
- Those admin route parameter guards must also fail closed on malformed non-string runtime identifier inputs, and usage-window parsing must reject malformed non-string runtime values as `400` instead of leaking raw `.trim()` failures from direct callers.
- That exported control-plane service surface must also fail closed on non-string runtime identifier inputs with `CONTROL_PLANE_BAD_REQUEST`, instead of leaking raw string-operation failures from direct callers.
- Admin authentication input must also fail closed on malformed runtime token values at both the exported service surface and the route layer, returning `CONTROL_PLANE_UNAUTHORIZED` / HTTP `401` instead of leaking raw `.trim()` failures from direct callers.
- Admin project-create policy validation must reject malformed allowed origins at the control-plane boundary, including non-HTTP schemes, credentials, and path/query/fragment-bearing origin values, instead of leaking them into downstream project-domain errors.
- That control-plane allowed-origin normalization also deduplicates equivalent origins after trimming and canonical URL parsing, so admin-created project policy mirrors the downstream customer/project contract instead of persisting duplicate origins from operator input.
- Admin project-create input must also validate `planId` shape at the control-plane boundary, rejecting blank or delimiter-bearing values instead of leaking them into downstream project-domain normalization.
- Admin project-create input must also validate the project name at the control-plane boundary, so malformed runtime `name` values fail with `CONTROL_PLANE_BAD_REQUEST` instead of leaking downstream project-domain validation.

## Error Taxonomy

- `CONTROL_PLANE_BAD_REQUEST`
- `CONTROL_PLANE_UNAUTHORIZED`
- `CONTROL_PLANE_FORBIDDEN`
- `CONTROL_PLANE_CONFLICT`
- `CONTROL_PLANE_DEPENDENCY_FAILED`
- Request validation errors (e.g., invalid usage window) return `400` with descriptive message.

## Caching Semantics

- Admin endpoints are uncached by default.
- Health status endpoint may be short-cached for burst protection.

## Security and Privacy

- Admin auth uses dedicated credentials separate from tile access tokens.
- Audit logs include actor identity and operation outcome using irreversible hashed actor handles (never raw token fragments).

## Data Stores

- Reads artifact catalog and pointer state through domain APIs (Prisma-backed in the artifact domain).
- Reads project/style/usage state through owned domains (Prisma-backed in `projects`, `styles`, and `metering`).
- Prisma `AdminAuditEvent` model holds operation audit entries (`id`, `actor`, `operation`, `outcome`, `startedAt`, `completedAt`, `message`, `recordedAt`).
- Prisma `AdminJob` model holds job run metadata (`jobId`, `status`, `startedAt`, `completedAt`, `actor`, `snapshotId`, `outcome`, `recordedAt`).
- A bounded in-memory hot cache mirrors the most recent audit/job records so the existing health surface and any future hot-read endpoints can serve fast snapshots without round-tripping to the database; the persistent rows are the source of truth.

## SaaS Launch Baseline

- All `/admin/*` endpoints documented in this spec are wired into the HTTP entry point (`src/app/demo-server.ts`) so the documented admin surface is actually reachable in deployed instances. Admin token is extracted from the `Authorization` header (`Bearer <token>` or raw token), `OPTIONS` preflight is short-circuited, and each route enforces method routing (`POST` for mutations, `GET` for reads, `405` otherwise).
- Mutating control-plane operations (ingest trigger, artifact promote/rollback, project create, key rotate, style version create/publish) produce a persisted `AdminAuditEvent` row before the success response is returned. The in-memory recent-audit cache is a UX convenience that mirrors the persistent rows.
- Long-running ingest jobs persist a `started`/`finished`/`failed` lifecycle through `AdminJob` rows, so admin observability of in-flight or recently-completed ingests survives process restarts.
- Persistent audit and job retention is bounded: rows older than 30 days are swept on an amortized basis (sweep runs after every Nth mutating write inside the control plane). Sweeps are best-effort and do not block mutating endpoints.
- The admin health endpoint actually probes Prisma connectivity (`SELECT 1`) and reports the live audit-events-in-window count from the persistent table, so operators can detect a database outage from the health response without parsing in-memory state.
- The audit and job listing endpoints (`GET /admin/audit-events`, `GET /admin/jobs`) are read-only, admin-authenticated, and capped at 500/200 rows respectively to prevent unbounded reads.
- Admin authentication uses the dedicated `ADMIN_API_TOKEN`/`ADMIN_API_TOKEN_HASH` configuration and never accepts customer delivery tokens or workspace session tokens.
- Admin actor handles in audit logs are irreversibly hashed; raw admin tokens never leave the auth boundary in plain text.

## Dependency Direction

- May depend on `ingest`, `artifact`, `styles`, `projects`, `metering`, and `config`.
- Must not be depended on by request-path domains (`tile_api`, `raster_api`, `access`).
