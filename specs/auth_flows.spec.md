---
name: auth_flows
description: "First-party email+password+verification signup/signin/reset/invite/magic-link flows for the customer surface; operator sign-in lives in admin_console"
bar:
  reference: "OWASP Password Storage Cheat Sheet and OWASP Session Management Cheat Sheet"
  property: "Stored password credentials are standard-verifiable Argon2id values, bearer secrets cannot be recovered from database rows, and production refuses to operate when required secrets are missing."
paths:
  types: src/domains/auth-flows/types.ts
  service: src/domains/auth-flows/auth-flows.service.ts
  components: src/domains/auth-flows/
  tests: src/domains/auth-flows/__tests__/
exports:
  - AuthFlowError
  - AuthFlowErrorCode
  - SignUpInput
  - SignInInput
  - PasswordResetRequestInput
  - PasswordResetCompleteInput
  - MagicLinkRequestInput
  - InvitationAcceptInput
  - signUp
  - signIn
  - signOut
  - requestEmailVerification
  - verifyEmailToken
  - requestPasswordReset
  - completePasswordReset
  - requestMagicLink
  - consumeMagicLink
  - acceptInvitation
  - authFlowsRoute
  - renderAuthFlowsHtml
consumes:
  - identity.createUser
  - identity.getUserByEmail
  - identity.markEmailVerified
  - identity.setPasswordHash
  - identity.verifyPasswordHash
  - identity.createSession
  - identity.revokeSession
  - identity.recordAuthEvent
  - identity.createCredentialToken
  - identity.consumeCredentialToken
  - identity.attachWorkspaceMember
  - identity.createWorkspace
  - email.sendTransactionalEmail
  - design_system
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/auth-flows/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/auth-flows/"
status: planned

---

# Auth Flows Domain

Owns the customer-facing authentication flow surface: signup with email verification, signin (password or magic link), password reset, workspace invitation acceptance, and signout. Persistence is delegated to `identity`; transactional mail is delegated to `email`; visual treatment is delegated to `design_system`. This domain is the thin orchestration layer that turns the persistent storage + mail provider into a real product auth experience.

Operator sign-in (`/ops/sign-in`) lives in `admin_console.spec.md` and uses the same `identity` + `email` foundations but a separate session cookie (`ops_session`).

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Inter sans + JetBrains Mono. Type scale 12/14/16/18/24/32/48. Spacing 4/8/12/16/24/32/48/64. Radii 4/8/12. One shadow token. Motion 120/200ms with `prefers-reduced-motion` honored. WCAG AA contrast, 2px focus ring, keyboard reachable. Voice: precise, calm, no emoji, no exclamation. Reuse only design-system primitives. Auth pages use the marketing shell (top nav, footer) for unauthenticated routes and redirect to `/app` after success.
- **Surfaces**: customer routes `/`, `/app`, `/app-api`, `/billing`, `/docs`, `/legal`, `/security`, `/status`, `/v1/*` use `app_session`. Operator routes `/admin/*` and `/ops/*` use `ops_session`. Roles: `customer_member`, `customer_owner`, `operator` — one session is exactly one role. Auth flows in this domain only mint `app_session` (customer surface).
- **Auth**: v1 is first-party email + password + email verification + magic link. Managed-auth header bridge stays available for enterprise SSO and short-circuits this domain. Passwords argon2id; tokens 32-byte random hashed SHA-256 at rest, single-use; verification 24h, reset 1h, magic-link 15m, invitation 7d. Session cookies `HttpOnly; Secure; SameSite=Lax; Path=/`. CSRF on POST via double-submit cookie. Brute-force lockout 5 failures per email or IP in 15 minutes.
- **Email**: Brevo only via `email.sendTransactionalEmail`. Templates used here: `email_verification`, `welcome`, `password_reset`, `magic_link`, `workspace_invitation`. Suppression honored. Send failures never break the originating flow — show a "delivery pending" banner instead.
- **SaaS fundamentals**: signup creates a default workspace named "<user>'s workspace" with the user as `customer_owner`. Invitation acceptance attaches the user as `customer_member` to the inviting workspace. Account deletion is initiated from `/app/settings/account/delete` (lives in `app_console.spec.md`); this domain only handles its initiation pre-confirmation step at sign-up.

