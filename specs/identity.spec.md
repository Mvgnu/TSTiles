---
name: identity
description: "Persistent identity: users, workspaces, memberships, sessions, credentials (passwords + tokens + MFA), roles, auth events, and brute-force lockouts. Consumed by auth_flows and admin_console; provides session resolution for customer and operator surfaces."
bar:
  reference: "OWASP Password Storage Cheat Sheet and OWASP Session Management Cheat Sheet"
  property: "Stored password credentials are standard-verifiable Argon2id values, bearer secrets cannot be recovered from database rows, and production refuses to operate when required secrets are missing."
paths:
  types: src/domains/identity/types.ts
  service: src/domains/identity/identity.service.ts
  components: src/domains/identity/
  tests: src/domains/identity/__tests__/
exports:
  - IdentityRole
  - IdentityError
  - IdentityErrorCode
  - IdentityUser
  - IdentityWorkspace
  - IdentityMembership
  - IdentitySession
  - IssuedIdentitySession
  - IdentityCredentialToken
  - IdentityAuthEvent
  - IdentityAuthLockout
  - CredentialTokenPurpose
  - WorkspaceUpdateInput
  - CreateUserInput
  - getSession
  - getWorkspace
  - listWorkspaceMemberships
  - updateWorkspace
  - resolveSession
  - requireSession
  - requireCustomerSession
  - requireOperatorSession
  - revokeSession
  - clearSession
  - createUser
  - getUserByEmail
  - getUserById
  - markEmailVerified
  - setPasswordHash
  - verifyPasswordHash
  - createSession
  - createOperatorSession
  - createCredentialToken
  - consumeCredentialToken
  - getCredentialToken
  - createWorkspace
  - attachWorkspaceMember
  - removeWorkspaceMember
  - transferWorkspaceOwnership
  - softDeleteWorkspace
  - hardDeleteWorkspace
  - softDeleteUser
  - hardDeleteUser
  - grantOperatorRole
  - revokeOperatorRole
  - listOperators
  - recordAuthEvent
  - listAuthEvents
  - incrementLockoutCounter
  - clearLockoutCounter
  - isLockedOut
consumes:
  - config.SecurityConfig
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/identity/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/identity/"
status: ready
---

# Identity Domain

Owns the persistent identity store: users, workspaces, memberships, sessions, credentials (passwords + single-use tokens + MFA), roles, audit events, and brute-force lockout state. This domain is the foundation for both the customer auth surface (consumed by `auth_flows`) and the operator surface (consumed by `admin_console`).

Identity is intentionally a thick persistence layer in the v1 SaaS launch — the demo bridge and the managed-auth header bridge are retained as optional paths, but the default production posture ships first-party email + password + email verification + magic link, all backed by Prisma rows in this domain.

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Dark parity uses the matching tokens. Inter sans + JetBrains Mono. WCAG AA contrast, 2px focus ring, keyboard reachable. Voice: precise, calm, no emoji. Identity itself does not render UI but its exported error taxonomy must produce plain user-facing messages when surfaced through `auth_flows` / `admin_console`.
- **Surfaces**: customer routes use `app_session`. Operator routes use `ops_session`. Identity issues both cookie types from distinct service functions (`createSession` for customers, `createOperatorSession` for operators) and never mixes scopes.
- **Auth**: v1 is first-party email + password + email verification + magic link. Tokens 32-byte random hashed SHA-256 at rest, single-use; verification 24h, reset 1h, magic-link 15m, invitation 7d. Passwords argon2id at rest. Managed-auth header bridge (`IDENTITY_MANAGED_AUTH_MODE=header`) stays available for enterprise SSO and bypasses the credential storage path. Demo bridge gated to `NODE_ENV=development`.
- **Email**: Brevo only. Identity does not call email directly — `auth_flows` and `admin_console` are the email triggers. Identity exposes the data they need to compose URLs and template params.
- **SaaS fundamentals**: workspace ownership taxonomy (`customer_member`, `customer_owner`, `operator`) lives here. Account/workspace soft-delete + 30-day grace + hard-delete purge live here.

## Component Insertion Points

