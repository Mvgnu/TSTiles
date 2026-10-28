---
name: admin_console
description: "HTML operator console at /ops/*, role-gated to identity role `operator`, on top of control_plane HTTP API"
paths:
  types: src/domains/admin-console/types.ts
  service: src/domains/admin-console/admin-console.service.ts
  components: src/domains/admin-console/
  tests: src/domains/admin-console/__tests__/
exports:
  - AdminConsolePageSlug
  - AdminConsoleShell
  - AdminConsolePage
  - getAdminOverviewPage
  - getAdminArtifactsPage
  - getAdminIngestPage
  - getAdminStylesPage
  - getAdminProjectsPage
  - getAdminAuditPage
  - getAdminJobsPage
  - getAdminAbusePage
  - getAdminOperatorsPage
  - getAdminConsolePage
  - renderAdminConsoleHtml
  - adminConsoleRoute
  - opsSignInPage
  - opsSignIn
  - opsSignOut
consumes:
  - identity.requireOperatorSession
  - identity.createOperatorSession
  - identity.verifyPasswordHash
  - identity.listOperators
  - identity.grantOperatorRole
  - identity.revokeOperatorRole
  - identity.recordAuthEvent
  - email.sendTransactionalEmail
  - control_plane.triggerIngest
  - control_plane.listArtifactsEndpoint
  - control_plane.promoteArtifactEndpoint
  - control_plane.rollbackArtifactEndpoint
  - control_plane.createProjectEndpoint
  - control_plane.rotateApiKeyEndpoint
  - control_plane.getProjectUsageEndpoint
  - control_plane.createStyleVersionEndpoint
  - control_plane.publishStyleVersionEndpoint
  - control_plane.listAuditEventsEndpoint
  - control_plane.listJobsEndpoint
  - projects.listProjects
  - projects.listProjectsByWorkspace
  - styles.listStyles
  - design_system
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/admin-console/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/admin-console/"
status: ready

---

# Admin Console Domain

Owns the operator-facing HTML console at `/ops/*` and operator sign-in flow. Sits on top of the existing `control_plane` HTTP API (which keeps its `/admin/*` routes for automation). The console replaces ad-hoc curl workflows with a real, audit-attributable, role-gated UI.

