import { BillingSyncError, BillingSyncErrorCode } from "../types";
import { IdentityError, IdentityErrorCode } from "../../identity/types";

export type BillingRouteMethod = "GET" | "HEAD" | "OPTIONS" | "POST" | "PATCH";

export interface BillingRouteResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}

function bodyForMethod(method: BillingRouteMethod, body: string): string | undefined {
  if (method === "HEAD") {
    return undefined;
  }
  return body;
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isManagedAuthHeaderBridgeEnabled(): boolean {
  return (process.env.IDENTITY_MANAGED_AUTH_MODE?.trim().toLowerCase() ?? "") === "header";
}

function joinAllowedHeaders(extraAllowedHeaders: ReadonlyArray<string>): string {
  const seen = new Set<string>();
  const headers = [
    "authorization",
    "content-type",
    "x-session-token",
    ...extraAllowedHeaders,
  ];
  if (isManagedAuthHeaderBridgeEnabled()) {
    headers.push(
      "x-auth-session-id",
      "x-auth-user-id",
      "x-auth-email",
      "x-auth-name",
      "x-auth-workspace-id",
      "x-auth-workspace-name",
      "x-auth-role",
    );
  }
  const normalized: string[] = [];
  for (const header of headers) {
    const value = header.trim().toLowerCase();
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized.join(",");
}

export function billingCorsHeaders(
  allowedMethods: string,
  extraAllowedHeaders: ReadonlyArray<string> = [],
): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": allowedMethods,
    "access-control-allow-headers": joinAllowedHeaders(extraAllowedHeaders),
    vary: "origin",
  };
}

export function billingJsonResponse(
  method: BillingRouteMethod,
  status: number,
  body: unknown,
  cacheControl = "no-store",
  allowedMethods = "GET,HEAD,OPTIONS,POST",
): BillingRouteResponse {
  const serialized = JSON.stringify(body);
  return {
    status,
    body: bodyForMethod(method, serialized),
    headers: {
      ...billingCorsHeaders(allowedMethods),
      "content-type": "application/json",
      "content-length": String(byteLengthUtf8(serialized)),
      "cache-control": cacheControl,
    },
  };
}

export function billingOptionsResponse(allowedMethods: string): BillingRouteResponse {
  return {
    status: 204,
    headers: {
      ...billingCorsHeaders(allowedMethods),
      "cache-control": "public, max-age=60",
    },
  };
}

export function billingOptionsResponseWithHeaders(
  allowedMethods: string,
  extraAllowedHeaders: ReadonlyArray<string>,
): BillingRouteResponse {
  return {
    status: 204,
    headers: {
      ...billingCorsHeaders(allowedMethods, extraAllowedHeaders),
      "cache-control": "public, max-age=60",
    },
  };
}

export function billingErrorResponse(
  method: BillingRouteMethod,
  error: unknown,
  allowedMethods = "GET,HEAD,OPTIONS,POST",
): BillingRouteResponse {
  if (error instanceof IdentityError) {
    const status = error.code === IdentityErrorCode.BAD_REQUEST
      ? 400
      : error.code === IdentityErrorCode.UNAUTHORIZED
        ? 401
        : 404;
    return billingJsonResponse(method, status, {
      code: error.code,
      error: error.details,
    }, "no-store", allowedMethods);
  }
  if (error instanceof BillingSyncError) {
    const status = error.code === BillingSyncErrorCode.BAD_REQUEST
      ? 400
      : error.code === BillingSyncErrorCode.NOT_FOUND
        ? 404
        : 409;
    return billingJsonResponse(method, status, {
      code: error.code,
      error: error.details,
    }, "no-store", allowedMethods);
  }
  return billingJsonResponse(method, 503, {
    error: "Billing request failed",
  }, "no-store", allowedMethods);
}
