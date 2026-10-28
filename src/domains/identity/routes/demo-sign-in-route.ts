import { issueDemoSession } from "../identity.service";
import {
  identityErrorResponse,
  identityJsonResponse,
  identityOptionsResponse,
  type IdentityRouteMethod,
  type IdentityRouteResponse,
} from "./response";

interface DemoSignInRouteRequest {
  readonly method: IdentityRouteMethod;
  readonly path: string;
  readonly body?: unknown;
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

function normalizeRequest(input: unknown): DemoSignInRouteRequest | null {
  if (!isRecord(input)) {
    return null;
  }
  if (typeof input.method !== "string" || typeof input.path !== "string") {
    return null;
  }
  return {
    method: input.method as IdentityRouteMethod,
    path: input.path,
    body: input.body,
  };
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? "/";
}

function isDemoSignInPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/auth/demo/sign-in" || normalized === "/auth/demo/sign-in/";
}

export async function identityDemoSignInRoute(input: DemoSignInRouteRequest): Promise<IdentityRouteResponse> {
  const allowedMethods = "POST,OPTIONS";
  const request = normalizeRequest(input);
  if (!request) {
    return identityJsonResponse("GET", 400, { error: "IDENTITY_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  if (!isDemoSignInPath(request.path)) {
    return identityJsonResponse(request.method, 404, { error: "IDENTITY_NOT_FOUND" }, "no-store", allowedMethods);
  }
  if (process.env.NODE_ENV !== "development") {
    return identityJsonResponse(request.method, 404, { error: "IDENTITY_NOT_FOUND" }, "no-store", allowedMethods);
  }
  if (request.method === "OPTIONS") {
    return identityOptionsResponse(allowedMethods);
  }
  if (request.method !== "POST") {
    return identityJsonResponse(request.method, 400, { error: "IDENTITY_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  const body = normalizeBody(request.body);
  if (body === null) {
    return identityJsonResponse(request.method, 400, { error: "IDENTITY_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  try {
    const session = await issueDemoSession(body as unknown as Parameters<typeof issueDemoSession>[0]);
    return identityJsonResponse(request.method, 201, session, "no-store", allowedMethods, {
      "set-cookie": `app_session=${session.token}; Path=/; HttpOnly; SameSite=Lax`,
    });
  } catch (error) {
    return identityErrorResponse(request.method, error, allowedMethods);
  }
}
