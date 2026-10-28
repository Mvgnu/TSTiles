export type EmailTemplateKey =
  | "email_verification"
  | "welcome"
  | "password_reset"
  | "magic_link"
  | "workspace_invitation"
  | "member_removed"
  | "billing_receipt"
  | "quota_approaching"
  | "quota_exceeded"
  | "key_rotated_receipt"
  | "abuse_warning"
  | "plan_change_confirmation"
  | "account_deletion_initiated"
  | "account_deletion_completed"
  | "data_export_ready";

export type EmailDispatchStatus = "pending" | "sent" | "failed" | "suppressed";

export type EmailSuppressionReason =
  | "hard_bounce"
  | "invalid_email"
  | "spam"
  | "complaint"
  | "unsubscribe"
  | "manual";

export const enum EmailErrorCode {
  BAD_REQUEST = "EMAIL_BAD_REQUEST",
  TEMPLATE_UNKNOWN = "EMAIL_TEMPLATE_UNKNOWN",
  PARAMS_INVALID = "EMAIL_PARAMS_INVALID",
  PROVIDER_UNAVAILABLE = "EMAIL_PROVIDER_UNAVAILABLE",
  PROVIDER_CONFIG = "EMAIL_PROVIDER_CONFIG",
  SUPPRESSED = "EMAIL_SUPPRESSED",
  WEBHOOK_SIGNATURE_INVALID = "EMAIL_WEBHOOK_SIGNATURE_INVALID",
  DISPATCH_CONFLICT = "EMAIL_DISPATCH_CONFLICT",
}

export class EmailError extends Error {
  public readonly code: EmailErrorCode;
  public readonly details?: string;

  public constructor(code: EmailErrorCode, message: string, details?: string) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "EmailError";
  }
}

export interface EmailDispatchRequest {
  readonly to: string;
  readonly templateKey: EmailTemplateKey;
  readonly params: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly workspaceId?: string;
  readonly userId?: string;
  readonly replyTo?: string;
  readonly tags?: readonly string[];
}

export interface EmailDispatchResult {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly to: string;
  readonly templateKey: EmailTemplateKey;
  readonly paramsJson: string;
  readonly workspaceId?: string | null;
  readonly userId?: string | null;
  readonly status: EmailDispatchStatus;
  readonly providerMessageId?: string | null;
  readonly errorCode?: EmailErrorCode | null;
  readonly errorMessage?: string | null;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sentAt?: string | null;
}

export interface BrevoWebhookEvent {
  readonly event: string;
  readonly email: string;
  readonly id?: number;
  readonly date?: string;
  readonly "message-id"?: string;
  readonly ts?: number;
  readonly reason?: string;
}

export interface EmailWebhookRouteRequest {
  readonly method: "POST" | "HEAD" | "OPTIONS";
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string | undefined>>;
}

export interface EmailWebhookRouteResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}
