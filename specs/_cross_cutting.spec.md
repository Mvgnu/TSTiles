---
name: _cross_cutting
description: "Single source of truth for design language, surface separation, real auth, email, and SaaS fundamentals — embedded by reference into every domain spec for subagent-blind correctness"
paths:
  reference_only: specs/_cross_cutting.spec.md
exports:
  - DesignLanguageTokens
  - SurfaceSeparationRules
  - RealAuthContract
  - EmailDispatchContract
  - SaaSFundamentalsContract
consumes: []
verification:
  spec_review: "Every UI/auth/email/admin-touching spec must embed a Cross-Cutting Mandates section that summarizes the rules below and links here. Spec audit checks that the embedded block is not stale relative to this file."
status: ready
---

# Cross-Cutting Mandates (Canonical)

This spec is the single source of truth for cross-cutting behavior that every domain must honor. Each domain spec embeds a **Cross-Cutting Mandates (Subagent-Blind Reference)** section that summarizes the relevant subset of this file, so a subagent working only on its own spec still has the launch-relevant context inline. When this canonical spec changes, every embedded reference must be updated in lockstep.

The repository ships under the **Løp (bubble-agent) pattern**: each subagent has hard write-gates on its domain. The rules below are binding for every subagent regardless of which domain they operate in.

---

## 1. Design Language (binding for all rendered UI)

The canonical visual surface is **light-default minimalist** — Linear/Stripe aesthetic. Dark mode is parity, not the primary. No glassmorphism, no neon, no brutalism, no military/cyberpunk evocative copy ("TARGET_ID", "CIPHER_KEY" and similar are removed). The product feels like calm developer infrastructure.

### 1.1 Color Tokens

Light mode (default):

| Token | Hex | Use |
| --- | --- | --- |
| `--bg` | `#FFFFFF` | Page background |
| `--surface` | `#FAFAFA` | Cards, sidebars, table headers |
| `--surface-2` | `#F4F4F5` | Subtle nested surfaces |
| `--border` | `#E5E5E5` | Default border |
| `--border-strong` | `#D4D4D8` | Emphasized border (inputs, dividers) |
| `--ink` | `#111111` | Primary text, headlines |
| `--ink-2` | `#374151` | Body text, secondary headlines |
| `--muted` | `#6B7280` | Metadata, timestamps, hints |
| `--accent` | `#4F46E5` | Primary CTA, links, focus ring, selected state |
| `--accent-hover` | `#4338CA` | Accent hover/active |
| `--accent-fg` | `#FFFFFF` | Foreground on accent-filled buttons |
| `--success` | `#16A34A` | Positive states, success banners |
| `--warn` | `#D97706` | Caution, quota approaching |
| `--danger` | `#DC2626` | Errors, destructive, quota exceeded |
| `--code-bg` | `#F4F4F5` | Code block background |

Dark mode parity:

| Token | Hex |
| --- | --- |
| `--bg` | `#0B0B0C` |
| `--surface` | `#141416` |
| `--surface-2` | `#1A1A1D` |
| `--border` | `#1F1F23` |
| `--border-strong` | `#2A2A30` |
| `--ink` | `#F2F2F2` |
| `--ink-2` | `#D4D4D8` |
| `--muted` | `#A1A1AA` |
| `--accent` | `#6366F1` |
| `--accent-hover` | `#7C7AF7` |
| `--accent-fg` | `#FFFFFF` |
| `--success` | `#22C55E` |
| `--warn` | `#F59E0B` |
| `--danger` | `#EF4444` |
| `--code-bg` | `#141416` |

Rules:
- Surface code (marketing, app, docs, admin, auth pages, studio, in-process HTML responses) MUST consume these tokens via the design-system primitives and never inline raw hex outside `src/domains/design-system/`.
- The `prefers-color-scheme` media query toggles light/dark token sets at the CSS layer — domains do not branch.
- Accent is used sparingly: primary CTAs, links, selected nav, focus ring. Do not use accent as a decorative wash.

### 1.2 Typography