## Component Insertion Points

- `src/domains/auth-flows/auth-flows.service.ts` — orchestration (signup, signin, verify, reset, magic-link, invite, signout)
- `src/domains/auth-flows/routes/sign-up-route.ts` — `GET /sign-up`, `POST /sign-up`
- `src/domains/auth-flows/routes/sign-in-route.ts` — `GET /sign-in`, `POST /sign-in`
- `src/domains/auth-flows/routes/sign-out-route.ts` — `POST /sign-out`
- `src/domains/auth-flows/routes/verify-email-route.ts` — `GET /verify-email`, `GET /verify-email/:token`, `POST /verify-email/resend`
- `src/domains/auth-flows/routes/forgot-password-route.ts` — `GET /forgot-password`, `POST /forgot-password`
- `src/domains/auth-flows/routes/reset-password-route.ts` — `GET /reset-password/:token`, `POST /reset-password/:token`
- `src/domains/auth-flows/routes/magic-link-route.ts` — `POST /magic-link/request`, `GET /magic-link/:token`
- `src/domains/auth-flows/routes/accept-invite-route.ts` — `GET /accept-invite/:token`, `POST /accept-invite/:token`
- `src/domains/auth-flows/components/auth-shell.ts` — shared auth-page shell (consumes design-system)
- `src/domains/auth-flows/components/csrf.ts` — CSRF token issuance/verification helpers
- `src/domains/auth-flows/components/rate-limit.ts` — brute-force lockout counters (in-memory + persistent floor)
- `src/domains/auth-flows/__tests__/`

## Public API Contract

- `signUp(input: SignUpInput): Promise<{ user: IdentityUser; workspace: IdentityWorkspace; pendingVerification: true }>`
- `signIn(input: SignInInput): Promise<{ user: IdentityUser; mfaRequired: true } | { user: IdentityUser; session: IssuedIdentitySession; mfaRequired: false }>`
- `signOut(sessionToken: string): Promise<void>`
- `requestEmailVerification(userId: string): Promise<{ dispatched: boolean }>`
- `verifyEmailToken(rawToken: string): Promise<{ user: IdentityUser; session: IdentitySession }>`
- `requestPasswordReset(emailAddress: string): Promise<{ dispatched: boolean }>` (always returns `dispatched: true` to prevent email enumeration; the actual send is guarded by rate-limit and suppression)
- `completePasswordReset(rawToken: string, newPassword: string): Promise<{ user: IdentityUser; session: IdentitySession }>`
- `requestMagicLink(emailAddress: string): Promise<{ dispatched: boolean }>` (always returns `dispatched: true` to prevent email enumeration)
- `consumeMagicLink(rawToken: string): Promise<{ user: IdentityUser; session: IdentitySession }>`
- `acceptInvitation(rawToken: string, signUpInput?: SignUpInput): Promise<{ user: IdentityUser; workspace: IdentityWorkspace; session: IdentitySession }>` — if the recipient is already registered, `signUpInput` is omitted; otherwise it carries password and display name
- `authFlowsRoute(input: AuthFlowsRouteInput): Promise<AuthFlowsRouteResponse>` — HTTP entry
- `renderAuthFlowsHtml(page: AuthFlowsPage): string` — HTML rendering helper used internally

## Endpoint Surface

- `GET /sign-up`, `POST /sign-up`
- `GET /sign-in`, `POST /sign-in`
- `POST /sign-out`
- `GET /verify-email`, `GET /verify-email/:token`, `POST /verify-email/resend`
- `GET /forgot-password`, `POST /forgot-password`
- `GET /reset-password/:token`, `POST /reset-password/:token`
- `POST /magic-link/request`, `GET /magic-link/:token`
- `GET /accept-invite/:token`, `POST /accept-invite/:token`
- `HEAD` / `OPTIONS` for each route

