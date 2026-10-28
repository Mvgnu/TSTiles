import { requireSession } from "../identity.service";
import {
  identityErrorResponse,
  identityJsonResponse,
  identityOptionsResponse,
  type IdentityRouteMethod,
  type IdentityRouteResponse,
} from "./response";

interface SessionRouteRequest {
  readonly method: IdentityRouteMethod;
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

function normalizeRequest(input: unknown): SessionRouteRequest | null {
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
    method: input.method as IdentityRouteMethod,
    path: input.path,
    headers,
  };
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? "/";
}

function isSessionPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/app-api/session" || normalized === "/app-api/session/";
}

export async function identitySessionRoute(input: SessionRouteRequest): Promise<IdentityRouteResponse> {
  const allowedMethods = "GET,HEAD,OPTIONS";
  const request = normalizeRequest(input);
  if (!request) {
    return identityJsonResponse("GET", 400, { error: "IDENTITY_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  if (!isSessionPath(request.path)) {
    return identityJsonResponse(request.method, 404, { error: "IDENTITY_NOT_FOUND" }, "no-store", allowedMethods);
  }
  if (request.method === "OPTIONS") {
    return identityOptionsResponse(allowedMethods);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return identityJsonResponse(request.method, 400, { error: "IDENTITY_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  try {
    return identityJsonResponse(request.method, 200, await requireSession(request.headers), "no-store", allowedMethods);
  } catch (error) {
    return identityErrorResponse(request.method, error, allowedMethods);
  }
}