Customer surfaces never serve operator data and never accept `ops_session`. Operator surfaces never serve customer data and never accept `app_session`.

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`.

- **Design**: light-default minimalist (Linear/Stripe vibe). Same tokens, type scale, spacing, radii, motion, a11y, and voice as the customer surface — operator UI is NOT a separate aesthetic. Reuse only design-system primitives. The visual difference between customer and operator shells is a dense top-nav with role label "Operator" and a slightly tighter information density inside `Table`/`StatGrid` — not a different palette or typography.
- **Surfaces**: customer routes `/`, `/app`, `/app-api`, `/billing`, `/docs`, `/legal`, `/security`, `/status`, `/v1/*` use `app_session`. Operator routes `/admin/*` and `/ops/*` use `ops_session` (or `ADMIN_API_TOKEN` for automation on `/admin/*` only). Roles: `customer_member`, `customer_owner`, `operator` — one session is exactly one role. `/ops/*` rejects `app_session` and `ADMIN_API_TOKEN`; it accepts only `ops_session`.
- **Auth**: operator sign-in uses email+password+MFA (MFA is REQUIRED for operators, not optional). Tokens 32-byte random hashed SHA-256 at rest, single-use. Session cookie `ops_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`. CSRF on every mutating POST. Brute-force lockout 3 failures per email or IP in 15 minutes (tighter than customer).
- **Email**: Brevo only. Templates used here: `magic_link` (operator magic-link sign-in), `abuse_warning` (operator-issued), and any operator-initiated `member_removed` / `account_deletion_initiated` on behalf of a customer. Send failures never block operator workflows; banner surfaces pending state.
- **SaaS fundamentals**: operators can grant/revoke `operator` role to other users (initial operator is seeded via `INITIAL_OPERATOR_EMAIL` at first boot). Operators can issue abuse warnings to workspaces, suspend workspaces (soft-disables sign-in for all members), force-rotate any project key, and view audit/job logs. All operator actions produce attributable audit events tied to the operator user, not a shared token.

## Component Insertion Points

- `src/domains/admin-console/admin-console.service.ts` — page builders + HTML rendering
- `src/domains/admin-console/routes/ops-sign-in-route.ts` — `GET /ops/sign-in`, `POST /ops/sign-in`
- `src/domains/admin-console/routes/ops-sign-out-route.ts` — `POST /ops/sign-out`
- `src/domains/admin-console/routes/ops-overview-route.ts` — `GET /ops`
- `src/domains/admin-console/routes/ops-artifacts-route.ts` — `GET /ops/artifacts`
- `src/domains/admin-console/routes/ops-ingest-route.ts` — `GET /ops/ingest`, `POST /ops/ingest/start`
- `src/domains/admin-console/routes/ops-styles-route.ts` — `GET /ops/styles`, `POST /ops/styles/:styleId/publish/:versionId`
- `src/domains/admin-console/routes/ops-projects-route.ts` — `GET /ops/projects`, `GET /ops/projects/:projectId`, `POST /ops/projects/:projectId/keys/rotate`
- `src/domains/admin-console/routes/ops-audit-route.ts` — `GET /ops/audit`
- `src/domains/admin-console/routes/ops-jobs-route.ts` — `GET /ops/jobs`
- `src/domains/admin-console/routes/ops-abuse-route.ts` — `GET /ops/abuse`, `POST /ops/abuse/warn`, `POST /ops/abuse/suspend`
- `src/domains/admin-console/routes/ops-operators-route.ts` — `GET /ops/operators`, `POST /ops/operators/grant`, `POST /ops/operators/revoke`
- `src/domains/admin-console/components/ops-shell.ts` — operator shell (consumes design-system)
- `src/domains/admin-console/__tests__/`

## Public API Contract

- `getAdminConsolePage(session, input): AdminConsolePage`
- Individual page builders (`getAdminOverviewPage`, `getAdminArtifactsPage`, …) return strongly-typed page payloads.
- `renderAdminConsoleHtml(page: AdminConsolePage): string`
- `adminConsoleRoute(input): AdminConsoleRouteResponse` — HTTP entry
- `opsSignInPage(input): AdminConsoleSignInPage`
- `opsSignIn(input: { email, password, totp? }): Promise<{ session: IdentitySession; mfaRequired?: true }>`
- `opsSignOut(sessionToken: string): Promise<void>`

## Endpoint Surface

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
- `HEAD` / `OPTIONS` for each

## Owned Invariants

### Operator Sign-In
- `/ops/sign-in` accepts `{ email, password, totp? }`. MFA is mandatory for operators — accounts without MFA enrolled are forced into TOTP setup on first sign-in before they can take any action.
- Brute-force lockout is tighter than customer: 3 failures per email or IP in 15 minutes triggers a 15-minute cooldown.
- Successful sign-in mints `ops_session` (separate cookie from `app_session`), persists `OPERATOR_SIGNED_IN`, redirects to `/ops`.
- If the user signing in does not hold the `operator` role, sign-in fails closed with `ADMIN_NOT_OPERATOR` (same error surface as invalid credentials so a customer who knows an operator's email cannot probe role state).
- Sign-out revokes the session, persists `OPERATOR_SIGNED_OUT`, redirects to `/ops/sign-in`.

### Role Gating
- Every `/ops/*` request requires a valid `ops_session` resolving to a user with `operator` role. Missing or invalid session redirects to `/ops/sign-in`.
- `app_session` cookies presented to `/ops/*` are ignored and the user is redirected to `/ops/sign-in`.
- `ADMIN_API_TOKEN` is NOT honored on `/ops/*` — it only authorizes the existing `/admin/*` HTTP automation surface.
- Role enforcement is performed at the route boundary AND inside the exported page-builder service so direct callers cannot bypass it.

### Page Surface
- **Overview**: counts of artifacts, projects, recent jobs, recent audit events; quick-action buttons for "Trigger ingest", "Promote latest artifact", "Open audit log".
- **Artifacts**: table of all artifacts with promote/rollback actions; active artifact pinned to top; promote requires a confirmation modal.
- **Ingest**: trigger form with snapshot ID, source URL, expected checksum; running job state inline; recent jobs table.
- **Styles**: list of styles; per-style detail with version table; publish action requires confirmation modal.
- **Projects**: search by project ID, workspace ID, or owning email; read-only project detail (no edits — operator does not become an unauditable workspace member); key-rotate action with strong confirmation; usage snapshot.
- **Audit**: paginated audit-event log with filters (event type, actor, outcome, date range).
- **Jobs**: paginated admin-job log with filters (status, actor, date range).
- **Abuse**: form to issue an `abuse_warning` email to a workspace owner; form to suspend a workspace (soft-disable sign-in for all members for a stated reason); table of currently suspended workspaces with unsuspend action.
- **Operators**: list current operators (email, last sign-in, MFA status); grant/revoke role with confirmation modal.

### Action Confirmations
- Every destructive or platform-wide action (promote, rollback, publish, key rotate, suspend, grant/revoke operator) requires an explicit confirmation modal that:
  - States the action in plain English ("Promote artifact v42 to active").
  - Echoes the target ID for visual confirmation.
  - Captures a short reason string (required, ≥ 8 chars) that is included in the audit event.
  - Uses the `danger` Button variant for destructive confirmations.
- All actions produce audit events with the operator's user ID (not a token actor); the audit event includes the captured reason.

### Customer Data Scoping
- The Projects page exposes project metadata, owning workspace, plan, last key rotation, usage summary, and the list of API key IDs (hashed identity only — never raw tokens).
- Operator key rotation surfaces the new one-time token in a `KeyReveal` card with the standard "will not be shown again" warning. The audit event records the rotation; the operator is expected to communicate the new key to the customer through a customer-trusted channel (not platform-managed).
- The Projects page does NOT expose customer email PII unless the operator clicks a "Show owner contact" button; that click is audit-logged as `OPERATOR_VIEWED_PII`.
- No customer payloads are returned in plain bulk export from `/ops/*`. Bulk data export remains the customer's own `/app/settings/account/export` flow.

### Abuse Actions
- Issuing `abuse_warning` sends the templated email (params: subject text + body markdown + appeal URL) and records the action.
- Workspace suspension flips a `workspaceSuspended` flag in identity that customer sign-in checks; suspended members receive an `account_deletion_initiated`-styled banner on next sign-in attempt with the operator-provided reason. (No new template required — the existing `abuse_warning` template covers both.)
- Suspension is revocable from the same surface; unsuspension is also audit-logged.

### Operator Role Management
- Grant: enter target email; if the email is registered, the role is granted immediately; if not, an invitation token is minted that on accept also grants the operator role. Granting is audit-logged.
- Revoke: requires confirmation; the operator cannot revoke their own role (prevents foot-gun); audit-logged.
- Initial operator: `INITIAL_OPERATOR_EMAIL` env var at first boot — the first user matching that email automatically receives `operator` role on signup; subsequent operators require an existing operator to grant.

### CSRF
- Same double-submit cookie pattern as `auth_flows`. Every `POST /ops/*` validates `_csrf`.

## Error Taxonomy

- `ADMIN_BAD_REQUEST`
- `ADMIN_NOT_OPERATOR` — session has no operator role
- `ADMIN_UNAUTHORIZED` — missing session
- `ADMIN_MFA_REQUIRED` — operator needs MFA to proceed
- `ADMIN_LOCKED_OUT` — brute-force lockout active
- `ADMIN_CONFIRM_REQUIRED` — destructive action attempted without reason string
- `ADMIN_DEPENDENCY_FAILED` — downstream `control_plane` call failed

## Data Stores

Admin console does not own its own persistent store; it consumes:
- `identity` — operator role, session, audit events, lockout counters.
- `control_plane` Prisma rows — `AdminAuditEvent`, `AdminJob`.
- `projects` — read-only project listings.
- `styles` — read-only style listings.

`identity` adds:
- `IdentityUser.roleOperatorGrantedAt?` — timestamp of operator role grant (null = not an operator).
- `IdentityUser.workspaceSuspendedReason?`, `IdentityWorkspace.suspendedAt?`, `IdentityWorkspace.suspendedReason?` — suspension state per workspace.
- `OperatorRoleAuditEvent` rows record grant/revoke history alongside the general auth event log.

## Owned Invariants (input hardening)

- All exported service functions and route helpers fail closed on non-object runtime input or malformed string types with `ADMIN_BAD_REQUEST`.
- Path segments for `:projectId`, `:styleId`, `:versionId` reject path separators, traversal markers, and exact `.` at the route boundary AND inside the exported service surface.
- Operator email lookup is lowercased and trimmed; mixed-case input cannot create duplicate operator rows.
- Confirmation reason strings are trimmed and capped at 280 chars; control characters stripped.

## SaaS Launch Baseline

- The admin console is the human-facing front for `/admin/*`. The HTTP API at `/admin/*` continues to accept `ADMIN_API_TOKEN` for automation and now ALSO accepts `ops_session` for operator-attributable calls from `/ops/*` page builders.
- Operator audit events resolve to a real operator user ID (not a shared-token actor) when triggered via `/ops/*`. Token-based `/admin/*` calls continue to produce a `machine:<hashed_token>` actor.
- MFA is mandatory for operators in production. A deployment that has any operator without MFA-enrolled accounts forces enrollment on first sign-in and refuses to mint `ops_session` until enrollment completes.
- Operator MFA uses the same identity-owned AES-GCM helper as customer MFA. The key is validated during startup, not discovered lazily during operator sign-in.
- Initial operator seed: `INITIAL_OPERATOR_EMAIL` is read at first boot; subsequent boots ignore it. If unset in production, the platform boots with no operators — `/ops/sign-in` works but no user has the role until a deployer manually flips it in the database (intentional fail-closed posture).
- `/ops/*` is served from the same HTTP origin as the customer surface by default (path-split). Deployers MAY restrict `/ops/*` to private network ACLs on top of role enforcement.

## Dependency Direction

- May depend on `identity`, `email`, `control_plane`, `projects`, `styles`, and `design_system`.
- Must not be depended on by `customer_console`, `app_console`, `marketing_site`, `docs_site`, `auth_flows`, `billing_sync`, `tile_api`, `raster_api`, `access`, `tile_resolver`, `render`, `artifact`, or `ingest`.