## Owned Invariants

### Signup
- Email must validate against RFC 5322 single-recipient shape and be normalized to lowercase before lookup or insertion.
- Email collision returns a deliberately non-enumerating response: the sign-up page shows the same "Check your email" outcome whether or not the address already exists; if it does, the existing user receives a "Someone tried to sign up with your email — sign in instead" message (template `email_verification` with `mode=collision`).
- Passwords MUST meet minimum strength: 12+ characters, contains at least one digit and one non-letter-non-digit, and not present in the bundled compromised-passwords list (HIBP top 100k). Failures return `AUTH_PASSWORD_WEAK`.
- Display name (optional) is trimmed and limited to 80 chars; rejected if it contains control characters.
- On successful signup: create user (unverified), create default workspace `"<display-name>'s workspace"`, attach user as `customer_owner`, issue email-verification token (24h, single-use), dispatch `email_verification` mail. The signup endpoint does NOT issue a session — verification is required first.
- Signup is rate-limited: 10/hour/IP and 3/hour/email.
- Persists `USER_SIGNED_UP` audit event with `outcome=success` (or `outcome=rate_limited` for blocks).

### Email Verification
- The verification page (`GET /verify-email`) shows a "Check your email" state with a resend link.
- `GET /verify-email/:token` consumes the token (single-use), marks the user verified, issues an `app_session`, dispatches `welcome`, and redirects to `/app` (or to the `next` param if it points to a safe `/app/*` path; otherwise `/app`).
- Expired or already-consumed tokens redirect to `/verify-email?status=expired` and offer a resend action.
- Verification resend is rate-limited: 3/hour/email, max one every 60 seconds; never reveals whether the email is registered.
- Persists `EMAIL_VERIFIED` audit event.

### Sign In
- `POST /sign-in` accepts `{ email, password }`. Password verification is constant-time via argon2id.
- On success: revoke any prior `app_session` for the same user/device (best-effort by user-agent match), create a new `IdentitySession`, set `app_session` cookie, redirect to `next` (validated to `/app/*` or `/`) or `/app`.
- On failure: increment per-email and per-IP counters; if either crosses 5 in 15 minutes, return `AUTH_LOCKED_OUT` with a 15-minute cooldown; never reveal whether the email is registered.
- If the user has not verified their email yet, sign-in fails closed with `AUTH_EMAIL_UNVERIFIED` and the page offers a resend-verification action.
- If the user has MFA enabled, sign-in returns `mfaRequired: true` and renders the TOTP challenge page; the `app_session` is not minted until the challenge passes (a short-lived `app_mfa_pending` cookie carries the pending state with 5-minute TTL).
- Persists `USER_SIGNED_IN` (success/failure) and `AUTH_LOCKOUT_TRIGGERED` events.

### Sign Out
- `POST /sign-out` revokes the current session (deletes the `IdentitySession` row), clears the `app_session` cookie, persists `USER_SIGNED_OUT`, and redirects to `/`.
- Demo sign-out is removed from production; the existing `/auth/demo/sign-out` remains development-gated.

### Password Reset
- `POST /forgot-password` accepts `{ email }`. Always returns `dispatched: true` to prevent email enumeration. Internally, if the address is registered and not suppressed, mint a reset token (1h, single-use) and dispatch `password_reset`.
- Rate-limited: 5/hour/email and 20/hour/IP.
- `GET /reset-password/:token` renders the reset form if the token validates; otherwise renders an "Invalid or expired link" view with a "Request a new link" CTA.
- `POST /reset-password/:token` accepts `{ password }`. Validates strength (same rules as signup), updates the password hash, consumes the token, revokes all existing sessions for the user (security best practice), issues a fresh `app_session`, persists `PASSWORD_RESET_COMPLETED`, redirects to `/app`.

