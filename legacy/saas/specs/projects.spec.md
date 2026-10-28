---
name: projects
description: "Project registry, API key issuance/verification, and per-project delivery policies"
paths:
  types: src/domains/projects/types.ts
  service: src/domains/projects/projects.service.ts
  components: src/domains/projects/
  tests: src/domains/projects/__tests__/
exports:
  - Project
  - ApiKeyRecord
  - IssuedApiKey
  - ProjectIdentity
  - ProjectCreationInput
  - ProjectUpdateInput
  - ProjectPolicy
  - ProjectsError
  - ProjectsErrorCode
  - resolveProjectIdentity
  - verifyApiKey
  - listProjects
  - listProjectsByWorkspace
  - listProjectKeys
  - createProject
  - updateProject
  - syncWorkspaceProjectPlan
  - rotateApiKey
  - revokeApiKey
  - deleteProject
  - getProjectPolicy
consumes:
  - config.SecurityConfig
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/projects/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/projects/"
status: ready
---

# Projects Domain

Owns everything that turns a provided API token into a sanitized project identity and project policy.

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain does not render UI directly. Relevant cross-cutting effects for subagents:

- **Workspace suspension**: when the owning workspace carries `suspendedAt`, project mutations (`createProject`, `updateProject`, `rotateApiKey`) MUST fail closed with `PROJECTS_WORKSPACE_SUSPENDED` and `verifyApiKey` MUST return `null` (deny). Read operations (`listProjects`, `listProjectsByWorkspace`, `listProjectKeys`, `getProjectPolicy`) continue to return data so customer-console and admin-console can still inspect the workspace.
- **Workspace soft-delete**: when the owning workspace carries `deletedAt`, all project rows for that workspace are treated as soft-deleted; `verifyApiKey` returns `null` and listing surfaces honor a `includeDeleted?: boolean` opt-in (default false).
- **Key rotation receipt**: every successful `rotateApiKey` emits a domain event consumed by `customer_console` to trigger the `key_rotated_receipt` email. Projects does not call email directly; it persists the key rotation and lets the upstream domain dispatch the notification.
- **Plan sync**: `syncWorkspaceProjectPlan` continues to be called from `billing_sync` on Stripe subscription changes; project rows reflect the workspace plan deterministically across instances.

## Component Insertion Points

- `src/domains/projects/projects.service.ts`
- `src/domains/projects/__tests__/projects-service.test.ts`

## Public API Contract

- `verifyApiKey(rawToken: string): ApiKeyRecord | null`
- `resolveProjectIdentity(ctx): { projectId: string; keyId: string; keyHash: string; keyIdHash: string; planId: string } | null`
- `listProjects(): Project[]`
- `listProjectsByWorkspace(workspaceId: string): Project[]`
- `listProjectKeys(projectId: string): ApiKeyRecord[]`
- `createProject(input): Project`
- `updateProject(projectId: string, input): Project`
- `syncWorkspaceProjectPlan(workspaceId: string, planId: string): Project[]`
- `rotateApiKey(projectId: string): IssuedApiKey`
- `revokeApiKey(projectId: string, keyId: string): ApiKeyRecord`
- `deleteProject(projectId: string): void`
- `getProjectPolicy(projectId: string): ProjectPolicy`

## Project Policy Surface

- Allowed origins (optional per project).
- Allowed endpoint groups (`tiles`, `raster`, `static` / `staticMaps`).
- Quota policy (minute/day/month limits).
- Cache behavior overrides (restricted use).

## Owned Invariants