- `src/domains/identity/identity.service.ts` — public service exports
- `src/domains/identity/routes/session-route.ts` — `GET /app-api/session`
- `src/domains/identity/routes/demo-sign-in-route.ts` — dev-only `POST /auth/demo/sign-in`
- `src/domains/identity/routes/demo-sign-out-route.ts` — dev-only `POST /auth/demo/sign-out`
- `src/domains/identity/components/password-hash.ts` — argon2id wrapper
- `src/domains/identity/components/credential-token-hash.ts` — SHA-256 random-token wrapper
- `src/domains/identity/components/lockout.ts` — persistent + in-memory lockout counters
- `src/domains/identity/components/managed-auth-bridge.ts` — header-bridge projection
- `src/domains/identity/__tests__/`

## Public API Contract

### Session resolution
- `getSession(token: string): Promise<IdentitySession | null>` — hashes the presented token for lookup; the resolved object does not echo the bearer value
- `resolveSession(headers): Promise<IdentitySession | null>` — returns either an `app_session`-backed or `ops_session`-backed session, or projection from managed-auth headers when enabled
- `requireSession(headers): Promise<IdentitySession>` — throws `IDENTITY_UNAUTHORIZED` if missing
- `requireCustomerSession(headers): Promise<IdentitySession>` — additionally rejects `operator` sessions
- `requireOperatorSession(headers): Promise<IdentitySession>` — additionally rejects `customer_member`/`customer_owner` sessions and missing/expired operator MFA enrollment
- `revokeSession(token: string): Promise<boolean>`
- `clearSession(headers): Promise<boolean>` — convenience wrapper that revokes whichever session is present
- `createSession(userId: string, opts?: { userAgent?, clientIpHash? }): Promise<IssuedIdentitySession>` — mints an `app_session`; only this issuance shape includes the raw `token`
- `createOperatorSession(userId: string, opts?: { userAgent?, clientIpHash? }): Promise<IssuedIdentitySession>` — mints an `ops_session`; only this issuance shape includes the raw `token`; throws if user does not hold the `operator` role or has not enrolled MFA

### User
- `createUser(input: CreateUserInput): Promise<IdentityUser>` — input: `{ email, displayName?, passwordHash? }`. Email is normalized to lowercase before insertion. Returns the created user. Does not create a session.
- `getUserByEmail(email: string): Promise<IdentityUser | null>`
- `getUserById(userId: string): Promise<IdentityUser | null>`
- `markEmailVerified(userId: string): Promise<IdentityUser>`
- `setPasswordHash(userId: string, passwordHash: string): Promise<void>` — input is the already-encoded argon2id string; this function never hashes raw passwords (raw passwords never enter this domain unsanitized)
- `verifyPasswordHash(userId: string, candidatePassword: string): Promise<boolean>` — verifies standard Argon2id; a successful check of the explicitly recognized legacy scrypt-labelled-as-Argon2id shape replaces it with a standard Argon2id credential
- `softDeleteUser(userId: string, reason: string): Promise<void>` — sets `deletedAt` and `deletionReason`; revokes all sessions; blocks further sign-in
- `hardDeleteUser(userId: string): Promise<void>` — final purge; intended to run only after the grace window from `softDeleteUser`

### Workspace
- `createWorkspace(input: { name, ownerUserId }): Promise<IdentityWorkspace>`
- `getWorkspace(workspaceId: string): Promise<IdentityWorkspace>`
- `updateWorkspace(workspaceId: string, input: WorkspaceUpdateInput): Promise<IdentityWorkspace>` — input: `{ name?, billingEmail? }`
- `listWorkspaceMemberships(workspaceId: string): Promise<IdentityMembership[]>`
- `attachWorkspaceMember(workspaceId: string, userId: string, role: "customer_member" | "customer_owner"): Promise<IdentityMembership>`
- `removeWorkspaceMember(workspaceId: string, userId: string, reason: string): Promise<void>` — blocked if user is the sole owner
- `transferWorkspaceOwnership(workspaceId: string, fromUserId: string, toUserId: string): Promise<void>` — atomic role swap inside a transaction
- `softDeleteWorkspace(workspaceId: string, reason: string): Promise<void>` — sets `deletedAt`; revokes all member sessions; blocks customer reads
- `hardDeleteWorkspace(workspaceId: string): Promise<void>` — final purge

