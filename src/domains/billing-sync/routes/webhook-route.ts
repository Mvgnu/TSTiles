import { createHmac, timingSafeEqual } from "node:crypto";
import { listBillingPlans } from "../../metering/metering.service";
import { applyStripeWebhookEvent } from "../billing-sync.service";
import { BillingSyncError, BillingSyncErrorCode, type BillingSubscriptionStatus, type StripeWebhookEvent } from "../types";
import {
  billingErrorResponse,
  billingJsonResponse,
  billingOptionsResponseWithHeaders,
  type BillingRouteMethod,
  type BillingRouteResponse,
} from "./response";

interface WebhookRouteRequest {
  readonly method: BillingRouteMethod;
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string | undefined>>;
}

interface StripeEnvelope {
  readonly type: string;
  readonly data: {
    readonly object: unknown;
  };
}

function buildError(code: BillingSyncErrorCode, details: string): BillingSyncError {
  return new BillingSyncError(code, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHeaders(
  value: unknown,
): Readonly<Record<string, string | undefined>> | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }
  const entries: Array<[string, string | undefined]> = [];
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string" && headerValue !== undefined) {
      return null;
    }
    entries.push([key, headerValue]);
  }
  return Object.fromEntries(entries);
}

function normalizeRequest(input: unknown): WebhookRouteRequest | null {
  if (!isRecord(input)) {
    return null;
  }
  if (typeof input.method !== "string" || typeof input.path !== "string") {
    return null;
  }
  const headers = normalizeHeaders(input.headers);
  if (headers === null) {
    return null;
  }
  return {
    method: input.method as BillingRouteMethod,
    path: input.path,
    body: input.body,
    headers,
  };
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function priceEnvName(planId: string): string {
  return `STRIPE_PRICE_ID_${planId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function getOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getOptionalBoolean(record: Record<string, unknown>, field: string): boolean | undefined {
  const value = record[field];
  return typeof value === "boolean" ? value : undefined;
}

function getOptionalNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getOptionalRecord(record: Record<string, unknown>, field: string): Record<string, unknown> | undefined {
  const value = record[field];
  return isRecord(value) ? value : undefined;
}

function readHeader(
  headers: Readonly<Record<string, string | undefined>> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const direct = headers[name];
  if (typeof direct === "string") {
    return direct;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function unixSecondsToIso(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "stripe webhook timestamp must be a positive unix timestamp");
  }
  return new Date(value * 1000).toISOString();
}

function mapStripeStatus(status: string | undefined): Exclude<BillingSubscriptionStatus, "free" | "checkout_pending"> | undefined {
  if (!status) {
    return undefined;
  }
  if (status === "trialing" || status === "active" || status === "past_due" || status === "canceled" || status === "unpaid") {
    return status;
  }
  return undefined;
}

function configuredPlanIdForPriceId(priceId: string | undefined): string | undefined {
  if (!priceId) {
    return undefined;
  }
  for (const plan of listBillingPlans()) {
    const configuredPriceId = readEnv(priceEnvName(plan.planId));
    if (configuredPriceId === priceId) {
      return plan.planId;
    }
  }
  return undefined;
}

function firstPriceIdFromLines(record: Record<string, unknown>): string | undefined {
  const lines = getOptionalRecord(record, "lines") ?? getOptionalRecord(record, "items");
  const data = lines?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return undefined;
  }
  const first = data[0];
  if (!isRecord(first)) {
    return undefined;
  }
  const price = getOptionalRecord(first, "price");
  return price ? getOptionalString(price, "id") : undefined;
}

function firstPeriodEndFromLines(record: Record<string, unknown>): string | undefined {
  const lines = getOptionalRecord(record, "lines") ?? getOptionalRecord(record, "items");
  const data = lines?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return undefined;
  }
  const first = data[0];
  if (!isRecord(first)) {
    return undefined;
  }
  const period = getOptionalRecord(first, "period");
  return unixSecondsToIso(getOptionalNumber(period ?? {}, "end"));
}

function normalizeStripeWebhookEnvelope(payload: unknown): StripeWebhookEvent {
  if (!isRecord(payload)) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "stripe webhook payload must be an object");
  }
  if (!("data" in payload)) {
    const type = getOptionalString(payload, "type");
    if (!type) {
      throw buildError(BillingSyncErrorCode.BAD_REQUEST, "stripe webhook type is required");
    }
    return {
      type: type as StripeWebhookEvent["type"],
      id: getOptionalString(payload, "id"),
      sessionId: getOptionalString(payload, "sessionId"),
      workspaceId: getOptionalString(payload, "workspaceId"),
      stripeCustomerId: getOptionalString(payload, "stripeCustomerId"),
      stripeSubscriptionId: getOptionalString(payload, "stripeSubscriptionId"),
      planId: getOptionalString(payload, "planId"),
      billingEmail: getOptionalString(payload, "billingEmail"),
      subscriptionStatus: mapStripeStatus(getOptionalString(payload, "subscriptionStatus")),
      currentPeriodEnd: getOptionalString(payload, "currentPeriodEnd"),
      cancelAtPeriodEnd: getOptionalBoolean(payload, "cancelAtPeriodEnd"),
      occurredAt: getOptionalString(payload, "occurredAt"),
    };
  }

  const envelopeType = getOptionalString(payload, "type");
  const envelopeData = getOptionalRecord(payload, "data");
  if (!envelopeType) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "stripe webhook type is required");
  }
  if (!envelopeData || !("object" in envelopeData)) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "stripe webhook data.object is required");
  }
  const envelope: StripeEnvelope = {
    type: envelopeType,
    data: {
      object: envelopeData.object,
    },
  };
  const object = envelope.data.object;
  if (!isRecord(object)) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "stripe webhook data.object must be an object");
  }

  const eventId = getOptionalString(payload, "id");
  const metadata = getOptionalRecord(object, "metadata");
  const customerDetails = getOptionalRecord(object, "customer_details");
  const priceId = firstPriceIdFromLines(object);
  const occurredAt = unixSecondsToIso(getOptionalNumber(payload, "created")) ?? new Date().toISOString();
  const workspaceId = getOptionalString(metadata ?? {}, "workspaceId") ?? getOptionalString(object, "client_reference_id");
  const planId = getOptionalString(metadata ?? {}, "planId") ?? configuredPlanIdForPriceId(priceId);

  if (envelope.type === "checkout.session.completed") {
    return {
      type: envelope.type,
      id: eventId,
      sessionId: getOptionalString(object, "id"),
      workspaceId,
      stripeCustomerId: getOptionalString(object, "customer"),
      planId,
      billingEmail: getOptionalString(customerDetails ?? {}, "email") ?? getOptionalString(object, "customer_email"),
      occurredAt,
    };
  }

  if (
    envelope.type === "customer.subscription.created"
    || envelope.type === "customer.subscription.updated"
    || envelope.type === "customer.subscription.deleted"
  ) {
    return {
      type: envelope.type,
      id: eventId,
      workspaceId,
      stripeCustomerId: getOptionalString(object, "customer"),
      stripeSubscriptionId: getOptionalString(object, "id"),
      planId,
      subscriptionStatus: mapStripeStatus(getOptionalString(object, "status")),
      currentPeriodEnd: unixSecondsToIso(getOptionalNumber(object, "current_period_end")),
      cancelAtPeriodEnd: getOptionalBoolean(object, "cancel_at_period_end"),
      occurredAt,
    };
  }

  if (envelope.type === "invoice.paid" || envelope.type === "invoice.payment_failed") {
    const amountCents = getOptionalNumber(object, "amount_paid") ?? getOptionalNumber(object, "total") ?? 0;
    const currency = (getOptionalString(object, "currency") ?? "usd").toUpperCase();
    const amount = `${(amountCents / 100).toFixed(2)} ${currency}`;
    const hostedInvoiceUrl = getOptionalString(object, "hosted_invoice_url") ?? getOptionalString(object, "invoice_pdf");

    return {
      type: envelope.type,
      id: eventId,
      workspaceId,
      stripeCustomerId: getOptionalString(object, "customer"),
      stripeSubscriptionId: getOptionalString(object, "subscription"),
      planId,
      billingEmail: getOptionalString(object, "customer_email"),
      currentPeriodEnd: firstPeriodEndFromLines(object),
      occurredAt,
      amount,
      hostedInvoiceUrl,
    };
  }

  throw buildError(BillingSyncErrorCode.BAD_REQUEST, "unsupported Stripe webhook event type");
}

function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const entries = signatureHeader.split(",").map((entry) => entry.trim());
  const timestamp = entries.find((entry) => entry.startsWith("t="))?.slice(2);
  const signatures = entries.filter((entry) => entry.startsWith("v1=")).map((entry) => entry.slice(3));
  if (!timestamp || signatures.length === 0) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return signatures.some((signature) => {
    try {
      const candidate = Buffer.from(signature, "hex");
      return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
    } catch {
      return false;
    }
  });
}

function normalizeWebhookBody(
  body: unknown,
  headers: Readonly<Record<string, string | undefined>> | undefined,
): StripeWebhookEvent {
  const webhookSecret = readEnv("STRIPE_WEBHOOK_SECRET");
  let rawBody: string | undefined;
  if (typeof body === "string") {
    rawBody = body;
  } else if (body instanceof Uint8Array) {
    rawBody = new TextDecoder().decode(body);
  }
  if (typeof rawBody === "string") {
    if (webhookSecret) {
      const signature = readHeader(headers, "stripe-signature");
      if (!signature || !verifyStripeSignature(rawBody, signature, webhookSecret)) {
        throw buildError(BillingSyncErrorCode.BAD_REQUEST, "invalid Stripe webhook signature");
      }
    }
    try {
      return normalizeStripeWebhookEnvelope(JSON.parse(rawBody) as unknown);
    } catch (error) {
      if (error instanceof BillingSyncError) {
        throw error;
      }
      throw buildError(BillingSyncErrorCode.BAD_REQUEST, "stripe webhook body must be valid JSON");
    }
  }
  if (webhookSecret) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "raw webhook body is required when STRIPE_WEBHOOK_SECRET is configured");
  }
  return normalizeStripeWebhookEnvelope(body);
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? "/";
}

function isWebhookPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/webhooks/stripe" || normalized === "/webhooks/stripe/";
}

export async function stripeWebhookRoute(input: WebhookRouteRequest): Promise<BillingRouteResponse> {
  const allowedMethods = "POST,OPTIONS";
  const request = normalizeRequest(input);
  if (!request) {
    return billingJsonResponse("GET", 400, { error: "BILLING_SYNC_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  if (!isWebhookPath(request.path)) {
    return billingJsonResponse(request.method, 404, { error: "BILLING_SYNC_NOT_FOUND" }, "no-store", allowedMethods);
  }
  if (request.method === "OPTIONS") {
    return billingOptionsResponseWithHeaders(allowedMethods, ["stripe-signature"]);
  }
  if (request.method !== "POST") {
    return billingJsonResponse(request.method, 400, { error: "BILLING_SYNC_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  try {
    return billingJsonResponse(
      request.method,
      200,
      await applyStripeWebhookEvent(normalizeWebhookBody(request.body, request.headers)),
      "no-store",
      allowedMethods,
    );
  } catch (error) {
    return billingErrorResponse(request.method, error, allowedMethods);
  }
}
