---
name: config
description: "Runtime configuration loading, validation, and secret wiring"
paths:
  types: src/config/types.ts
  service: src/config/load-config.ts
  components: src/config/schema/
  tests: src/config/__tests__/
exports:
  - RuntimeConfig
  - SecurityConfig
  - TileDeliveryPolicy
  - ObservabilityConfig
  - loadConfig
consumes:
  - platform.environment
  - platform.worker_secrets
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/config/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/config/"
status: ready
---

# Config Domain

Owns strict configuration schemas, environment parsing, and fail-fast startup validation.

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain does not render UI but is the validation boundary for every new launch-blocking env var. The launchable platform adds the following required env-var blocks (each fail-fast if missing in production):

- **Email (Brevo)**: `EMAIL_PROVIDER` (`console | file:<path> | brevo`; must be `brevo` in production/staging), `BREVO_API_KEY`, `BREVO_WEBHOOK_SECRET`, `EMAIL_SENDER_ADDRESS`, `EMAIL_SENDER_NAME`, `EMAIL_REPLY_TO?`, and a `BREVO_TEMPLATE_ID_<KEY>` per closed-set template key.
- **First-party auth**: `AUTH_FIRST_PARTY` (`enabled | disabled`; default `enabled`), `AUTH_PROVIDER_HOSTED_URL?` (when `IDENTITY_MANAGED_AUTH_MODE=header`), `MFA_ENCRYPTION_KEY` (32-byte hex), `INITIAL_OPERATOR_EMAIL?` (consulted only at first boot).
- **Surfaces**: `OPS_SURFACE_ENABLED` (`true | false`; default `true`), `ADMIN_API_TOKEN` (`ADMIN_TOKEN` remains a legacy alias), `APP_PUBLIC_BASE_URL` (origin used to mint absolute URLs in emails — `https://app.<domain>`).
- **Security**: `SECURITY_CONTACT_EMAIL`, `CSRF_SIGNING_KEY` (32-byte hex; used to HMAC-sign double-submit cookies), `IP_HASH_KEY` (32-byte hex; used to HMAC client IPs for audit events).
- **Existing baselines retained**: `DATABASE_URL`, `OBJECT_STORE_MODE`, `IDENTITY_MANAGED_AUTH_MODE`, `OBSERVABILITY_LOG_SINK`, Stripe block (`STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_<PLAN>`, `STRIPE_WEBHOOK_SECRET`).

## Component Insertion Points

- `src/config/schema/runtime-schema.ts`
- `src/config/schema/security-schema.ts`
- `src/config/schema/observability-schema.ts`
- `src/config/load-config.ts`
- `src/config/__tests__/load-config.test.ts`

## Public API Contract

- `loadConfig(env: Record<string, string | undefined>): RuntimeConfig`
- Loaders return typed config or throw typed configuration errors.

## Owned Invariants

- All required config is validated at startup.
- Invalid config prevents service start.
- Outside development, `ADMIN_API_TOKEN` is at least 32 bytes; after input normalization, it and the 32-byte hexadecimal CSRF-signing, IP-hash, and MFA-encryption keys are pairwise distinct by underlying bytes. The admin token is compared as UTF-8 bytes and each scoped hexadecimal key is hex-decoded before comparison; no other transformation defines equality. Missing, malformed, shared, placeholder, or development-default values prevent startup before the HTTP listener is created. Development retains its existing policy: scoped keys remain distinct by decoded bytes, while the admin token may reuse one for local compatibility.
- The non-development generated-secret policy rejects four explicit forms of obvious weakness for the admin token and every scoped hexadecimal key: common placeholder markers, an exact block repeated across the full value, fewer than eight distinct case-insensitive characters, or a contiguous eight-character forward/reverse run from decimal digits, the alphabet, or the QWERTY key order. Placeholder matching covers compacted text such as `change-me`, `replace`, `example`, `password`, `admin-token`, `test-token`, and development/default variants; hexadecimal keys are checked both as hex text (including `deadbeef`-style markers) and as decoded bytes. These are pattern guards, not an entropy estimate.
- Development may use the named `DEVELOPMENT_ONLY_SECURITY_DEFAULTS`; those values are rejected outside development.
- Secret values are never exposed in plain-text logs.
- Tile delivery runtime knobs (`headEnabled`, cache TTLs, render timeout, render concurrency, renderer backend) are validated and centralized in config.
- Service-level safety knobs such as `GLOBAL_REQUEST_BUDGET_PER_MINUTE` are validated centrally in runtime config.
- Ingest source-size guardrail (`INGEST_MAX_SOURCE_BYTES`) is validated centrally to bound upstream download/read volume.
- Default object-store mode is environment-aware:
  - `development` -> `memory`
  - `staging`/`production` -> `filesystem`
- `OBJECT_STORE_MODE=filesystem` treats `OBJECT_STORE_BUCKET` as the local root directory for immutable PMTiles artifact writes on VPS-style deployments.
- `OBJECT_STORE_MODE=s3-compatible` remains supported for object storage deployments and is the only mode that requires access-key validation.

## Error Taxonomy

- `CONFIG_MISSING_REQUIRED`
- `CONFIG_INVALID_VALUE`
- `CONFIG_SECRET_UNAVAILABLE`

## Caching Semantics

- Static config is loaded once per process lifecycle.
- Hot-reload behavior is explicit and opt-in.

## Security and Privacy

- Secrets are read from platform secret stores only.
- Redaction helpers are provided for all config snapshots.

## Data Stores

- Environment variables and secret provider bindings.
- Database connection metadata for the Prisma client (`DATABASE_URL`) used by persistent domains (projects, metering, artifact, styles, billing-sync).

## SaaS Launch Baseline

- Production and staging deployments must boot with a non-empty `DATABASE_URL` pointing at the persistent Prisma datasource. Missing or malformed values fail fast at startup.
- `OBJECT_STORE_MODE=memory` is rejected outside `NODE_ENV=development`; SaaS deployments run with `filesystem` or `s3-compatible` only.
- Production deployments must declare `IDENTITY_MANAGED_AUTH_MODE=header` when the customer console is exposed publicly; otherwise the demo-bridge identity path remains disabled and `/auth/demo/*` routes refuse to serve.
- Stripe billing requires `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_<PLAN>` for each billable plan, and `STRIPE_WEBHOOK_SECRET` for verified webhook ingestion.
- Admin operations require `ADMIN_API_TOKEN`; the existing `ADMIN_TOKEN` name is accepted as a compatibility alias. Requests without a configured admin secret fail at startup outside development.
- Multi-instance SaaS deployments must configure `OBSERVABILITY_LOG_SINK` to `stdout` (or a mounted `file:<path>`) so delivery telemetry and SLO alerts aggregate across instances; `none` (the default in development) is acceptable only for local development.

## Dependency Direction

- May depend on runtime bindings and schema libraries.
- Must not depend on business domains.