- **Sans (UI + copy)**: Inter. Fallback stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`.
- **Mono (code, endpoints, tokens, IDs)**: JetBrains Mono. Fallback stack: `"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace`.
- Scale (px): 12, 14, 16, 18, 24, 32, 48. Line-height: 1.5 for body, 1.2 for headlines.
- Weight: 400 (body), 500 (medium emphasis), 600 (headlines, buttons), 700 (rare).
- One `<h1>` per view. Sentence case for buttons, headlines, and nav labels. Mono labels for endpoint paths, plan IDs, API key IDs, and token-shaped identifiers.

### 1.3 Spacing, Radii, Elevation, Motion

- Spacing scale (px): `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`. Components default to 16/24 padding; tight clusters use 8/12.
- Radii: `4` (inputs, badges), `8` (buttons, cards, banners), `12` (modals, large panels).
- Shadows — **exactly one elevation token**: `0 1px 2px rgba(0,0,0,0.04), 0 1px 1px rgba(0,0,0,0.06)`. No multi-layer drop shadows, no neon glows.
- Motion: 120ms (micro, hover/focus transitions) and 200ms (macro, modal open, drawer slide). Always respect `prefers-reduced-motion: reduce` — under that media query, transitions collapse to 0ms.

### 1.4 Accessibility (binding)

- WCAG 2.1 AA contrast minimum on every text/background pair shipping in product.
- 2px visible focus ring (`--accent` on light, lightened accent on dark) on `:focus-visible`.
- All interactive elements keyboard-reachable; tab order matches DOM order; no keyboard traps.
- Icon-only buttons require `aria-label`; decorative icons get `aria-hidden="true"`.
- Forms: every input has a visible `<label>` (no placeholder-as-label); error messaging is `aria-describedby`-linked to the input.
- Modals: focus trapped, ESC closes, focus restored on close; backdrop click closes only if the modal is non-destructive.
- Skip-to-content link on every navigable shell page.

### 1.5 Voice and Copy

- Precise, technical, calm. No marketing puff. No exclamation marks. No emoji. No metaphor ("rocket-fast", "ninja", "magical").
- Sentence case for buttons, headlines, nav labels. Lowercase nouns are fine in mono labels (`access_token`, `style_id`).
- Action verbs first: "Create project", "Rotate key", "Open billing portal".
- Errors are plain and recoverable: "We couldn't verify your email. Resend the link or sign in to try again."

### 1.6 Component Primitives (design-system-owned)

Every domain that renders UI consumes these primitives only. The list is closed without a design-system change:

- `Button` (variants: `primary`, `secondary`, `ghost`, `danger`)
- `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`
- `Card`, `Banner` (tones: `info`, `success`, `warn`, `danger`)
- `Badge` (tones: `neutral`, `accent`, `success`, `warn`, `danger`)
- `CodeBlock` (with copy action, query-token / header-token toggle)
- `CopyRow` (inline labeled value with copy action)
- `KeyReveal` (one-time secret reveal card with explicit warning)
- `Modal`, `Drawer`, `Toast`
- `Table` (with sort affordance and empty-state slot)
- `Tabs`, `Sidebar`, `TopNav`, `Breadcrumbs`
- `EmptyState` (always ends with a next action)
- `MapPreview` (live MapLibre canvas with token-aware style URL)
- `StatGrid`, `UsageMeter`, `PlanCard`

Domains MUST NOT author one-off primitives. New primitives belong inside `src/domains/design-system/` and require a design-system spec update.

---

## 2. Surface Separation (binding for all routing/auth code)

The product ships two distinct surfaces. They share infrastructure but never share session state, never share UI shells, and never share data scope.

### 2.1 Customer Surface

Routes:
- Public: `/`, `/pricing`, `/legal/*`, `/security`, `/status`, `/sign-in`, `/sign-up`, `/verify-email`, `/verify-email/:token`, `/forgot-password`, `/reset-password/:token`, `/magic-link/:token`, `/accept-invite/:token`, `/docs/*`
- Authenticated: `/app`, `/app/projects/*`, `/app/styles/*`, `/app/billing`, `/app/settings`, `/app/settings/security/*`, `/app/settings/account/*`, `/app/notifications`
- Customer JSON: `/app-api/*`
- Billing actions: `/billing/checkout`, `/billing/portal`
- Webhook ingest (no session): `/webhooks/stripe`, `/webhooks/brevo`
- Delivery (token-auth, no session): `/v1/*`

