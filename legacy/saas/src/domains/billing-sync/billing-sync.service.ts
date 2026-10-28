import { getBillingPlan } from "../metering/metering.service";
import { syncWorkspaceProjectPlan } from "../projects/projects.service";
import { prisma } from "../../config/db";
import { sendTransactionalEmail, isSuppressed } from "../email/email.service";
import {
  BillingSyncError,
  BillingSyncErrorCode,
  type BillingPortalSession,
  type BillingPortalSessionInput,
  type BillingSnapshot,
  type BillingSubscriptionStatus,
  type CheckoutSession,
  type CheckoutSessionInput,
  type StripeWebhookEvent,
} from "./types";

interface StripeCheckoutSessionResponse {
  readonly id: string;
  readonly url: string;
  readonly expires_at: number;
}

interface StripePortalSessionResponse {
  readonly id: string;
  readonly url: string;
  readonly created: number;
}

function buildError(code: BillingSyncErrorCode, details: string): BillingSyncError {
  return new BillingSyncError(code, details);
}

function hasUnsupportedIdentifierShape(value: string): boolean {
  return value === "."
    || value.includes("..")
    || value.includes("/")
    || value.includes("\\")
    || value.includes("|");
}

function normalizeOptionalTrimmedString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${field} must be non-empty`);
  }
  return normalized;
}

function normalizeOptionalBlankOmittedTrimmedString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${field} must be a string`);
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequiredId(value: unknown, field: string): string {
  const normalized = normalizeOptionalTrimmedString(value, field);
  if (!normalized) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${field} is required`);
  }
  if (hasUnsupportedIdentifierShape(normalized)) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${field} contains unsupported characters`);
  }
  return normalized;
}

function normalizeOptionalId(value: unknown, field: string): string | undefined {
  const normalized = normalizeOptionalTrimmedString(value, field);
  return normalized === undefined ? undefined : normalizeRequiredId(normalized, field);
}

function normalizeOptionalPlanId(value: unknown): string | undefined {
  const normalized = normalizeOptionalId(value, "planId")?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const resolvedPlanId = getBillingPlan(normalized).planId;
  if (resolvedPlanId !== normalized) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "planId is not recognized");
  }
  return resolvedPlanId;
}

function normalizeOptionalDate(value: unknown, field: string): string | undefined {
  const normalized = normalizeOptionalTrimmedString(value, field);
  if (normalized === undefined) {
    return undefined;
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${field} must be an ISO timestamp`);
  }
  return new Date(parsed).toISOString();
}

function normalizeOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${field} must be boolean`);
  }
  return value;
}

function normalizeOptionalBillingEmail(value: unknown): string | undefined {
  return normalizeOptionalBlankOmittedTrimmedString(value, "billingEmail");
}

function normalizeOptionalWebhookId(value: unknown, field: string): string | undefined {
  const normalized = normalizeOptionalBlankOmittedTrimmedString(value, field);
  return normalized === undefined ? undefined : normalizeRequiredId(normalized, field);
}