- Verification and listing surfaces never return raw token values; only key identifiers and hashed identities.
- Project listing surfaces are deterministic newest-first, with a stable secondary project identifier sort when multiple rows share the same creation timestamp.
- Project key listing never returns raw token material and is safe for customer-console read models.
- Project key listing order is deterministic newest-first, with a stable secondary identifier sort when multiple keys share the same creation timestamp.
- Rotation returns a one-time raw token (`IssuedApiKey.token`) alongside hashed identity fields.
- Key rotation revokes previously active keys for the project before issuing a new one, and that revoke-and-issue path is transactional so failed issuance cannot strand a project without an active key.
- Project deletion must leave no surviving valid API-key identity for the removed project; exported key verification fails closed once the owning project is gone.
- Project deletion maps only true missing-project cases to `PROJECTS_PROJECT_NOT_FOUND`; other persistence failures must propagate instead of being silently collapsed into not-found.
- Exported project/key lookup and mutation functions must reject path separators and traversal markers, including embedded `..`, in `projectId` and `keyId` instead of relying on downstream persistence lookups to fail later.
- Exported project/key lookup and mutation functions also fail closed on non-string runtime identifier, name, workspace, and plan inputs instead of leaking raw string-operation failures from direct callers.
- Exported project creation and update helpers also fail closed on malformed non-object runtime payloads instead of leaking raw property-access failures from direct callers.
- Exported token-resolution helpers also fail closed on non-string runtime token input, returning anonymous/null results instead of leaking raw string-operation failures from direct callers.
- Persisted project policy blobs are re-validated on read, so malformed stored JSON or invalid stored policy shape fails with owned `PROJECTS_POLICY_INVALID` errors instead of leaking raw JSON parse or shape errors through listing and policy-read surfaces.
- Persisted project rows are also re-validated on read, so malformed stored identifiers or metadata are skipped from listing surfaces and fail closed on targeted reads or identity resolution instead of leaking broken project records out of the domain.
- Persisted API-key rows are also re-validated on read, so malformed stored key metadata fails closed to null verification results or is skipped from key-listing read models instead of leaking invalid key records out of the domain.
- Project updates merge partial policy edits without dropping unspecified policy state, including service-level `allowedEndpoints` partial updates that only set one toggle.
- Workspace-wide plan sync is transactional, so a failed sync cannot leave one workspace partially migrated across plan IDs.
- Allowed origin policy entries are normalized to bare absolute `http(s)` origins and reject paths, query strings, fragments, credentials, or non-HTTP schemes at the source boundary.
- Workspace ownership is stored on each project so customer and billing surfaces can scope and sync projects without shadow maps.
- Empty workspace listing remains available even when unrelated runtime config is absent or invalid; legacy token bootstrap must not block customer onboarding reads.
- Store adapters are deterministic, unit-testable, and side-effect minimal.

## Error Taxonomy

- `PROJECTS_KEY_INVALID`
- `PROJECTS_KEY_REVOKED`
- `PROJECTS_PROJECT_NOT_FOUND`
- `PROJECTS_POLICY_INVALID`

## Data Stores

- Prisma `Project` model holds project identity, owning workspace, plan, policy JSON, and creation timestamp.
- Prisma `ApiKey` model holds hashed key identity (`keyHash`, `keyId`, `keyIdHash`), revocation state, and the owning `projectId` foreign key with cascade delete on project removal.
- All historical in-memory project/key representations have been removed; persistence is the only source of truth.

## SaaS Launch Baseline

- Project create, update, delete, list, and key issue/rotate/revoke flows must run as Prisma transactions where multi-row consistency is required (notably: rotate-and-revoke, plan sync across a workspace).
- Persisted policy JSON is re-validated on read so a corrupted or tampered row fails closed with `PROJECTS_POLICY_INVALID` instead of leaking malformed policy state into authorization decisions.
- Verified API tokens never persist raw key material; only the salted/hashed key identity columns are written. Raw token material is returned exactly once at issuance/rotation time.
- Workspace ownership (`workspaceId`) is stored directly on each project so the customer console can scope listings without shadow maps and so billing-sync can propagate plan changes deterministically across workspace-owned projects.

## Dependency Direction

- May depend on `config`.
- Must not depend on request-path domains (`tile_api`, `raster_api`, `access`).
