---
name: customer_console
description: "Customer-safe app console orchestration for projects, usage, styles, and mirrored billing state"
paths:
  types: src/domains/customer-console/types.ts
  service: src/domains/customer-console/customer-console.service.ts
  components: src/domains/customer-console/
  tests: src/domains/customer-console/__tests__/
exports:
  - CustomerConsoleError
  - CustomerConsoleErrorCode
  - ConsoleWorkspace
  - ConsoleCurrentUser
  - ConsoleMembership
  - UsageSummaryCard
  - IntegrationSnippets
  - ConsoleFirstIntegration
  - ConsoleProjectSummary
  - ConsoleProjectDetail
  - ConsoleStyleSummary
  - ConsoleStyleDetail
  - ConsoleProjectUsageWindow
  - ConsoleBootstrap
  - ConsoleSettings
  - ConsoleProjectCreateInput
  - ConsoleProjectUpdateInput
  - ConsoleSettingsUpdateInput
  - ConsoleProjectProvisionResult
  - appendAccessTokenQueryParam
  - getConsoleBootstrap
  - getConsoleSettings
  - listConsoleProjects
  - listConsoleStyles
  - getConsoleStyle
  - getConsoleProject
  - getConsoleProjectUsage
  - createConsoleProject
  - updateConsoleProject
  - updateConsoleSettings
  - rotateConsoleProjectKey
  - listConsoleMemberships
  - inviteConsoleMember
  - removeConsoleMember
  - transferConsoleWorkspaceOwnership
  - deleteConsoleWorkspace
  - restoreConsoleWorkspace
  - exportConsoleWorkspace
  - updateConsolePassword
  - enrollConsoleMfa
  - disableConsoleMfa
  - listConsoleNotifications
consumes:
  - billing_sync.getWorkspaceBilling
  - identity.requireSession
  - identity.getWorkspace
  - identity.updateWorkspace
  - identity.listWorkspaceMemberships
  - identity.removeWorkspaceMember
  - identity.transferWorkspaceOwnership
  - identity.softDeleteWorkspace
  - identity.getUserById
  - identity.getUserByEmail
  - identity.verifyPasswordHash
  - identity.setPasswordHash
  - email.sendTransactionalEmail
  - email.isSuppressed
  - metering.getBillingPlan
  - metering.getUsageSummary
  - projects.createProject
  - projects.updateProject
  - projects.listProjectsByWorkspace
  - projects.listProjectKeys
  - projects.getProjectPolicy
  - projects.rotateApiKey
  - styles.listStyles
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/customer-console/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/customer-console/"
status: ready
---

# Customer Console Domain