Constraints:
- Customer surface never accepts the `ADMIN_API_TOKEN` and never serves operator data.
- `app_session` cookie scope only; `ops_session` is rejected if presented to a customer route.
- Customer pages always render through the customer shell defined in `app_console.spec.md` (or marketing shell for public routes).

### 2.2 Operator Surface

Routes:
- HTTP API: `/admin/*` (existing, see `control_plane.spec.md`)
- HTML console: `/ops/*` (new, see `admin_console.spec.md`)
- Operator-only auth: `/ops/sign-in`, `/ops/sign-out`

Constraints:
- Operator surface never accepts `app_session` and never serves customer-only data.
- `/admin/*` accepts both `ADMIN_API_TOKEN` (machine actor) and `ops_session` cookies (human actor with `operator` role). Both flows produce a hashed actor handle in audit events; raw token material never leaves the auth boundary.
- `/ops/*` only accepts `ops_session` and rejects raw tokens — this is a human-facing surface.
- In production, deployers MAY restrict `/ops/*` and `/admin/*` to a private network or reverse-proxy ACL on top of session/token auth. Path-split is the v1 default; host-split (`admin.<domain>`) is supported but not required.

### 2.3 Role Taxonomy

Identity carries exactly one role per session:
- `customer_member` — workspace member; can manage own keys, view own usage, MFA, leave workspace.
- `customer_owner` — workspace member with elevated workspace controls; can invite/remove members, transfer ownership, delete workspace, export data, view billing.
- `operator` — platform operator; can access `/admin/*` and `/ops/*`. Operators may also hold customer sessions in a separate browser profile, but a single session is exactly one role.

A user can be granted `operator` only by another operator (or seeded `INITIAL_OPERATOR_EMAIL` at first boot). Customer signup never auto-grants `operator`.

### 2.4 Demo Bypass

- `/auth/demo/*` routes remain gated to `NODE_ENV=development` and fail closed in staging/production.
- `OBJECT_STORE_MODE=memory` remains development-only and is fail-fast rejected outside development (see `config.spec.md`).

---

## 3. Real Authentication (binding for all auth/session code)

The v1 launch surface ships **first-party email + password + email verification** as the primary auth model. Magic-link sign-in is supported as an alternative. The managed-auth provider header bridge (`IDENTITY_MANAGED_AUTH_MODE=header`) remains available for the enterprise SSO path but is no longer the default.

### 3.1 Credential Storage

- Passwords: argon2id at rest (memory 19 MiB, iterations 2, parallelism 1, salt 16 bytes random per password). The password column stores the encoded argon2id string only. Never log, echo, or surface raw password material.
- Verification, reset, invitation, magic-link tokens: 32-byte cryptographic random, base64url-encoded, stored as SHA-256 hash at rest. Display value goes only to the user via email link; the database never holds the plaintext token.
- MFA secret: TOTP shared secret, AES-GCM encrypted at rest using `MFA_ENCRYPTION_KEY`. Recovery codes hashed (argon2id) the same way passwords are. Outside development, startup requires distinct 32-byte hexadecimal values for MFA encryption, CSRF signing, and IP hashing; development-only defaults are rejected before the server listens.

### 3.2 Token Lifetimes

| Token | Lifetime | Single-use |
| --- | --- | --- |
| Email verification | 24 hours | Yes |
| Password reset | 1 hour | Yes |
| Magic-link sign-in | 15 minutes | Yes |
| Workspace invitation | 7 days | Yes |
| Session (cookie) | 30 days sliding, hard cap 90 days | Reusable until revoked |

### 3.3 Session Cookies

