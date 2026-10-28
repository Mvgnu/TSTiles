import { createCheckoutSession } from "../billing-sync.service";
import { requireSession } from "../../identity/identity.service";
import { normalizeHostedRedirectUrl, resolveRequestOrigin } from "./redirect-url";
import {
  billingErrorResponse,
  billingJsonResponse,
  billingOptionsResponse,
  type BillingRouteMethod,
  type BillingRouteResponse,
} from "./response";

interface CheckoutRouteRequest {
  readonly method: BillingRouteMethod;
  readonly path: string;
  readonly body?: unknown;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBody(value: unknown): Record<string, unknown> | null {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return null;
  }
  return value;
}

function normalizeHeaders(value: unknown): Readonly<Record<string, string | undefined>> | null {
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

function normalizeRequest(input: unknown): CheckoutRouteRequest | null {
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
    headers,
    body: input.body,
  };
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? "/";
}

function isCheckoutPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/billing/checkout" || normalized === "/billing/checkout/";
}

export async function billingCheckoutRoute(input: CheckoutRouteRequest): Promise<BillingRouteResponse> {
  const allowedMethods = "POST,OPTIONS";
  const request = normalizeRequest(input);
  if (!request) {
    return billingJsonResponse("GET", 400, { error: "BILLING_SYNC_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  const body = normalizeBody(request.body);
  if (body === null) {
    return billingJsonResponse(request.method, 400, { error: "BILLING_SYNC_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  if (!isCheckoutPath(request.path)) {
    return billingJsonResponse(request.method, 404, { error: "BILLING_SYNC_NOT_FOUND" }, "no-store", allowedMethods);
  }
  if (request.method === "OPTIONS") {
    return billingOptionsResponse(allowedMethods);
  }
  if (request.method !== "POST") {
    return billingJsonResponse(request.method, 400, { error: "BILLING_SYNC_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  try {
    const session = await requireSession(request.headers);
    const requestOrigin = resolveRequestOrigin(request.headers);
    return billingJsonResponse(
      request.method,
      201,
      await createCheckoutSession({
        workspaceId: session.workspace.id,
        planId: typeof body.planId === "string" ? body.planId : "",
        successUrl: normalizeHostedRedirectUrl(
          typeof body.successUrl === "string" ? body.successUrl : "",
          "successUrl",
          requestOrigin,
        ),
        cancelUrl: normalizeHostedRedirectUrl(
          typeof body.cancelUrl === "string" ? body.cancelUrl : "",
          "cancelUrl",
          requestOrigin,
        ),
      }),
      "no-store",
      allowedMethods,
    );
  } catch (error) {
    return billingErrorResponse(request.method, error, allowedMethods);
  }
}