### Magic Link Sign In
- `POST /magic-link/request` accepts `{ email }`. Always returns `dispatched: true`. Internally mints a magic-link token (15m, single-use) and dispatches `magic_link` if the address is registered. Rate-limited identically to password reset.
- `GET /magic-link/:token` consumes the token, issues a session, and redirects.
- Magic-link sign-in is allowed even for unverified accounts and acts as email verification: consuming a magic-link token also marks the user verified if they were not already (the link IS proof of email ownership).
- Persists `MAGIC_LINK_REQUESTED` and `MAGIC_LINK_CONSUMED` events.

### Invitation Acceptance
- `GET /accept-invite/:token` consumes nothing yet; it renders the acceptance UI showing inviter name, workspace name, and either "Sign in to accept" or "Create account to accept" depending on whether the email matches an existing user.
- `POST /accept-invite/:token`:
  - If the invitee already has an account, sign-in is required first (the route redirects to `/sign-in?next=/accept-invite/:token`); after signin, hitting this POST attaches them as `customer_member` to the inviting workspace.
  - If the invitee has no account, the body carries `{ password, displayName? }`; the route creates the user (already verified — the invitation IS proof of email ownership), attaches them to the workspace, mints a session, and redirects to `/app`.
- Invitation tokens are 7-day single-use. Used or expired tokens render "Invitation expired" and offer to request a new one from the inviter.
- Persists `INVITATION_ACCEPTED`.

### CSRF
- All `POST` routes in this domain validate a CSRF token issued at first GET of the auth page. Token is HMAC-bound to the session ID (for pre-session GETs, to a session-scoped temporary cookie set on the GET) and verified against the submitted `_csrf` form field or `x-csrf-token` header.
- CSRF token mismatch returns `AUTH_BAD_REQUEST` with `reason=csrf_mismatch`.

### Failure Surface
- Every form post renders the same auth shell with an inline `Banner` (tone `danger` for errors, `warn` for lockout, `info` for "check your email" success). Error copy is plain English (no codes leak to the user; codes only appear in the audit log).
- All redirect targets are validated against an allowlist: `/`, `/app`, `/app/*`, `/pricing`, `/docs/*`. Anything else collapses to `/app` after signin.
- The managed-auth provider bridge takes precedence when `IDENTITY_MANAGED_AUTH_MODE=header` is enabled; in that mode, this domain's routes return `404` (or redirect to the provider's hosted UI if `AUTH_PROVIDER_HOSTED_URL` is set) so the customer surface advertises a single auth path at a time.

### Demo Sign-In Removal
- The existing `/auth/demo/sign-in` and `/auth/demo/sign-out` routes are explicitly retained for `NODE_ENV=development` but the marketing site and app shell no longer advertise them. Public `/sign-up` and `/sign-in` always point to this domain's flows.

## Error Taxonomy

- `AUTH_BAD_REQUEST` — malformed input, CSRF mismatch
- `AUTH_PASSWORD_WEAK` — password fails strength rules
- `AUTH_EMAIL_INVALID` — RFC 5322 fail or domain reject
- `AUTH_EMAIL_UNVERIFIED` — sign-in attempt on unverified account
- `AUTH_INVALID_CREDENTIALS` — generic signin failure (no enumeration)
- `AUTH_TOKEN_INVALID` — verification/reset/magic-link/invite token unknown or expired
- `AUTH_LOCKED_OUT` — brute-force lockout window active
- `AUTH_MFA_REQUIRED` — sign-in needs MFA challenge to proceed
- `AUTH_MFA_FAILED` — MFA code mismatch
- `AUTH_PROVIDER_BRIDGE_ACTIVE` — managed-auth provider mode is on; first-party routes refused
- `AUTH_NOT_FOUND` — invite or reset for unknown user (only used internally; surface stays non-enumerating)

## Owned Invariants (input hardening)