- `app_session`: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`. Backed by `IdentitySession` row.
- `ops_session`: same flags, scope `Path=/`. Issued only by the operator sign-in flow.
- Customer route handlers reject `ops_session`; operator route handlers reject `app_session`.

### 3.4 CSRF and Brute-Force

- Mutating POST endpoints on `/app/*` and `/ops/*` validate a CSRF token (double-submit cookie pattern) issued at session start. Customer JSON API (`/app-api/*`) is `SameSite=Lax`-protected for browser callers and may additionally accept a custom header `x-csrf-token` for SPA-style clients.
- Sign-in failures: 5 within 15 minutes per email or per IP triggers a 15-minute cooldown for both that email and that IP. Cooldown is audit-logged as `AUTH_LOCKOUT_TRIGGERED`. Cooldown clears on successful sign-in from a different IP or after the window elapses.
- Sign-up rate-limited per IP (10 per hour) and per email (3 per hour). Verification-resend rate-limited per email (3 per hour, no more than 1 per 60 seconds).

### 3.5 Audit Events (auth domain)

Auth emits typed audit events to the persistent identity audit log. Required event types:
`USER_SIGNED_UP`, `EMAIL_VERIFIED`, `USER_SIGNED_IN`, `USER_SIGNED_OUT`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `MAGIC_LINK_REQUESTED`, `MAGIC_LINK_CONSUMED`, `MFA_ENABLED`, `MFA_DISABLED`, `MFA_CHALLENGE_PASSED`, `MFA_CHALLENGE_FAILED`, `INVITATION_SENT`, `INVITATION_ACCEPTED`, `INVITATION_REVOKED`, `MEMBER_REMOVED`, `OWNERSHIP_TRANSFERRED`, `AUTH_LOCKOUT_TRIGGERED`, `ACCOUNT_DELETION_REQUESTED`, `ACCOUNT_DELETED`, `OPERATOR_SIGNED_IN`, `OPERATOR_SIGNED_OUT`.

Each event row stores: `eventId`, `eventType`, `userId?`, `workspaceId?`, `actorRole`, `clientIpHash`, `userAgent`, `outcome` (`success | failure | rate_limited`), `reason?`, `recordedAt`.

---

## 4. Email Infrastructure (binding for all transactional notifications)

The platform sends mail through **Brevo** (Sendinblue) only. Direct SMTP, per-domain mail clients, or raw HTML emails from outside the email domain are forbidden.

### 4.1 Provider

- Configuration: `EMAIL_PROVIDER` (`console | file:<path> | brevo`), `BREVO_API_KEY`, `EMAIL_SENDER_ADDRESS`, `EMAIL_SENDER_NAME`, `EMAIL_REPLY_TO` (optional).
- `EMAIL_PROVIDER=console` is the development default; sends serialize to `OBSERVABILITY_LOG_SINK` instead of going to the network.
- `EMAIL_PROVIDER=file:<path>` writes one NDJSON record per send to the given path — useful for smoke tests.
- `EMAIL_PROVIDER=brevo` requires `BREVO_API_KEY` and a verified sender identity; missing config fails fast at startup.

### 4.2 Templates (closed set; new templates require an `email.spec.md` update)

| Template key | Trigger | Required params |
| --- | --- | --- |
| `email_verification` | Signup, email change | `verifyUrl`, `recipientName?` |
| `welcome` | First successful verification | `appUrl`, `quickstartUrl` |
| `password_reset` | Reset requested | `resetUrl`, `expiresAt` |
| `magic_link` | Magic-link sign-in requested | `signInUrl`, `expiresAt` |
| `workspace_invitation` | Owner invites a member | `inviterName`, `workspaceName`, `acceptUrl`, `expiresAt` |
| `member_removed` | Member removed from workspace | `workspaceName`, `removedAt` |
| `billing_receipt` | Stripe `invoice.paid` webhook | `amount`, `currency`, `invoiceUrl`, `periodStart`, `periodEnd` |
| `quota_approaching` | Usage crosses 80% of monthly allowance | `usagePercent`, `planName`, `billingUrl` |
| `quota_exceeded` | Usage crosses 100% | `planName`, `billingUrl` |
| `key_rotated_receipt` | Workspace member rotates a project key | `projectName`, `keyIdHash`, `rotatedAt` |
| `abuse_warning` | Operator-issued abuse warning | `subject`, `body`, `appealUrl` |
| `plan_change_confirmation` | Stripe subscription updated | `oldPlan`, `newPlan`, `effectiveAt` |
| `account_deletion_initiated` | Account deletion requested | `purgeAt`, `cancelUrl` |
| `account_deletion_completed` | Grace window elapsed and purge ran | `deletedAt` |
| `data_export_ready` | Workspace export job finished | `downloadUrl`, `expiresAt` |

### 4.3 Idempotency and Suppression

- Every send requires an `idempotencyKey`. Duplicate keys short-circuit to the prior dispatch row.
- Suppression list (built from Brevo webhook events `hard_bounce`, `spam`, `unsubscribe`) is checked before any send. Suppressed recipients fail closed with `EMAIL_SUPPRESSED`; the originating flow surfaces a non-blocking banner ("We couldn't reach your email address — update it in settings or contact support").
- Brevo webhook ingestion at `POST /webhooks/brevo` is signature-verified; bounce/complaint events insert into `EmailSuppression`.

### 4.4 Failure Handling

- Send failures are typed: `RETRYABLE_NETWORK`, `RETRYABLE_PROVIDER`, `PERMANENT_SUPPRESSED`, `PERMANENT_INVALID_ADDRESS`, `PERMANENT_TEMPLATE`, `PERMANENT_CONFIG`. Retryable errors trigger up to 3 backoff attempts; permanent errors mark the dispatch row `failed` and never break the originating flow.
- The user-facing flow that requested the send never fails because of mail trouble. Banners surface "delivery pending" or "delivery failed" states without blocking the operation.

---

## 5. SaaS Fundamentals (binding cross-domain)

### 5.1 Workspace Lifecycle

- A new user signup creates one default workspace named "<user-display-name>'s workspace" with the user as `customer_owner`.
- Owners can invite members by email (sends `workspace_invitation`); invitees accept by clicking the invite link, which routes them through signup or signin and then attaches them as `customer_member`.
- Owners can transfer ownership (audit-logged) or delete the workspace (soft-delete + 30-day grace window; `account_deletion_initiated` email sent; data purge after grace).
- Workspace data export at `/app/settings/account/export` produces a downloadable JSON bundle (projects, usage, styles, audit log) and emails `data_export_ready` with a signed URL.

### 5.2 Member Capabilities

| Capability | `customer_member` | `customer_owner` | `operator` |
| --- | --- | --- | --- |
| View workspace | Yes | Yes | No (operator views via `/ops/*` only) |
| Create / update / delete project | Yes | Yes | No |
| Rotate own project key | Yes | Yes | No |
| View own usage | Yes | Yes | No |
| View workspace billing | No | Yes | No |
| Open Stripe Portal | No | Yes | No |
| Invite member | No | Yes | No |
| Remove member | No | Yes | No |
| Transfer ownership | No | Yes | No |
| Delete workspace | No | Yes | No |
| Export workspace data | No | Yes | No |
| Manage own MFA | Yes | Yes | Yes |
| Leave workspace | Yes (must not be last owner) | Yes (after transfer) | n/a |
| Access `/admin/*` and `/ops/*` | No | No | Yes |

### 5.3 Quota / Billing Touchpoints

- `metering` emits a `QUOTA_APPROACHING` event at 80% of monthly allowance and a `QUOTA_EXCEEDED` event at 100%. Both trigger one email per workspace per window (deduped via idempotency key `(workspaceId, planId, window, threshold)`) and a banner that persists in the app shell until the window rolls over or the user acknowledges.
- `billing_sync` Stripe webhook `invoice.paid` triggers `billing_receipt`; `customer.subscription.updated` (plan change) triggers `plan_change_confirmation`; `invoice.payment_failed` triggers a banner + `quota_exceeded`-tier notice (no separate email, the next dunning attempt is Stripe-driven).
- Billing receipts originate from Stripe; we mirror, not recompute. Billing email comes from the workspace `billing_email`, which defaults to the owner's account email but can be overridden in settings.

### 5.4 Notifications

- In-app notification surface at `/app/notifications` shows the last 90 days of workspace-scoped events (key rotations, quota warnings, invitations, billing events). Notifications are typed (`info | warn | danger`) and have a primary action link.
- Email and in-app are produced from the same source-of-truth event stream so they never drift.

### 5.5 Account Deletion (GDPR)

- Customer-initiated at `/app/settings/account/delete`. Confirmation modal requires typing the user's email to confirm.
- Triggers `account_deletion_initiated` email with a 30-day undo link. During the grace window the account is soft-deleted (sessions revoked, sign-in disabled) but data is retained.
- After the grace window, a purge job removes identity rows, sessions, MFA secrets, and audit-event PII (event types and timestamps are retained, identifiable fields are nulled). Sends `account_deletion_completed`.
- If the user is the sole owner of a workspace, deletion is blocked until they transfer ownership or delete the workspace.

### 5.6 Operator Touchpoints

- `/ops/*` exposes: dataset ingest controls, artifact promote/rollback, styles publish, customer project lookup (read-only), audit log search, job log search, abuse warning issuance (`abuse_warning` email), operator user management.
- Operator audit events are always attributable to a specific operator user (not a shared token actor). The legacy `ADMIN_API_TOKEN` continues to work for automation but produces an `actor` of `machine:<hashed_token>` rather than a human handle.

---

## 6. Dependency Direction and Ownership

- `_cross_cutting` is reference-only and exports no code.
- `design-system` exports the visual primitives and tokens; every UI-rendering domain consumes design-system.
- `email` exports the transactional send service; every domain that triggers transactional mail consumes email.
- `identity` owns persistent user, workspace, membership, session, and credential storage.
- `auth_flows` owns the customer-facing signup/signin/verify/reset/invite/magic-link routes; consumes `identity` and `email`.
- `admin_console` owns the operator HTML console at `/ops/*`; consumes `identity` (with `operator` role enforcement) and `control_plane`.

---

## 7. Subagent-Blind Embed Block

Every UI/auth/email/admin-touching spec embeds the block below near the top. The block is a short, stable summary — when this canonical spec evolves, the embedded block in each spec must be regenerated. Subagents only reading their own spec MUST treat this embed as binding.

```markdown
## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`. Subagents working only on this spec MUST treat the following as binding without reading other specs.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Dark parity uses the matching tokens. Inter sans + JetBrains Mono. Type scale 12/14/16/18/24/32/48. Spacing 4/8/12/16/24/32/48/64. Radii 4/8/12. One shadow token. Motion 120/200ms with `prefers-reduced-motion` honored. WCAG AA contrast, 2px focus ring, keyboard reachable. Voice: precise, calm, no emoji, no exclamation. Reuse only design-system primitives.
- **Surfaces**: customer routes `/`, `/app`, `/app-api`, `/billing`, `/docs`, `/legal`, `/security`, `/status`, `/v1/*` use `app_session`. Operator routes `/admin/*` and `/ops/*` use `ops_session` (or `ADMIN_API_TOKEN` for automation on `/admin/*` only). Roles: `customer_member`, `customer_owner`, `operator` — one session is exactly one role.
- **Auth**: v1 is first-party email + password + email verification + magic link. Managed-auth header bridge stays available for enterprise SSO. Passwords argon2id; tokens 32-byte random hashed SHA-256 at rest, single-use; verification 24h, reset 1h, magic-link 15m, invitation 7d. Session cookies `HttpOnly; Secure; SameSite=Lax`. CSRF on POST. Brute-force lockout 5/15min.
- **Email**: Brevo only. Send through `email.sendTransactionalEmail({ to, templateKey, params, idempotencyKey })`. Closed template set: `email_verification`, `welcome`, `password_reset`, `magic_link`, `workspace_invitation`, `member_removed`, `billing_receipt`, `quota_approaching`, `quota_exceeded`, `key_rotated_receipt`, `abuse_warning`, `plan_change_confirmation`, `account_deletion_initiated`, `account_deletion_completed`, `data_export_ready`. Suppression list honored. Send failures never break the originating flow.
- **SaaS fundamentals**: workspace owners can invite/remove/transfer/delete/export; members can rotate own keys and manage own MFA. Quota at 80% emits email + banner; at 100% emits email + banner + (eventually) hard cap. Billing is Stripe-managed; receipts mirrored via email. Account deletion is GDPR-aligned with a 30-day grace window. Operators act through `/ops/*` with attributable audit events.
```