Owns the customer-safe read and write model needed by the future `/app-api/*` surface.

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`. Subagents working only on this spec MUST treat the following as binding without reading other specs.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Dark parity uses the matching tokens. Inter sans + JetBrains Mono. Type scale 12/14/16/18/24/32/48. Spacing 4/8/12/16/24/32/48/64. Radii 4/8/12. One shadow token. Motion 120/200ms with `prefers-reduced-motion` honored. WCAG AA contrast, 2px focus ring, keyboard reachable. Voice: precise, calm, no emoji, no exclamation. Reuse only design-system primitives.
- **Surfaces**: customer routes `/`, `/app`, `/app-api`, `/billing`, `/docs`, `/legal`, `/security`, `/status`, `/v1/*` use `app_session`. Operator routes `/admin/*` and `/ops/*` use `ops_session`. Roles: `customer_member`, `customer_owner`, `operator` — one session is exactly one role. Customer-console reads are workspace-scoped using the persistent project workspace ownership.
- **Auth**: v1 is first-party email + password + email verification + magic link, owned by `auth_flows`. Customer-console requires `requireCustomerSession`; operator sessions are rejected at the customer-console boundary. Managed-auth header bridge supported for enterprise SSO. Demo bridge gated to `NODE_ENV=development`.
- **Email**: Brevo only via `email.sendTransactionalEmail`. Customer-console triggers `workspace_invitation` (owner invites a member), `member_removed` (owner removes a member), `key_rotated_receipt` (any member rotates a project key), `quota_approaching` / `quota_exceeded` (forwarded from metering), `data_export_ready` (workspace export job finished), `account_deletion_initiated` / `account_deletion_completed`. Send failures never block the originating flow; banners surface "delivery pending" state.
- **SaaS fundamentals**: owner-only mutations (invite, remove, transfer ownership, delete workspace, export data, view billing). Member-allowed mutations (rotate own project keys, manage own MFA — MFA lives in `app_console`, not here). Customer-console must expose: GET/POST `/app-api/memberships`, POST `/app-api/memberships/invite`, POST `/app-api/memberships/:userId/remove`, POST `/app-api/workspace/transfer-ownership`, POST `/app-api/workspace/delete` (soft, 30-day grace), POST `/app-api/workspace/restore`, POST `/app-api/workspace/export` (async job → email).

## Component Insertion Points

- `src/domains/customer-console/customer-console.service.ts`
- `src/domains/customer-console/__tests__/customer-console-service.test.ts`

## Public API Contract

- `getConsoleBootstrap(session): ConsoleBootstrap`
- `getConsoleSettings(session): ConsoleSettings`
- `listConsoleProjects(workspaceId?: string): ConsoleProjectSummary[]`
- `listConsoleStyles(): ConsoleStyleSummary[]`
- `getConsoleStyle(styleId: string): ConsoleStyleDetail`
- `getConsoleProject(projectId: string, workspaceId?: string): ConsoleProjectDetail`
- `getConsoleProjectUsage(projectId: string, window: ConsoleProjectUsageWindow, workspaceId?: string): UsageSummaryCard`
- `createConsoleProject(input, workspaceId?: string): ConsoleProjectProvisionResult`
- `updateConsoleProject(projectId: string, input, workspaceId?: string): ConsoleProjectSummary`
- `updateConsoleSettings(session, input): ConsoleSettings`
- `rotateConsoleProjectKey(projectId: string, workspaceId?: string): ConsoleProjectProvisionResult`

## Endpoint Surface

- `GET /app-api/bootstrap`
- `GET /app-api/settings`
- `PATCH /app-api/settings`
- `GET /app-api/projects`
- `POST /app-api/projects`
- `GET /app-api/projects/:projectId`
- `GET /app-api/projects/:projectId/usage?window=day|month`
- `PATCH /app-api/projects/:projectId`
- `POST /app-api/projects/:projectId/keys/rotate`
- `GET /app-api/styles`
- `GET /app-api/styles/:styleId`
- `OPTIONS` preflight for all customer-console endpoints

## Owned Invariants

- Customer-console payloads never expose raw token material except at explicit issuance or rotation time.
- Project create/update flows only expose customer-editable policy fields: name, allowed origins, and endpoint toggles.
- Customer-editable endpoint toggles are validated as booleans at the customer-console boundary, so malformed `allowedEndpoints` payloads return `CUSTOMER_CONSOLE_BAD_REQUEST` instead of leaking downstream projects-policy failures.
- Customer-editable `allowedOrigins` are validated and normalized at the customer-console boundary as bare absolute `http(s)` origins, so malformed origin input returns `CUSTOMER_CONSOLE_BAD_REQUEST` instead of leaking a downstream projects-policy failure.
- Project access is workspace-scoped using the core projects workspace model.
- Usage summaries are aggregated into app-friendly cards without leaking metering internals.
- Project usage detail is limited to `day` and `month` customer views rather than raw metering windows.
- That `day | month` usage-window restriction applies at the exported customer-console service boundary too, so direct `getConsoleProjectUsage(...)` consumers cannot leak raw metering windows like `minute` through the domain.
- Bootstrap includes current user and membership context so the app shell does not need a second identity bootstrap request.
- Bootstrap also includes an explicit first-integration summary with readiness state, quickstart/project handoff URLs, and style/raster/static snippet targets so future frontend clients do not have to reconstruct onboarding decisions from scattered fields.
- When multiple published styles exist, bootstrap and snippet-producing customer-console surfaces must choose the first lexicographically published style ID deterministically so onboarding and integration targets do not drift with storage/list ordering.
- If published-style lookup fails while building integration snippets, snippet-producing customer-console surfaces must fail closed to empty snippet payloads instead of taking down project issuance, rotation, or detail reads.
- Published styles are exposed as integration targets, not authoring controls.
- Published-style dependency rows are re-validated at the customer-console boundary, so malformed upstream style entries are skipped instead of leaking broken style summaries or onboarding snippets into customer-facing payloads.
- Upstream project dependency rows are also re-validated at the customer-console boundary, so malformed project entries are skipped instead of leaking broken project summaries into workspace bootstrap or project-list payloads.
- Style detail routes only expose published style integration URLs and copy-ready snippets.
- Style-detail snippet URLs must append the `access_token` placeholder safely and idempotently, even when the published style URL already carries its own query params, fragment, or stale `access_token` value.
- The exported `appendAccessTokenQueryParam(...)` helper also fails closed on malformed runtime URL or placeholder input with `CUSTOMER_CONSOLE_BAD_REQUEST` instead of leaking raw string-operation failures from direct callers.
- Customer-facing published style integration URLs must URL-encode the style ID path segment, so valid style IDs containing spaces or other path-unsafe bytes still produce browser-safe snippets.
- The domain treats billing state as mirrored read-only input from `billing_sync`.
- Route surfaces require identity-backed sessions before returning workspace data.
- Route surfaces must also honor the production managed-auth bridge exposed by `identity` so trusted provider-authenticated requests can reach `/app-api/*` without the development demo session flow.
- Customer-console preflight/CORS responses must advertise the trusted `x-auth-*` headers used by the managed-auth bridge when that production path is used from browsers or reverse proxies.
- Customer-console preflight/CORS responses must only advertise those trusted `x-auth-*` headers when the managed-auth bridge is enabled, so the public `/app-api/*` surface does not claim unsupported provider headers while local/demo auth is active.
- Settings surfaces expose workspace name, billing email, and memberships without exposing operator-only controls.
- Upstream membership dependency rows are also re-validated at the customer-console boundary, so malformed or cross-workspace membership entries are skipped instead of leaking broken settings memberships into customer-facing payloads.
- Customer-settings updates validate `workspaceName` as a non-empty trimmed string at the customer-console boundary instead of leaking blank-name rejection into downstream identity writes.
- Exported customer-console service inputs reject path-like or traversal-style workspace and resource identifiers, including embedded traversal markers, at the source boundary instead of relying only on route-layer session parsing.
- Those exported customer-console service inputs must also fail closed on non-string runtime workspace/resource/name identifiers with `CUSTOMER_CONSOLE_BAD_REQUEST`, instead of leaking raw string-operation failures from direct callers.
- Exported bootstrap/settings session helpers also fail closed on malformed non-object runtime session payloads instead of leaking raw property-access failures from direct callers.
- Exported bootstrap/settings session helpers also validate nested session field shapes, path-safe nested identifiers, and aligned membership/user/workspace references before use, so malformed runtime session payloads fail closed with `CUSTOMER_CONSOLE_BAD_REQUEST`.
- Customer-console HTTP routes also reject decoded path segments containing slash, backslash, exact dot segments, or embedded traversal markers like `project..id` at the route boundary instead of deferring those malformed IDs into service dispatch.
- Exported customer-console HTTP route helpers also fail closed on malformed runtime request objects or non-string `method` / `path` / header values with `CUSTOMER_CONSOLE_BAD_REQUEST`, instead of leaking raw property-access failures from direct callers.
- Those customer-console write-route helpers also reject malformed non-object `POST` / `PATCH` bodies at the route boundary instead of forwarding primitive payloads into downstream service validation.

## Error Taxonomy

- `CUSTOMER_CONSOLE_BAD_REQUEST`
- `CUSTOMER_CONSOLE_NOT_FOUND`
- `CUSTOMER_CONSOLE_DEPENDENCY_FAILED`

## SaaS Launch Baseline

- The customer console is a stateless orchestrator over persistent-backed domains. All workspace, project, key, usage, style, and billing state is read through `identity`, `projects`, `metering`, `styles`, and `billing_sync`, each of which owns its persistent store.
- Token-bearing payloads (project create, key rotation) return raw token material exactly once at issuance; subsequent reads expose only hashed identity and metadata.
- Customer MFA encryption uses the identity-owned AES-GCM helper backed only by the centrally validated `MFA_ENCRYPTION_KEY`; legacy `MFA_KEY`, `SESSION_SECRET`, and hard-coded fallbacks are not accepted.
- Customer-facing reads must remain workspace-scoped using the persistent project workspace ownership; cross-workspace leaks are prevented at the customer-console boundary, not after the fact in the route layer.
- Production deployments must run with the managed-auth bridge enabled in `identity`; the customer-console preflight surface advertises the trusted `x-auth-*` headers only when that bridge is enabled so the public route surface never claims unsupported provider headers while the demo bridge is still active.

## Dependency Direction

- May depend on `billing_sync`, `identity`, `metering`, `projects`, and `styles`.
- Must not depend on `control_plane`, `tile_api`, `raster_api`, or `studio`.
