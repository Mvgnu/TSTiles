---
name: email
description: "Transactional email dispatch via Brevo, suppression list, idempotent send log, and webhook ingestion for bounces/complaints"
paths:
  types: src/domains/email/types.ts
  service: src/domains/email/email.service.ts
  components: src/domains/email/
  tests: src/domains/email/__tests__/
exports:
  - EmailTemplateKey
  - EmailDispatchRequest
  - EmailDispatchResult
  - EmailDispatchStatus
  - EmailSuppressionReason
  - EmailError
  - EmailErrorCode
  - sendTransactionalEmail
  - listDispatches
  - isSuppressed
  - applyBrevoWebhookEvent
  - emailWebhookRoute
consumes:
  - config.EmailConfig
  - contracts.EmailDispatchRequest
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/email/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/email/"
status: ready

---

# Email Domain

Owns transactional mail dispatch. Every domain that needs to email a customer or operator routes through `sendTransactionalEmail`. Direct SMTP, raw HTML emails, per-domain mail clients, or third-party SDKs other than the Brevo HTTP API are forbidden.

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`. Subagents working only on this spec MUST treat the following as binding without reading other specs.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Dark parity uses the matching tokens. Inter sans + JetBrains Mono. Type scale 12/14/16/18/24/32/48. Spacing 4/8/12/16/24/32/48/64. Radii 4/8/12. One shadow token. Motion 120/200ms with `prefers-reduced-motion` honored. WCAG AA contrast, 2px focus ring, keyboard reachable. Voice: precise, calm, no emoji, no exclamation. Reuse only design-system primitives. Email HTML templates follow the same palette/typography rules; raw inline CSS is allowed inside Brevo templates because mail clients ignore `<style>` blocks.
- **Surfaces**: customer routes `/`, `/app`, `/app-api`, `/billing`, `/docs`, `/legal`, `/security`, `/status`, `/v1/*` use `app_session`. Operator routes `/admin/*` and `/ops/*` use `ops_session` (or `ADMIN_API_TOKEN` for automation on `/admin/*` only). Roles: `customer_member`, `customer_owner`, `operator` — one session is exactly one role. Webhook ingest endpoint `/webhooks/brevo` is unauthenticated by session but signature-verified.
- **Auth**: v1 is first-party email + password + email verification + magic link. Tokens 32-byte random hashed SHA-256 at rest, single-use; verification 24h, reset 1h, magic-link 15m, invitation 7d. The email domain never holds plaintext tokens — it only renders URLs assembled by the caller.
- **Email**: Brevo only. Send through `email.sendTransactionalEmail({ to, templateKey, params, idempotencyKey })`. Closed template set: `email_verification`, `welcome`, `password_reset`, `magic_link`, `workspace_invitation`, `member_removed`, `billing_receipt`, `quota_approaching`, `quota_exceeded`, `key_rotated_receipt`, `abuse_warning`, `plan_change_confirmation`, `account_deletion_initiated`, `account_deletion_completed`, `data_export_ready`. Suppression list honored. Send failures never break the originating flow.
- **SaaS fundamentals**: workspace owners can invite/remove/transfer/delete/export; members can rotate own keys and manage own MFA. Quota at 80% emits email + banner; at 100% emits email + banner + (eventually) hard cap. Billing is Stripe-managed; receipts mirrored via email. Account deletion is GDPR-aligned with a 30-day grace window.

## Component Insertion Points

- `src/domains/email/email.service.ts` — public service; dispatch + suppression + webhook
- `src/domains/email/providers/brevo-client.ts` — Brevo HTTP API client (fetch-based, no SDK)
- `src/domains/email/providers/console-sink.ts` — dev fallback writing to `OBSERVABILITY_LOG_SINK`
- `src/domains/email/providers/file-sink.ts` — NDJSON file sink for smoke tests
- `src/domains/email/templates/<template-key>.ts` — typed param schemas + Brevo template ID lookup
- `src/domains/email/routes/brevo-webhook-route.ts` — `POST /webhooks/brevo`
- `src/domains/email/__tests__/`

## Public API Contract

- `sendTransactionalEmail(input: EmailDispatchRequest): Promise<EmailDispatchResult>`
- `listDispatches(opts?: { workspaceId?: string; userId?: string; limit?: number }): Promise<EmailDispatchResult[]>`
- `isSuppressed(emailAddress: string): Promise<boolean>`
- `applyBrevoWebhookEvent(event: BrevoWebhookEvent): Promise<void>`
- `emailWebhookRoute(input): Promise<EmailWebhookRouteResponse>`

`EmailDispatchRequest` shape (validated at the boundary):

```ts
{
  to: string;                      // RFC 5322 single-recipient
  templateKey: EmailTemplateKey;   // closed union
  params: TemplateParams<typeof templateKey>;  // per-template typed
  idempotencyKey: string;          // 16-128 chars, base64url-safe
  workspaceId?: string;
  userId?: string;
  replyTo?: string;
  tags?: string[];                 // forwarded to Brevo for analytics
}
```

## Endpoint Surface

- `POST /webhooks/brevo` — Brevo bounce/complaint/click/open webhook ingest, signature-verified
- `HEAD` / `OPTIONS` for `/webhooks/brevo`

## Owned Invariants

- All sends require an `idempotencyKey`. Duplicate keys short-circuit to the existing `EmailDispatch` row and return the prior `EmailDispatchResult` without contacting the provider.
- Suppression check runs before any provider call. Suppressed recipients return `EmailDispatchResult.status = "suppressed"` with `errorCode = "EMAIL_SUPPRESSED"`; the caller-facing flow must not surface this as a hard failure.
- `templateKey` must be one of the closed set. Unknown keys fail closed with `EMAIL_TEMPLATE_UNKNOWN`.
- Template params are validated per-template at the boundary. Required params missing fail closed with `EMAIL_PARAMS_INVALID`.
- The email domain never assembles tokenized URLs from raw secrets — the caller passes the fully constructed URL string in `params`. The domain renders, it does not mint.
- Send failures are typed (`RETRYABLE_NETWORK`, `RETRYABLE_PROVIDER`, `PERMANENT_SUPPRESSED`, `PERMANENT_INVALID_ADDRESS`, `PERMANENT_TEMPLATE`, `PERMANENT_CONFIG`). Retryable errors trigger up to 3 backoff attempts (250ms, 1s, 4s jittered) before marking the dispatch `failed`.
- The dispatch row is created in `pending` status before the provider call; status is updated to `sent | failed | suppressed` after the call returns. A crash mid-send leaves a `pending` row that the housekeeping sweep can re-attempt or mark `failed_unknown` after a 5-minute boundary.
- Provider responses' `providerMessageId` is stored on the dispatch row when available.
- Brevo webhook ingestion at `POST /webhooks/brevo` is signature-verified via `BREVO_WEBHOOK_SECRET` (HMAC). Unverified or replay events return `401` and do not mutate state.
- Webhook events of type `hard_bounce | invalid_email | spam | complaint | unsubscribe` insert into `EmailSuppression` keyed by the lowercased email address. `soft_bounce`, `delivered`, `opened`, `click` are recorded against the dispatch row but do not suppress.
- The email domain never embeds raw access tokens, raw passwords, or unhashed secrets in mail bodies. Token URLs sent through email are produced by `auth_flows` or `billing_sync` and contain only the public single-use secret.
- Sender identity is verified by Brevo and configured via `EMAIL_SENDER_ADDRESS` + `EMAIL_SENDER_NAME`; misconfigured sender fails fast at startup.
- Subject lines are owned by the template; callers cannot override the subject from the dispatch boundary.
- Render output is HTML + a synthesized plain-text alternative. Both versions are sent.
- Exported send/suppression/webhook helpers fail closed on malformed non-object runtime input with `EMAIL_BAD_REQUEST` instead of leaking raw property-access failures from direct callers.
- Exported send helpers validate `to` against a single-recipient RFC 5322 pattern and reject array recipients, BCC/CC fields, and address lists. Multi-recipient sends are explicitly out of scope; mail to multiple users requires multiple dispatches.

## Error Taxonomy

- `EMAIL_BAD_REQUEST` — malformed input shape at the boundary
- `EMAIL_TEMPLATE_UNKNOWN` — unknown templateKey
- `EMAIL_PARAMS_INVALID` — template params missing or wrong type
- `EMAIL_PROVIDER_UNAVAILABLE` — provider call failed after retry budget
- `EMAIL_PROVIDER_CONFIG` — missing API key / sender / template ID
- `EMAIL_SUPPRESSED` — recipient is on suppression list (not a hard failure for the caller)
- `EMAIL_WEBHOOK_SIGNATURE_INVALID`
- `EMAIL_DISPATCH_CONFLICT` — idempotency key reused with a different recipient/template (treat as fail-fast)

## Data Stores

- Prisma `EmailDispatch` model:
  - `id` (cuid)
  - `idempotencyKey` (unique)
  - `to` (lowercased)
  - `templateKey`
  - `paramsJson` (validated, redaction applied — no raw tokens stored even though tokens never reach here)
  - `workspaceId?`, `userId?`
  - `status` (`pending | sent | failed | suppressed`)
  - `providerMessageId?`
  - `errorCode?`, `errorMessage?`
  - `attemptCount`
  - `createdAt`, `updatedAt`, `sentAt?`
- Prisma `EmailSuppression` model:
  - `id`
  - `emailAddress` (unique, lowercased)
  - `reason` (`hard_bounce | invalid_email | spam | complaint | unsubscribe | manual`)
  - `occurredAt`
  - `providerEventId?`
- Prisma `EmailWebhookEvent` model for at-least-once dedup:
  - `id`
  - `providerEventId` (unique)
  - `eventType`
  - `occurredAt`
  - `recordedAt`

Retention is bounded: `EmailDispatch` rows older than 180 days are eligible for amortized cleanup. `EmailSuppression` is retained indefinitely (suppression is permanent unless an operator manually clears it from `/ops/*`). `EmailWebhookEvent` rows older than 90 days are eligible for cleanup.

## Configuration

- `EMAIL_PROVIDER` — `console | file:<path> | brevo`; default `console` in development, must be `brevo` in staging/production.
- `BREVO_API_KEY` — required when `EMAIL_PROVIDER=brevo`.
- `BREVO_WEBHOOK_SECRET` — required when `EMAIL_PROVIDER=brevo`; HMAC secret for `/webhooks/brevo` signature verification.
- `EMAIL_SENDER_ADDRESS` — verified sender identity; required when `EMAIL_PROVIDER=brevo`.
- `EMAIL_SENDER_NAME` — display name; required.
- `EMAIL_REPLY_TO` — optional reply-to override (defaults to sender address).
- `BREVO_TEMPLATE_ID_<KEY>` — Brevo template ID per template key (e.g. `BREVO_TEMPLATE_ID_EMAIL_VERIFICATION`); required for each closed-set key when `EMAIL_PROVIDER=brevo`.

## SaaS Launch Baseline

- Production deployments must run with `EMAIL_PROVIDER=brevo` plus verified sender identity and template IDs for every closed-set template. Missing template IDs fail fast at startup.
- `EmailDispatch` rows are the system of record for "did we email user X about Y on date Z" for audit and support purposes; never reconstruct from logs.
- Send failures never break the originating user-facing flow. The caller (auth_flows, billing_sync, customer_console, control_plane, admin_console) treats a failed dispatch as "delivery pending or failed — surface a banner, do not abort the user flow".
- Webhook endpoint `/webhooks/brevo` accepts only Brevo-signed payloads in production. Failures to verify return `401` and never mutate state.
- The customer console surfaces "delivery pending" / "delivery failed" state in `/app/settings` (for verification emails) and inline at action sites (for invitation / reset / magic-link triggers).

## Dependency Direction

- May depend on `config` and `contracts`.
- Must not depend on `auth_flows`, `billing_sync`, `customer_console`, `control_plane`, `admin_console`, or other consumer domains. Email is a leaf service consumed by upstream domains.
