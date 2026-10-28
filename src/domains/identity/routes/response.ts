import { IdentityError, IdentityErrorCode } from "../types";

export type IdentityRouteMethod = "GET" | "HEAD" | "OPTIONS" | "POST" | "PATCH";

export interface IdentityRouteResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}

function bodyForMethod(method: IdentityRouteMethod, body: string): string | undefined {
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

export function identityCorsHeaders(allowedMethods: string): Record<string, string> {
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

export function identityJsonResponse(
  method: IdentityRouteMethod,
  status: number,
  body: unknown,
  cacheControl = "no-store",
  allowedMethods = "GET,HEAD,OPTIONS,POST",
  extraHeaders: Record<string, string> = {},
): IdentityRouteResponse {
  const serialized = JSON.stringify(body);
  return {
    status,
    body: bodyForMethod(method, serialized),
    headers: {
      ...identityCorsHeaders(allowedMethods),
      ...extraHeaders,
      "content-type": "application/json",
      "content-length": String(byteLengthUtf8(serialized)),
      "cache-control": cacheControl,
    },
  };
}

export function identityOptionsResponse(allowedMethods: string): IdentityRouteResponse {
  return {
    status: 204,
    headers: {
      ...identityCorsHeaders(allowedMethods),
      "cache-control": "public, max-age=60",
    },
  };
}

export function identityErrorResponse(
  method: IdentityRouteMethod,
  error: unknown,
  allowedMethods = "GET,HEAD,OPTIONS,POST",
): IdentityRouteResponse {
  if (error instanceof IdentityError) {
    const status = error.code === IdentityErrorCode.BAD_REQUEST
      ? 400
      : error.code === IdentityErrorCode.UNAUTHORIZED
        ? 401
        : 404;
    return identityJsonResponse(method, status, {
      code: error.code,
      error: error.details,
    }, "no-store", allowedMethods);
  }
  return identityJsonResponse(method, 503, {
    error: "Identity request failed",
  }, "no-store", allowedMethods);
}
