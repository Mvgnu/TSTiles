---
name: contracts
description: "Shared, stable cross-domain types and event payload contracts"
paths:
  types: src/contracts/types.ts
  service: src/contracts/contracts.ts
  components: src/contracts/events/
  tests: src/contracts/__tests__/
exports:
  - TileCoordinates
  - AuthorizeContext
  - ContractError
  - ContractErrorCode
  - DeliverySignal
  - ArtifactEvent
  - IngestEvent
  - AuthEvent
  - EmailDispatchRequestContract
  - EmailDispatchOutcome
  - NotificationEvent
  - QuotaThresholdEvent
  - OperatorAuditEvent
  - WorkspaceLifecycleEvent
consumes: []
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/contracts/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/contracts/"
status: ready
---

# Contracts Domain

Owns shared request, response, and event contracts used across domains to prevent circular dependencies.

## Cross-Cutting Pointer

Canonical: `specs/_cross_cutting.spec.md`. This domain is the type-only layer that lets `auth_flows`, `email`, `customer_console`, `app_console`, `metering`, `billing_sync`, `admin_console`, and `identity` interoperate without circular imports. New event contracts added for the launchable platform are listed in §New Event Contracts below.

## Component Insertion Points

- `src/contracts/types.ts`
- `src/contracts/events/delivery-signal.ts`
- `src/contracts/events/artifact-events.ts`
- `src/contracts/events/ingest-events.ts`
- `src/contracts/events/auth-events.ts`
- `src/contracts/events/email-dispatch.ts`
- `src/contracts/events/notification-events.ts`
- `src/contracts/events/quota-events.ts`
- `src/contracts/events/operator-audit-events.ts`
- `src/contracts/events/workspace-lifecycle-events.ts`
- `src/contracts/__tests__/contracts-compatibility.test.ts`

## Public API Contract

- Shared contracts must be backward-compatible under semantic versioning.
- Domain-specific behavior must not live in this domain.

## New Event Contracts (launchable platform)

The launchable platform introduces the following cross-domain payload contracts. All contracts are transport-safe (JSON-serializable), and identifiable PII is either hashed or omitted at the contract boundary.

### `AuthEvent` (auth_flows → identity → observability)

```ts
type AuthEventType =
  | "USER_SIGNED_UP" | "EMAIL_VERIFIED" | "USER_SIGNED_IN" | "USER_SIGNED_OUT"
  | "PASSWORD_RESET_REQUESTED" | "PASSWORD_RESET_COMPLETED"
  | "MAGIC_LINK_REQUESTED" | "MAGIC_LINK_CONSUMED"
  | "MFA_ENABLED" | "MFA_DISABLED" | "MFA_CHALLENGE_PASSED" | "MFA_CHALLENGE_FAILED"
  | "INVITATION_SENT" | "INVITATION_ACCEPTED" | "INVITATION_REVOKED"
  | "MEMBER_REMOVED" | "OWNERSHIP_TRANSFERRED"
  | "AUTH_LOCKOUT_TRIGGERED"
  | "ACCOUNT_DELETION_REQUESTED" | "ACCOUNT_DELETED"
  | "OPERATOR_SIGNED_IN" | "OPERATOR_SIGNED_OUT"
  | "OPERATOR_ROLE_GRANTED" | "OPERATOR_ROLE_REVOKED";

interface AuthEvent {
  eventId: string;        // cuid
  eventType: AuthEventType;
  userId?: string;
  workspaceId?: string;
  actorRole?: "customer_member" | "customer_owner" | "operator";
  clientIpHash?: string;  // HMAC of client IP (never raw)
  userAgent?: string;     // capped 256 chars, stripped of control chars
  outcome: "success" | "failure" | "rate_limited";
  reason?: string;        // short machine code (e.g. "invalid_credentials", "csrf_mismatch")
  recordedAt: string;     // ISO 8601
}
```

### `EmailDispatchRequestContract` and `EmailDispatchOutcome` (caller → email)

```ts
type EmailTemplateKey =
  | "email_verification" | "welcome" | "password_reset" | "magic_link"
  | "workspace_invitation" | "member_removed"
  | "billing_receipt" | "quota_approaching" | "quota_exceeded"
  | "key_rotated_receipt" | "abuse_warning" | "plan_change_confirmation"
  | "account_deletion_initiated" | "account_deletion_completed"
  | "data_export_ready";

interface EmailDispatchRequestContract {
  to: string;                            // RFC 5322 single-recipient, lowercased
  templateKey: EmailTemplateKey;
  params: Record<string, string | number | boolean>;
  idempotencyKey: string;                // 16-128 chars
  workspaceId?: string;
  userId?: string;
  replyTo?: string;
  tags?: string[];
}

interface EmailDispatchOutcome {
  dispatchId: string;
  status: "pending" | "sent" | "failed" | "suppressed";
  providerMessageId?: string;
  errorCode?: string;
  attemptCount: number;
}
```

