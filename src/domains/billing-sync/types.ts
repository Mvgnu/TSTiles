export type BillingPlanId = string;

export type BillingSubscriptionStatus =
  | "free"
  | "checkout_pending"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid";

export const enum BillingSyncErrorCode {
  BAD_REQUEST = "BILLING_SYNC_BAD_REQUEST",
  NOT_FOUND = "BILLING_SYNC_NOT_FOUND",
  CONFLICT = "BILLING_SYNC_CONFLICT",
}

export class BillingSyncError extends Error {
  public readonly code: BillingSyncErrorCode;
  public readonly details: string;

  public constructor(code: BillingSyncErrorCode, details: string) {
    super(`${code}:${details}`);
    this.code = code;
    this.details = details;
    this.name = "BillingSyncError";
  }
}

export interface BillingSnapshot {
  readonly workspaceId: string;
  readonly planId: BillingPlanId;
  readonly subscriptionStatus: BillingSubscriptionStatus;
  readonly billingEmail?: string;
  readonly stripeCustomerId?: string;
  readonly stripeSubscriptionId?: string;
  readonly currentPeriodEnd?: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly lastWebhookAt?: string;
}

export interface CheckoutSessionInput {
  readonly workspaceId: string;
  readonly planId: BillingPlanId;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface CheckoutSession {
  readonly workspaceId: string;
  readonly planId: BillingPlanId;
  readonly sessionId: string;
  readonly url: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface BillingPortalSessionInput {
  readonly workspaceId: string;
  readonly returnUrl: string;
}

export interface BillingPortalSession {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly url: string;
  readonly createdAt: string;
}

export type StripeWebhookEventType =
  | "checkout.session.completed"
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "invoice.paid"
  | "invoice.payment_failed";

export interface StripeWebhookEvent {
  readonly type: StripeWebhookEventType;
  // Stripe-assigned unique event id (`evt_...`); used for at-least-once
  // idempotency so duplicate webhook deliveries do not double-apply.
  readonly id?: string;
  readonly sessionId?: string;
  readonly workspaceId?: string;
  readonly stripeCustomerId?: string;
  readonly stripeSubscriptionId?: string;
  readonly planId?: BillingPlanId;
  readonly billingEmail?: string;
  readonly subscriptionStatus?: Exclude<BillingSubscriptionStatus, "free" | "checkout_pending">;
  readonly currentPeriodEnd?: string;
  readonly cancelAtPeriodEnd?: boolean;
  readonly occurredAt?: string;
  readonly amount?: string;
  readonly hostedInvoiceUrl?: string;
}