function normalizeOptionalWebhookDate(value: unknown, field: string): string | undefined {
  const normalized = normalizeOptionalBlankOmittedTrimmedString(value, field);
  if (normalized === undefined) {
    return undefined;
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${field} must be an ISO timestamp`);
  }
  return new Date(parsed).toISOString();
}

function normalizeSubscriptionStatusValue(value: unknown): BillingSubscriptionStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "subscriptionStatus must be a string");
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized !== "trialing"
    && normalized !== "active"
    && normalized !== "past_due"
    && normalized !== "canceled"
    && normalized !== "unpaid"
  ) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "subscriptionStatus is not recognized");
  }
  return normalized;
}

function normalizePersistedSubscriptionStatus(value: unknown): BillingSubscriptionStatus {
  if (typeof value !== "string") {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "stored subscriptionStatus must be a string");
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized !== "free"
    && normalized !== "checkout_pending"
    && normalized !== "trialing"
    && normalized !== "active"
    && normalized !== "past_due"
    && normalized !== "canceled"
    && normalized !== "unpaid"
  ) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "stored subscriptionStatus is not recognized");
  }
  return normalized;
}

function normalizePersistedOptionalString(value: unknown, field: string): string | undefined {
  return value === null ? undefined : normalizeOptionalTrimmedString(value, field);
}

function normalizePersistedOptionalId(value: unknown, field: string): string | undefined {
  return value === null ? undefined : normalizeOptionalId(value, field);
}

function normalizePersistedOptionalPlanId(value: unknown): string | undefined {
  return value === null ? undefined : normalizeOptionalPlanId(value);
}

function normalizePersistedOptionalDate(value: unknown, field: string): string | undefined {
  return value === null ? undefined : normalizeOptionalDate(value, field);
}

function normalizePersistedOptionalBoolean(value: unknown, field: string): boolean | undefined {
  return value === null ? undefined : normalizeOptionalBoolean(value, field);
}

function normalizeWebhookEventType(value: unknown): StripeWebhookEvent["type"] {
  if (typeof value !== "string") {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "type must be a string");
  }
  const normalized = value.trim();
  if (
    normalized !== "checkout.session.completed"
    && normalized !== "customer.subscription.created"
    && normalized !== "customer.subscription.updated"
    && normalized !== "customer.subscription.deleted"
    && normalized !== "invoice.paid"
    && normalized !== "invoice.payment_failed"
  ) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "type is not supported");
  }
  return normalized;
}

function normalizeUrl(value: unknown, field: string): string {
  const normalized = normalizeOptionalTrimmedString(value, field);
  if (!normalized) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${field} is required`);
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return parsed.toString();
  } catch {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${field} must be an absolute http(s) URL`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecordInput(
  value: unknown,
  label: "checkout session input" | "billing portal input" | "stripe webhook event",
): void {
  if (!isRecord(value)) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, `${label} is required`);
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function getStripeSecretKey(): string {
  const secretKey = readEnv("STRIPE_SECRET_KEY");
  if (!secretKey) {
    throw buildError(BillingSyncErrorCode.CONFLICT, "STRIPE_SECRET_KEY is not configured");
  }
  return secretKey;
}

function getStripeApiBaseUrl(): string {
  return normalizeUrl(readEnv("STRIPE_API_BASE_URL") ?? "https://api.stripe.com", "STRIPE_API_BASE_URL");
}

function priceEnvName(planId: string): string {
  return `STRIPE_PRICE_ID_${planId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function resolveStripePriceId(planId: string): string {
  if (planId === "free") {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "free plan does not use checkout");
  }
  const envName = priceEnvName(planId);
  const priceId = readEnv(envName);
  if (!priceId) {
    throw buildError(BillingSyncErrorCode.CONFLICT, `${envName} is not configured`);
  }
  return priceId;
}

function extractStripeErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const error = payload.error;
  if (!isRecord(error)) {
    return undefined;
  }
  return typeof error.message === "string" && error.message.trim().length > 0
    ? error.message
    : undefined;
}

function getRequiredString(payload: Record<string, unknown>, field: string, context: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw buildError(BillingSyncErrorCode.CONFLICT, `${context} did not include ${field}`);
  }
  return value;
}

function getRequiredNumber(payload: Record<string, unknown>, field: string, context: string): number {
  const value = payload[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw buildError(BillingSyncErrorCode.CONFLICT, `${context} did not include ${field}`);
  }
  return value;
}

function toIsoFromUnixSeconds(seconds: number, field: string): string {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw buildError(BillingSyncErrorCode.CONFLICT, `${field} must be a positive unix timestamp`);
  }
  return new Date(seconds * 1000).toISOString();
}