- All exported service functions and route helpers fail closed on non-object runtime input or malformed string types with `AUTH_BAD_REQUEST`, mirroring the input-hardening pattern in `identity`, `customer_console`, and `billing_sync`.
- Path segments for `:token` parameters must reject path separators, traversal markers, and exact `.` at the route boundary.
- Email addresses are normalized to lowercased trim before any lookup or insertion. Mixed-case input never produces a duplicate row.
- `next` redirect targets and `plan` intent are validated against the allowlist in `marketing_site.spec.md` (`/app`, `/app/*`, `/pricing`, `/`); other values collapse to `/app`.

## Data Stores

Auth flows consumes `identity` persistence; it does not own its own tables. `identity` adds the following columns/models to support this domain:

- `IdentityUser` gains: `passwordHash?` (argon2id encoded), `emailVerifiedAt?`, `mfaSecretEncrypted?`, `mfaEnabledAt?`, `mfaRecoveryCodesHashed?` (JSON array of hashed codes).
- `IdentityCredentialToken` (new): `id`, `userId?` (nullable for invitation tokens pre-signup), `purpose` (`email_verification | password_reset | magic_link | invitation`), `tokenHash` (SHA-256 of the raw 32-byte secret), `metaJson` (e.g., invitation source workspace + role), `createdAt`, `expiresAt`, `consumedAt?`. Unique on `tokenHash`.
- `IdentityAuthEvent` (new): `id`, `eventType`, `userId?`, `workspaceId?`, `actorRole`, `clientIpHash`, `userAgent`, `outcome`, `reason?`, `recordedAt`.
- `IdentityAuthLockout` (new): `id`, `key` (lowercased email or IP), `keyKind` (`email | ip`), `failureCount`, `windowStart`, `lockedUntil?`.

In-memory rate-limit counters mirror the persistent lockout state for hot-path checks; persistent rows are the source of truth so multi-instance deployments cannot bypass lockout by hitting a different instance.

## Owned Invariants (privacy and audit)

- Auth events store `clientIpHash` (HMAC of client IP with a stable secret) instead of raw IP for GDPR alignment. Raw IPs are never persisted.
- The `userAgent` field is stored verbatim but capped at 256 chars and stripped of control characters.
- Audit events do NOT store passwords, tokens, or session token material — only hashed actor handles, event types, and outcomes.
- Suppression check (via `email.isSuppressed`) runs before any mail send; suppressed addresses produce a `dispatched: false` outcome internally while still returning the non-enumerating "dispatched: true" to the caller.

## SaaS Launch Baseline

- Production deployments must run with `EMAIL_PROVIDER=brevo`, `IDENTITY_MANAGED_AUTH_MODE` either unset or `header` (for enterprise SSO), and `AUTH_FIRST_PARTY=enabled` (the default).
- `/auth/demo/*` routes are gated to `NODE_ENV=development` and unreachable in staging/production.
- All token consumption operations are atomic: token consumption + session creation happens inside a single Prisma transaction so a token cannot be replayed if the session-creation step fails.
- Sign-in lockout counters are persistent (`IdentityAuthLockout`) so an attacker cannot bypass lockout by hopping instances.
- Password and credential-token storage is Argon2id / SHA-256 hashed at rest; credential-token plaintext only leaves the boundary in an email URL, and session bearer values only leave the identity boundary in the direct issuance result.
- `CSRF_SIGNING_KEY`, `IP_HASH_KEY`, and `MFA_ENCRYPTION_KEY` have centralized, clearly labelled development-only defaults. Outside development, each must be a distinct 32-byte hexadecimal key and configuration fails before the server listens if any key is missing, malformed, shared, or a development default.
- CSRF protection is enabled on every mutating POST; the customer JSON API (`/app-api/*`) shares the same CSRF infrastructure.
- The managed-auth provider bridge can disable this domain's first-party routes entirely via `IDENTITY_MANAGED_AUTH_MODE=header`; in that mode `/sign-in` and `/sign-up` either 404 or redirect to the provider's hosted pages.

## Dependency Direction

- May depend on `identity`, `email`, and `design_system`.
- Must not depend on `customer_console`, `app_console`, `billing_sync`, `control_plane`, or `admin_console`. Auth flows are upstream of those product surfaces.
