import { CustomerConsoleError, CustomerConsoleErrorCode } from "../types";
import { IdentityError, IdentityErrorCode } from "../../identity/types";

export type CustomerConsoleRouteMethod = "GET" | "HEAD" | "OPTIONS" | "POST" | "PATCH";

export interface CustomerConsoleRouteResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}

function bodyForMethod(method: CustomerConsoleRouteMethod, body: string): string | undefined {
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

export function customerConsoleCorsHeaders(allowedMethods: string): Record<string, string> {
  const allowedHeaders = [
    "authorization",
    "content-type",
    "x-session-token",
  ];
  if (isManagedAuthHeaderBridgeEnabled()) {
    allowedHeaders.push(
      "x-auth-session-id",
      "x-auth-user-id",
      "x-auth-email",
      "x-auth-name",
      "x-auth-workspace-id",
      "x-auth-workspace-name",
      "x-auth-role",
    );
  }
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": allowedMethods,
    "access-control-allow-headers": allowedHeaders.join(","),
    vary: "origin",
  };
}

export function customerConsoleJsonResponse(
  method: CustomerConsoleRouteMethod,
  status: number,
  body: unknown,
  cacheControl = "no-store",
  allowedMethods = "GET,HEAD,OPTIONS,POST,PATCH",
): CustomerConsoleRouteResponse {
  const serialized = JSON.stringify(body);
  return {
    status,
    body: bodyForMethod(method, serialized),
    headers: {
      ...customerConsoleCorsHeaders(allowedMethods),
      "content-type": "application/json",
      "content-length": String(byteLengthUtf8(serialized)),
      "cache-control": cacheControl,
    },
  };
}

export function customerConsoleOptionsResponse(
  allowedMethods: string,
  cacheControl = "public, max-age=60",
): CustomerConsoleRouteResponse {
  return {
    status: 204,
    headers: {
      ...customerConsoleCorsHeaders(allowedMethods),
      "cache-control": cacheControl,
    },
  };
}

export function customerConsoleErrorResponse(
  method: CustomerConsoleRouteMethod,
  error: unknown,
  allowedMethods = "GET,HEAD,OPTIONS,POST,PATCH",
): CustomerConsoleRouteResponse {
  if (error instanceof IdentityError) {
    const status = error.code === IdentityErrorCode.BAD_REQUEST
      ? 400
      : error.code === IdentityErrorCode.UNAUTHORIZED
        ? 401
        : 404;
    return customerConsoleJsonResponse(method, status, {
      code: error.code,
      error: error.details,
    }, "no-store", allowedMethods);
  }
  if (error instanceof CustomerConsoleError) {
    const status = error.code === CustomerConsoleErrorCode.BAD_REQUEST
      ? 400
      : error.code === CustomerConsoleErrorCode.NOT_FOUND
        ? 404
        : 503;
    return customerConsoleJsonResponse(method, status, {
      code: error.code,
      error: error.details,
    }, "no-store", allowedMethods);
  }
  return customerConsoleJsonResponse(method, 503, {
    error: "Customer console request failed",
  }, "no-store", allowedMethods);
}