async function postStripeForm(
  path: string,
  params: ReadonlyArray<readonly [string, string]>,
): Promise<Record<string, unknown>> {
  const url = new URL(path, getStripeApiBaseUrl());
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${getStripeSecretKey()}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params.map(([key, value]) => [key, value])).toString(),
  });
  const payloadText = await response.text();
  let payload: unknown = {};
  if (payloadText.trim().length > 0) {
    try {
      payload = JSON.parse(payloadText) as unknown;
    } catch {
      throw buildError(BillingSyncErrorCode.CONFLICT, "Stripe response was not valid JSON");
    }
  }
  if (!response.ok) {
    throw buildError(
      BillingSyncErrorCode.CONFLICT,
      extractStripeErrorMessage(payload) ?? `Stripe request failed with status ${response.status}`,
    );
  }
  if (!isRecord(payload)) {
    throw buildError(BillingSyncErrorCode.CONFLICT, "Stripe response must be a JSON object");
  }
  return payload;
}

function buildDefaultSnapshot(workspaceId: string): BillingSnapshot {
  return {
    workspaceId,
    planId: getBillingPlan("free").planId,
    subscriptionStatus: "free",
    cancelAtPeriodEnd: false,
  };
}

function normalizePersistedSnapshot(snapshot: unknown): BillingSnapshot {
  if (!isRecord(snapshot)) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "stored billing snapshot is invalid");
  }
  return {
    workspaceId: normalizeRequiredId(snapshot.workspaceId, "workspaceId"),
    planId: normalizePersistedOptionalPlanId(snapshot.planId) ?? getBillingPlan("free").planId,
    subscriptionStatus: normalizePersistedSubscriptionStatus(snapshot.subscriptionStatus),
    billingEmail: normalizePersistedOptionalString(snapshot.billingEmail, "billingEmail"),
    stripeCustomerId: normalizePersistedOptionalId(snapshot.stripeCustomerId, "stripeCustomerId"),
    stripeSubscriptionId: normalizePersistedOptionalId(snapshot.stripeSubscriptionId, "stripeSubscriptionId"),
    currentPeriodEnd: normalizePersistedOptionalDate(snapshot.currentPeriodEnd, "currentPeriodEnd"),
    cancelAtPeriodEnd: normalizePersistedOptionalBoolean(snapshot.cancelAtPeriodEnd, "cancelAtPeriodEnd") ?? false,
    lastWebhookAt: normalizePersistedOptionalDate(snapshot.lastWebhookAt, "lastWebhookAt"),
  };
}

async function getOrCreateSnapshot(workspaceId: string): Promise<BillingSnapshot> {
  const defaults = buildDefaultSnapshot(workspaceId);
  const saved = await prisma.billingSnapshot.upsert({
    where: { workspaceId },
    update: {},
    create: {
      workspaceId: defaults.workspaceId,
      planId: defaults.planId,
      subscriptionStatus: defaults.subscriptionStatus,
      cancelAtPeriodEnd: defaults.cancelAtPeriodEnd,
    },
  });
  return normalizePersistedSnapshot(saved);
}

async function persistSnapshot(snapshot: BillingSnapshot): Promise<BillingSnapshot> {
  const normalizedSnapshot = normalizePersistedSnapshot(snapshot);
  const saved = await prisma.billingSnapshot.upsert({
    where: { workspaceId: normalizedSnapshot.workspaceId },
    update: normalizedSnapshot,
    create: normalizedSnapshot,
  });
  return normalizePersistedSnapshot(saved);
}

async function resolveWorkspaceIdFromEvent(event: StripeWebhookEvent): Promise<string> {
  const explicitWorkspaceId = normalizeOptionalWebhookId(event.workspaceId, "workspaceId");
  if (explicitWorkspaceId) {
    return explicitWorkspaceId;
  }
  const sessionId = normalizeOptionalWebhookId(event.sessionId, "sessionId");
  if (sessionId) {
    const pendingSession = await prisma.checkoutSession.findUnique({
      where: { sessionId }
    });
    if (pendingSession) {
      return pendingSession.workspaceId;
    }
  }
  const stripeSubscriptionId = normalizeOptionalWebhookId(event.stripeSubscriptionId, "stripeSubscriptionId");
  if (stripeSubscriptionId) {
    const snapshot = await prisma.billingSnapshot.findUnique({
      where: { stripeSubscriptionId }
    });
    if (snapshot) {
      return normalizePersistedSnapshot(snapshot).workspaceId;
    }
  }
  const stripeCustomerId = normalizeOptionalWebhookId(event.stripeCustomerId, "stripeCustomerId");
  if (stripeCustomerId) {
    const snapshot = await prisma.billingSnapshot.findUnique({
      where: { stripeCustomerId }
    });
    if (snapshot) {
      return normalizePersistedSnapshot(snapshot).workspaceId;
    }
  }
  throw buildError(BillingSyncErrorCode.NOT_FOUND, "workspace could not be resolved from webhook event");
}