### Credential tokens
- `createCredentialToken(input: { userId?: string; purpose: CredentialTokenPurpose; meta?: Record<string, unknown>; lifetimeMs: number }): Promise<{ tokenId: string; rawToken: string }>` — returns the raw 32-byte base64url token for the caller to embed in an email link; the database stores only the SHA-256 hash
- `consumeCredentialToken(rawToken: string, purpose: CredentialTokenPurpose): Promise<IdentityCredentialToken>` — atomic: validates not-expired and not-consumed, marks consumed, returns the row
- `getCredentialToken(rawToken: string, purpose: CredentialTokenPurpose): Promise<IdentityCredentialToken | null>` — non-consuming read for UI preflight (e.g., "show reset form" without consuming)

### Operator role
- `grantOperatorRole(userId: string, grantedByUserId: string, reason: string): Promise<void>`
- `revokeOperatorRole(userId: string, revokedByUserId: string, reason: string): Promise<void>` — blocked if user is revoking themselves
- `listOperators(): Promise<IdentityUser[]>`

### Audit + lockout
- `recordAuthEvent(event: IdentityAuthEvent): Promise<void>`
- `listAuthEvents(opts?: { userId?: string; eventType?: string; limit?: number }): Promise<IdentityAuthEvent[]>`
- `incrementLockoutCounter(key: string, kind: "email" | "ip"): Promise<{ failureCount: number; lockedUntil?: Date }>`
- `clearLockoutCounter(key: string, kind: "email" | "ip"): Promise<void>`
- `isLockedOut(key: string, kind: "email" | "ip"): Promise<boolean>`

## Endpoint Surface (owned)

- `GET /app-api/session` — current customer session
- `POST /auth/demo/sign-in` — dev only
- `POST /auth/demo/sign-out` — dev only
- `OPTIONS` preflight for identity endpoints

Customer auth flow endpoints (`/sign-up`, `/sign-in`, `/verify-email`, `/forgot-password`, `/reset-password`, `/magic-link`, `/accept-invite`, `/sign-out`) live in `auth_flows.spec.md` and consume identity exports.

Operator auth flow endpoints (`/ops/sign-in`, `/ops/sign-out`) live in `admin_console.spec.md` and consume identity exports.

## Owned Invariants

### Session resolution
- `app_session` cookie resolves only to customer sessions (`customer_member` or `customer_owner`). `ops_session` cookie resolves only to operator sessions.
- `requireCustomerSession` rejects operator sessions with `IDENTITY_WRONG_SURFACE`; `requireOperatorSession` rejects customer sessions with the same code.
- When the managed-auth header bridge is enabled (`IDENTITY_MANAGED_AUTH_MODE=header`), trusted `x-auth-*` headers take precedence over ambient cookies. The bridge upserts users and memberships into Prisma so multi-instance deployments share consistent state.
- Partial `x-auth-*` header sets fail closed; the bridge requires both user and workspace identifiers when any `x-auth-*` header is present.
- Demo session bridge is development-only and fails closed in staging/production.
- Session resolution never depends on project access tokens or `ADMIN_API_TOKEN`.
- Workspace membership is explicit and session-scoped.
- Workspace membership listings are deterministic (owners first, then by `userId`).
- Workspace metadata updates propagate to active session snapshots.

### Credentials
- Passwords are argon2id at rest (the password column stores the encoded argon2id string only). The identity domain refuses plaintext and malformed password writes and fails closed on unknown credential formats.
- New hashes are standard Argon2id PHC strings (`m=19456,t=2,p=1`, 16-byte salt, 32-byte output). The former 64-byte scrypt digest falsely labelled as Argon2id is accepted only as a narrowly matched migration format and is rehashed immediately after successful verification; it is rejected by password write APIs.
- Credential tokens (verification, reset, magic-link, invitation) are 32-byte cryptographic random, base64url-encoded, with SHA-256 hash stored at rest. Plaintext leaves the domain only via the `rawToken` return value of `createCredentialToken` and is never persisted.
- Token consumption is atomic: `consumeCredentialToken` validates `expiresAt > now`, validates `consumedAt IS NULL`, sets `consumedAt`, and returns the row — all inside a single Prisma transaction.
- Expired or already-consumed tokens fail closed with `IDENTITY_TOKEN_INVALID`.
- MFA secrets are AES-GCM encrypted at rest using `MFA_ENCRYPTION_KEY`. Recovery codes are argon2id hashed individually.
- Customer and operator MFA use the same identity-owned AES-GCM helper and the centrally validated `MFA_ENCRYPTION_KEY`; neither service derives or caches a fallback key at module import.

