import { getWorkspaceBilling } from "../billing-sync.service";
import { requireSession } from "../../identity/identity.service";
import {
  billingErrorResponse,
  billingJsonResponse,
  billingOptionsResponse,
  type BillingRouteMethod,
  type BillingRouteResponse,
} from "./response";

interface BillingSummaryRouteRequest {
  readonly method: BillingRouteMethod;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizeRequest(input: unknown): BillingSummaryRouteRequest | null {
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
  };
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? "/";
}

function isBillingPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/app-api/billing" || normalized === "/app-api/billing/";
}

export async function billingSummaryRoute(input: BillingSummaryRouteRequest): Promise<BillingRouteResponse> {
  const allowedMethods = "GET,HEAD,OPTIONS";
  const request = normalizeRequest(input);
  if (!request) {
    return billingJsonResponse("GET", 400, { error: "BILLING_SYNC_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  if (!isBillingPath(request.path)) {
    return billingJsonResponse(request.method, 404, { error: "BILLING_SYNC_NOT_FOUND" }, "no-store", allowedMethods);
  }
  if (request.method === "OPTIONS") {
    return billingOptionsResponse(allowedMethods);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return billingJsonResponse(request.method, 400, { error: "BILLING_SYNC_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  try {
    const session = await requireSession(request.headers);
    return billingJsonResponse(request.method, 200, await getWorkspaceBilling(session.workspace.id), "no-store", allowedMethods);
  } catch (error) {
    return billingErrorResponse(request.method, error, allowedMethods);
  }
}