### `NotificationEvent` (producer domain → customer_console → app_console)

```ts
type NotificationKind = "info" | "warn" | "danger";
type NotificationTopic =
  | "key_rotated" | "member_invited" | "member_joined" | "member_removed"
  | "quota_approaching" | "quota_exceeded"
  | "billing_receipt" | "plan_changed" | "payment_failed"
  | "workspace_suspended" | "workspace_unsuspended"
  | "abuse_warning"
  | "account_deletion_initiated" | "account_deletion_cancelled" | "account_deleted"
  | "data_export_ready";

interface NotificationEvent {
  eventId: string;
  workspaceId: string;
  userId?: string;                       // intended recipient (else: all workspace members)
  kind: NotificationKind;
  topic: NotificationTopic;
  title: string;                         // plain English, ≤ 80 chars
  body: string;                          // plain English, ≤ 280 chars, no HTML
  actionLabel?: string;                  // e.g. "Open billing portal"
  actionUrl?: string;                    // in-product, validated to /app/* or /pricing
  emailDispatched: boolean;              // whether a matching email was sent
  recordedAt: string;
}
```

### `QuotaThresholdEvent` (metering → customer_console → email)

```ts
interface QuotaThresholdEvent {
  eventId: string;
  workspaceId: string;
  planId: string;
  thresholdPercent: 80 | 100;
  usagePercent: number;                  // actual percent at firing time, ≥ thresholdPercent
  windowKind: "month";
  windowStart: string;                   // ISO 8601, monthly bucket start
  recordedAt: string;
}
```

Idempotency for downstream email dispatch is `(workspaceId, planId, windowStart, thresholdPercent)`.

### `OperatorAuditEvent` (admin_console / control_plane → identity → observability)

```ts
type OperatorActionType =
  | "INGEST_TRIGGERED" | "ARTIFACT_PROMOTED" | "ARTIFACT_ROLLBACK"
  | "STYLE_VERSION_CREATED" | "STYLE_VERSION_PUBLISHED"
  | "PROJECT_KEY_FORCE_ROTATED"
  | "WORKSPACE_SUSPENDED" | "WORKSPACE_UNSUSPENDED"
  | "ABUSE_WARNING_ISSUED"
  | "OPERATOR_ROLE_GRANTED" | "OPERATOR_ROLE_REVOKED"
  | "OPERATOR_VIEWED_PII";

interface OperatorAuditEvent {
  eventId: string;
  actionType: OperatorActionType;
  operatorUserId?: string;               // set when ops_session is used
  machineActorHash?: string;             // set when ADMIN_API_TOKEN is used
  targetKind: "project" | "workspace" | "artifact" | "style" | "user" | "platform";
  targetId: string;
  reason: string;                        // operator-provided, ≥ 8 chars, ≤ 280 chars
  outcome: "success" | "failure";
  errorCode?: string;
  recordedAt: string;
}
```

### `WorkspaceLifecycleEvent` (identity → all consumers)

```ts
type WorkspaceLifecycleType =
  | "WORKSPACE_CREATED" | "WORKSPACE_UPDATED"
  | "WORKSPACE_SUSPENDED" | "WORKSPACE_UNSUSPENDED"
  | "WORKSPACE_SOFT_DELETED" | "WORKSPACE_RESTORED" | "WORKSPACE_HARD_DELETED"
  | "OWNERSHIP_TRANSFERRED"
  | "MEMBER_ATTACHED" | "MEMBER_REMOVED";

interface WorkspaceLifecycleEvent {
  eventId: string;
  type: WorkspaceLifecycleType;
  workspaceId: string;
  userId?: string;
  byUserId?: string;
  recordedAt: string;
}
```

Consumers MUST treat unknown event types as forward-compatible (log + ignore) rather than fail-closed, except inside `identity` itself where the event is authoritative.

## Owned Invariants

- No runtime dependencies on business domains.
- Only transport-safe and serialization-safe types are exported.

## Error Taxonomy

- `CONTRACT_SCHEMA_INVALID`
- `CONTRACT_VERSION_UNSUPPORTED`

## Caching Semantics

- Not applicable for payload serving.

## Security and Privacy

- Shared types mark sensitive fields for redaction downstream.

## Data Stores

- None.

## Dependency Direction

- May depend on basic language/runtime libraries only.
- Must not depend on any `src/domains/*` module.