### Roles
- Three roles only: `customer_member`, `customer_owner`, `operator`. The membership row carries the `customer_*` role. The user row carries `roleOperatorGrantedAt` (nullable). A user with a non-null `roleOperatorGrantedAt` may sign into `/ops/*`.
- A user can hold both a customer membership and the operator role simultaneously, but a single session is exactly one role (`createSession` vs `createOperatorSession`).
- Initial operator seed: `INITIAL_OPERATOR_EMAIL` is consulted only at first boot when no operator user exists.
- Grant/revoke operator role is audit-logged with the grantor user ID. A user cannot revoke their own operator role (prevents accidental lockout).

### Lockouts
- Lockout counters are persistent (`IdentityAuthLockout` rows) so an attacker cannot bypass lockout by hitting different instances.
- Counter increment is atomic via Prisma transaction.
- Customer lockout: 5 failures per email or IP in 15 minutes → 15-minute cooldown. Operator lockout: 3 failures per email or IP in 15 minutes → 15-minute cooldown.

### Workspace lifecycle
- Workspace creation, member attachment, ownership transfer, and soft-delete all run inside Prisma transactions where multi-row consistency is required.
- Soft-deleting a workspace revokes all member sessions and flips a `suspendedAt` flag that downstream domains (customer-console, billing-sync) honor when scoping reads.
- Hard-deleting a workspace cascades to all child rows (projects, keys, usage buckets, billing snapshot, audit events PII fields nulled).
- A workspace must have at least one `customer_owner` at all times; the last owner cannot be removed and cannot leave until a transfer completes.

### Input hardening
- Exported identity service inputs reject path-like or traversal-style values, including embedded traversal markers, at the source boundary.
- Exported workspace metadata updates validate both the update object shape and `name` at the identity boundary, returning `IDENTITY_BAD_REQUEST` for malformed, non-string, or blank values.
- Exported session-token entry points (`getSession`, `revokeSession`) fail closed on path-like or traversal-style token values.
- Exported header-based session helpers fail closed on malformed runtime header maps (treated as missing-session input).
- Exported route helpers fail closed on malformed runtime request objects or non-string `method`/`path`/header values with `IDENTITY_BAD_REQUEST`.
- Demo sign-in route helper rejects malformed non-object request bodies at the route boundary.
- Session revocation clears the relevant session cookie (`app_session` for customer, `ops_session` for operator) and invalidates the backing session token.
- Persisted identity state fails closed when malformed, missing, or contains orphaned relationships.
- Email addresses are normalized to lowercased trim before any insertion or lookup; mixed-case input cannot produce duplicate user rows.

### Managed-auth bridge (retained, optional)
- When `IDENTITY_MANAGED_AUTH_MODE=header` is enabled and trusted `x-auth-*` headers are present, those headers take precedence over ambient session cookies or `x-session-token` input.
- Managed-auth refreshes preserve previously synced user email/name and workspace name when the provider omits those optional fields on later requests.
- Identity endpoint preflight/CORS responses advertise the trusted `x-auth-*` headers only when the managed-auth bridge is enabled.
- The managed-auth bridge can fully replace first-party `auth_flows` when enabled; in that mode `auth_flows` routes return `404` or redirect to the provider hosted UI per `AUTH_PROVIDER_HOSTED_URL`.

## Error Taxonomy

- `IDENTITY_BAD_REQUEST`
- `IDENTITY_UNAUTHORIZED`
- `IDENTITY_NOT_FOUND`
- `IDENTITY_TOKEN_INVALID`
- `IDENTITY_TOKEN_EXPIRED`
- `IDENTITY_WRONG_SURFACE` — operator session presented to customer surface or vice versa
- `IDENTITY_OPERATOR_MFA_REQUIRED` — operator account has not enrolled MFA
- `IDENTITY_OWNERSHIP_REQUIRED` — workspace mutation requires owner role
- `IDENTITY_LAST_OWNER_BLOCKED` — cannot remove or demote the only remaining owner
- `IDENTITY_OPERATOR_SELF_REVOKE` — operator attempting to revoke own role