function normalizeSubscriptionStatus(
  status: BillingSubscriptionStatus | undefined,
  fallback: BillingSubscriptionStatus,
): BillingSubscriptionStatus {
  return status ?? fallback;
}

// Persistent webhook + checkout retention. Sweeps run amortized after every
// Nth processed webhook so retention does not require an external cron.
const WEBHOOK_RETENTION_DAYS = 30;
const WEBHOOK_SWEEP_INTERVAL = 64;
let webhookWritesSinceLastSweep = 0;

async function sweepBillingRetention(): Promise<void> {
  const now = Date.now();
  const webhookCutoffIso = new Date(now - WEBHOOK_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const checkoutCutoffIso = new Date(now).toISOString();
  try {
    await prisma.billingWebhookEvent.deleteMany({
      where: { recordedAt: { lt: webhookCutoffIso } },
    });
    // Stripe checkout sessions expire (default 24h). Once expired, the row is
    // never useful for correlating future webhooks.
    await prisma.checkoutSession.deleteMany({
      where: { expiresAt: { lt: checkoutCutoffIso } },
    });
  } catch {
    // Sweeps are best-effort; do not fail webhook processing on retention errors.
  }
}

function maybeScheduleBillingSweep(): void {
  webhookWritesSinceLastSweep += 1;
  if (webhookWritesSinceLastSweep < WEBHOOK_SWEEP_INTERVAL) {
    return;
  }
  webhookWritesSinceLastSweep = 0;
  void sweepBillingRetention();
}

async function isDuplicateWebhookEvent(eventId: string | undefined): Promise<boolean> {
  if (!eventId) {
    return false;
  }
  const existing = await prisma.billingWebhookEvent.findUnique({
    where: { eventId },
  });
  return existing !== null;
}

async function recordWebhookEvent(event: {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly type: string;
  readonly occurredAt: string;
}): Promise<void> {
  const recordedAt = new Date().toISOString();
  await prisma.billingWebhookEvent.create({
    data: {
      eventId: event.eventId,
      workspaceId: event.workspaceId,
      type: event.type,
      occurredAt: event.occurredAt,
      recordedAt,
    },
  });
  maybeScheduleBillingSweep();
}

function isStaleWebhook(occurredAt: string, current: BillingSnapshot): boolean {
  if (!current.lastWebhookAt) {
    return false;
  }
  const occurredAtMs = Date.parse(occurredAt);
  const lastMs = Date.parse(current.lastWebhookAt);
  if (Number.isNaN(occurredAtMs) || Number.isNaN(lastMs)) {
    return false;
  }
  return occurredAtMs < lastMs;
}

export async function getWorkspaceBilling(workspaceId: string): Promise<BillingSnapshot> {
  const normalizedWorkspaceId = normalizeRequiredId(workspaceId, "workspaceId");
  return await getOrCreateSnapshot(normalizedWorkspaceId);
}

export async function createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession> {
  assertRecordInput(input, "checkout session input");
  const workspaceId = normalizeRequiredId(input.workspaceId, "workspaceId");
  const planId = normalizeOptionalPlanId(input.planId);
  if (!planId) {
    throw buildError(BillingSyncErrorCode.BAD_REQUEST, "planId is required");
  }
  const successUrl = normalizeUrl(input.successUrl, "successUrl");
  const cancelUrl = normalizeUrl(input.cancelUrl, "cancelUrl");
  const priceId = resolveStripePriceId(planId);
  const snapshot = await getOrCreateSnapshot(workspaceId);
  const createdAt = new Date().toISOString();

  const params: Array<readonly [string, string]> = [
    ["mode", "subscription"],
    ["success_url", successUrl],
    ["cancel_url", cancelUrl],
    ["client_reference_id", workspaceId],
    ["allow_promotion_codes", "true"],
    ["metadata[workspaceId]", workspaceId],
    ["metadata[planId]", planId],
    ["subscription_data[metadata][workspaceId]", workspaceId],
    ["subscription_data[metadata][planId]", planId],
    ["line_items[0][price]", priceId],
    ["line_items[0][quantity]", "1"],
  ];
  if (snapshot.stripeCustomerId) {
    params.push(["customer", snapshot.stripeCustomerId]);
  }
  const stripeResponse = await postStripeForm("/v1/checkout/sessions", params);
  const checkoutSession: StripeCheckoutSessionResponse = {
    id: getRequiredString(stripeResponse, "id", "stripe checkout session"),
    url: normalizeUrl(getRequiredString(stripeResponse, "url", "stripe checkout session"), "stripe checkout session url"),
    expires_at: getRequiredNumber(stripeResponse, "expires_at", "stripe checkout session"),
  };
  const expiresAt = toIsoFromUnixSeconds(checkoutSession.expires_at, "expires_at");

  await prisma.checkoutSession.create({
    data: {
      workspaceId,
      planId,
      successUrl,
      cancelUrl,
      sessionId: checkoutSession.id,
      createdAt,
      expiresAt,
    }
  });

  return {
    workspaceId,
    planId,
    sessionId: checkoutSession.id,
    url: checkoutSession.url,
    createdAt,
    expiresAt,
  };
}

export async function createBillingPortalSession(input: BillingPortalSessionInput): Promise<BillingPortalSession> {
  assertRecordInput(input, "billing portal input");
  const workspaceId = normalizeRequiredId(input.workspaceId, "workspaceId");
  const returnUrl = normalizeUrl(input.returnUrl, "returnUrl");
  const snapshot = await getOrCreateSnapshot(workspaceId);
  if (!snapshot.stripeCustomerId) {
    throw buildError(BillingSyncErrorCode.CONFLICT, "billing portal is unavailable until checkout completes");
  }
  const stripeResponse = await postStripeForm("/v1/billing_portal/sessions", [
    ["customer", snapshot.stripeCustomerId],
    ["return_url", returnUrl],
  ]);
  const portalSession: StripePortalSessionResponse = {
    id: getRequiredString(stripeResponse, "id", "stripe billing portal session"),
    url: normalizeUrl(getRequiredString(stripeResponse, "url", "stripe billing portal session"), "stripe billing portal session url"),
    created: getRequiredNumber(stripeResponse, "created", "stripe billing portal session"),
  };
  return {
    workspaceId,
    sessionId: portalSession.id,
    url: portalSession.url,
    createdAt: toIsoFromUnixSeconds(portalSession.created, "created"),
  };
}

export async function applyStripeWebhookEvent(event: StripeWebhookEvent): Promise<BillingSnapshot> {
  assertRecordInput(event, "stripe webhook event");
  const eventType = normalizeWebhookEventType(event.type);
  const occurredAt = normalizeOptionalWebhookDate(event.occurredAt, "occurredAt") ?? new Date().toISOString();
  const eventId = normalizeOptionalWebhookId(event.id, "id");
  const workspaceId = await resolveWorkspaceIdFromEvent(event);
  // At-least-once delivery: skip duplicate processing keyed by Stripe event id.
  // Returns the current snapshot so retried webhooks still get a clean 200.
  if (eventId && (await isDuplicateWebhookEvent(eventId))) {
    return await getOrCreateSnapshot(workspaceId);
  }
  const current = await getOrCreateSnapshot(workspaceId);
  // Out-of-order delivery: a late webhook should not overwrite newer state.
  // We still record the event id so the caller's at-least-once retry collapses
  // and we drop the stale payload safely.
  if (isStaleWebhook(occurredAt, current)) {
    if (eventId) {
      await recordWebhookEvent({ eventId, workspaceId, type: eventType, occurredAt });
    }
    return current;
  }
  const normalizedPlanId = normalizeOptionalPlanId(event.planId);
  const normalizedCancelAtPeriodEnd = normalizeOptionalBoolean(event.cancelAtPeriodEnd, "cancelAtPeriodEnd");
  const normalizedBillingEmail = normalizeOptionalBillingEmail(event.billingEmail);
  const normalizedSubscriptionStatus = normalizeSubscriptionStatusValue(event.subscriptionStatus);
  const stripeCustomerId = normalizeOptionalWebhookId(event.stripeCustomerId, "stripeCustomerId") ?? current.stripeCustomerId;
  const stripeSubscriptionId =
    normalizeOptionalWebhookId(event.stripeSubscriptionId, "stripeSubscriptionId") ?? current.stripeSubscriptionId;

  const applied = await applyEventBody({
    eventType,
    occurredAt,
    workspaceId,
    current,
    normalizedPlanId,
    normalizedCancelAtPeriodEnd,
    normalizedBillingEmail,
    normalizedSubscriptionStatus,
    stripeCustomerId,
    stripeSubscriptionId,
    sessionId: event.sessionId,
    rawCurrentPeriodEnd: event.currentPeriodEnd,
    amount: event.amount,
    hostedInvoiceUrl: event.hostedInvoiceUrl,
  });

  if (eventId) {
    await recordWebhookEvent({ eventId, workspaceId, type: eventType, occurredAt });
  }
  return applied;
}

interface EventBodyInput {
  readonly eventType: StripeWebhookEvent["type"];
  readonly occurredAt: string;
  readonly workspaceId: string;
  readonly current: BillingSnapshot;
  readonly normalizedPlanId: string | undefined;
  readonly normalizedCancelAtPeriodEnd: boolean | undefined;
  readonly normalizedBillingEmail: string | undefined;
  readonly normalizedSubscriptionStatus: BillingSubscriptionStatus | undefined;
  readonly stripeCustomerId: string | undefined;
  readonly stripeSubscriptionId: string | undefined;
  readonly sessionId: unknown;
  readonly rawCurrentPeriodEnd: unknown;
  readonly amount: string | undefined;
  readonly hostedInvoiceUrl: string | undefined;
}

async function applyEventBody(input: EventBodyInput): Promise<BillingSnapshot> {
  const {
    eventType,
    occurredAt,
    workspaceId,
    current,
    normalizedPlanId,
    normalizedCancelAtPeriodEnd,
    normalizedBillingEmail,
    normalizedSubscriptionStatus,
    stripeCustomerId,
    stripeSubscriptionId,
    sessionId: rawSessionId,
    rawCurrentPeriodEnd,
    amount,
    hostedInvoiceUrl,
  } = input;
  if (eventType === "checkout.session.completed") {
    const sessionId = normalizeOptionalWebhookId(rawSessionId, "sessionId");
    const pendingSession = sessionId ? await prisma.checkoutSession.findUnique({
      where: { sessionId }
    }) : undefined;
    const planId = pendingSession?.planId
      ?? normalizedPlanId
      ?? current.planId;
    if (planId === getBillingPlan("free").planId) {
      throw buildError(BillingSyncErrorCode.BAD_REQUEST, "planId is required for checkout completion events");
    }
    return await persistSnapshot({
      ...current,
      planId,
      subscriptionStatus: normalizeSubscriptionStatus("checkout_pending", current.subscriptionStatus),
      stripeCustomerId,
      stripeSubscriptionId,
      billingEmail: normalizedBillingEmail ?? current.billingEmail,
      lastWebhookAt: occurredAt,
      cancelAtPeriodEnd: current.cancelAtPeriodEnd,
    });
  }

  if (eventType === "customer.subscription.created" || eventType === "customer.subscription.updated") {
    const planId = normalizedPlanId ?? current.planId;
    if (planId === getBillingPlan("free").planId) {
      throw buildError(BillingSyncErrorCode.BAD_REQUEST, "planId is required for subscription events");
    }
    const snapshot = await persistSnapshot({
      ...current,
      planId,
      subscriptionStatus: normalizeSubscriptionStatus(normalizedSubscriptionStatus, "active"),
      stripeCustomerId,
      stripeSubscriptionId,
      billingEmail: normalizedBillingEmail ?? current.billingEmail,
      currentPeriodEnd: normalizeOptionalWebhookDate(rawCurrentPeriodEnd, "currentPeriodEnd") ?? current.currentPeriodEnd,
      cancelAtPeriodEnd: normalizedCancelAtPeriodEnd ?? current.cancelAtPeriodEnd,
      lastWebhookAt: occurredAt,
    });
    await syncWorkspaceProjectPlan(workspaceId, planId);
    return snapshot;
  }

  if (eventType === "customer.subscription.deleted") {
    const snapshot = await persistSnapshot({
      ...current,
      planId: getBillingPlan("free").planId,
      stripeCustomerId,
      stripeSubscriptionId,
      subscriptionStatus: "canceled",
      currentPeriodEnd: normalizeOptionalWebhookDate(rawCurrentPeriodEnd, "currentPeriodEnd") ?? current.currentPeriodEnd,
      cancelAtPeriodEnd: false,
      lastWebhookAt: occurredAt,
    });
    await syncWorkspaceProjectPlan(workspaceId, snapshot.planId);
    return snapshot;
  }

  if (eventType === "invoice.paid") {
    const nextPlanId = normalizedPlanId ?? current.planId;
    if (nextPlanId === getBillingPlan("free").planId) {
      throw buildError(BillingSyncErrorCode.BAD_REQUEST, "planId is required for invoice events");
    }
    const snapshot = await persistSnapshot({
      ...current,
      planId: nextPlanId,
      stripeCustomerId,
      stripeSubscriptionId,
      billingEmail: normalizedBillingEmail ?? current.billingEmail,
      currentPeriodEnd: normalizeOptionalWebhookDate(rawCurrentPeriodEnd, "currentPeriodEnd") ?? current.currentPeriodEnd,
      subscriptionStatus:
        current.subscriptionStatus === "checkout_pending" || current.subscriptionStatus === "past_due" || (current.subscriptionStatus === "free" && nextPlanId !== "free")
          ? "active"
          : current.subscriptionStatus,
      lastWebhookAt: occurredAt,
    });
    if (snapshot.planId !== current.planId || snapshot.subscriptionStatus === "active") {
      await syncWorkspaceProjectPlan(workspaceId, snapshot.planId);
    }

    const emailTo = snapshot.billingEmail ?? current.billingEmail;
    if (emailTo) {
      const emailSuppressed = await isSuppressed(emailTo);
      if (!emailSuppressed) {
        const finalAmount = amount ?? "29.00 USD";
        const finalInvoiceUrl = hostedInvoiceUrl ?? "https://invoice.stripe.com/receipt";
        try {
          await sendTransactionalEmail({
            to: emailTo,
            templateKey: "billing_receipt",
            params: {
              amount: finalAmount,
              invoiceUrl: finalInvoiceUrl,
            },
            idempotencyKey: `receipt_${workspaceId}_${occurredAt.replace(/\W+/g, "")}`,
            workspaceId,
          });
        } catch {
          // ignore
        }
      }
    }

    return snapshot;
  }

  if (eventType === "invoice.payment_failed") {
    const nextPlanId = normalizedPlanId ?? current.planId;
    if (nextPlanId === getBillingPlan("free").planId) {
      throw buildError(BillingSyncErrorCode.BAD_REQUEST, "planId is required for invoice events");
    }
    return await persistSnapshot({
      ...current,
      planId: nextPlanId,
      stripeCustomerId,
      stripeSubscriptionId,
      billingEmail: normalizedBillingEmail ?? current.billingEmail,
      currentPeriodEnd: normalizeOptionalWebhookDate(rawCurrentPeriodEnd, "currentPeriodEnd") ?? current.currentPeriodEnd,
      subscriptionStatus: "past_due",
      lastWebhookAt: occurredAt,
    });
  }

  throw buildError(BillingSyncErrorCode.BAD_REQUEST, "unsupported webhook event");
}