## Data Stores

All identity data lives in Prisma. The legacy `IDENTITY_STATE_FILE` JSON snapshot path is fully retired; the env var is ignored.

### Models

- `IdentityUser`
  - `id` (cuid), `email` (unique, lowercased)
  - `displayName?`
  - `passwordHash?` (argon2id encoded; `null` for managed-auth-only users)
  - `emailVerifiedAt?`
  - `mfaSecretEncrypted?` (AES-GCM with `MFA_ENCRYPTION_KEY`)
  - `mfaEnabledAt?`
  - `mfaRecoveryCodesHashedJson?` (JSON array of argon2id-hashed recovery codes)
  - `roleOperatorGrantedAt?`
  - `roleOperatorGrantedByUserId?`
  - `roleOperatorRevokedAt?`
  - `deletedAt?`, `deletionReason?`, `purgeAt?`
  - `createdAt`, `updatedAt`
- `IdentityWorkspace`
  - `id`, `name`, `billingEmail?`
  - `suspendedAt?`, `suspendedReason?`, `suspendedByUserId?`
  - `deletedAt?`, `deletionReason?`, `purgeAt?`
  - `createdAt`, `updatedAt`
- `IdentityMembership`
  - Compound `@@id([workspaceId, userId])`
  - `workspaceId`, `userId`, `role` (`customer_member | customer_owner`), `createdAt`
- `IdentitySession`
  - `id`, `tokenHash` (SHA-256 of the cookie value, never the plaintext token), `userId`, `workspaceId?` (active workspace context for this session)
  - `sessionKind` (`app | ops`)
  - `userAgent?`, `clientIpHash?`
  - `createdAt`, `expiresAt`, `revokedAt?`
- `IdentityCredentialToken`
  - `id`, `tokenHash` (unique), `userId?`, `purpose`, `metaJson?`
  - `createdAt`, `expiresAt`, `consumedAt?`
- `IdentityAuthEvent`
  - `id`, `eventType`, `userId?`, `workspaceId?`, `actorRole?`, `clientIpHash?`, `userAgent?`, `outcome`, `reason?`, `recordedAt`
- `IdentityAuthLockout`
  - `id`, `key` (lowercased email OR HMAC of IP), `keyKind` (`email | ip`), `failureCount`, `windowStart`, `lockedUntil?`

Schema-level constraints (compound `@@id` on memberships, unique session token hash, unique credential token hash) prevent orphaned or malformed rows.

## SaaS Launch Baseline

- Production deployments boot with `DATABASE_URL`, Brevo configuration (consumed via `email` domain), and either:
  - first-party auth (default, `auth_flows` active), or
  - managed-auth bridge (`IDENTITY_MANAGED_AUTH_MODE=header` + provider headers wired by an upstream proxy).
- Demo sign-in/out routes (`/auth/demo/*`) are gated to `NODE_ENV=development` and unreachable in staging/production.
- The optional `IDENTITY_STATE_FILE` env var is ignored; identity now lives entirely in Prisma.
- All credential storage (passwords, tokens, MFA secrets, recovery codes) is hashed/encrypted at rest. Session bearer values are returned only by issuance calls and never written to or reconstructed from `IdentitySession` rows. Credential-token plaintext leaves the boundary only in email URLs minted by `auth_flows` / `admin_console`.
- Production and staging startup validates the MFA encryption key before requests can be served; only development receives a fixed, explicitly development-only key.
- Operator role enforcement is double-gated: at the route layer (`requireOperatorSession`) AND inside the exported page-builder service in `admin_console`.
- Workspace suspension and soft-delete state propagate into the customer surfaces (`customer_console`, `app_console`, `billing_sync`) which honor those flags before returning workspace data.

## Dependency Direction

- May remain standalone except for `config`.
- Must not depend on `control_plane`, `access`, delivery request-path domains, `email`, `auth_flows`, or `admin_console`. Identity is foundational and consumed by those domains.
