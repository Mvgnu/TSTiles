import { requireSession } from "../../identity/identity.service";
import {
  listConsoleMemberships,
  inviteConsoleMember,
  removeConsoleMember
} from "../customer-console.service";
import {
  customerConsoleErrorResponse,
  customerConsoleJsonResponse,
  customerConsoleOptionsResponse,
  type CustomerConsoleRouteMethod,
  type CustomerConsoleRouteResponse,
} from "./response";

interface MembershipsRouteRequest {
  readonly method: CustomerConsoleRouteMethod;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
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

function normalizeRequest(input: unknown): MembershipsRouteRequest | null {
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
    method: input.method as CustomerConsoleRouteMethod,
    path: input.path,
    headers,
    body: input.body,
  };
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? "/";
}

export async function customerConsoleMembershipsRoute(
  input: unknown,
): Promise<CustomerConsoleRouteResponse> {
  const allowedMethods = "GET,HEAD,OPTIONS,POST";
  const request = normalizeRequest(input);
  if (!request) {
    return customerConsoleJsonResponse("GET", 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  }

  const path = normalizePath(request.path);
  if (request.method === "OPTIONS") {
    return customerConsoleOptionsResponse(allowedMethods);
  }

  // Reject traversal or bad chars in path
  if (path.includes("\\") || path.includes("..")) {
    return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  }

  try {
    const session = await requireSession(request.headers);
    const workspaceId = session.workspace.id;

    if (path === "/app-api/memberships" || path === "/app-api/memberships/") {
      if (request.method === "GET" || request.method === "HEAD") {
        const memberships = await listConsoleMemberships(workspaceId);
        return customerConsoleJsonResponse(request.method, 200, memberships, "no-store", allowedMethods);
      }
      return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
    }

    if (path === "/app-api/memberships/invite" || path === "/app-api/memberships/invite/") {
      if (request.method === "POST") {
        const body = normalizeBody(request.body);
        if (!body) {
          return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
        }
        await inviteConsoleMember(session, body.email, body.role);
        return customerConsoleJsonResponse(request.method, 200, { success: true }, "no-store", allowedMethods);
      }
      return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
    }

    // Match /app-api/memberships/:userId/remove
    const removeMatch = path.match(/^\/app-api\/memberships\/([^/]+)\/remove\/?$/);
    if (removeMatch) {
      if (request.method === "POST") {
        const userId = decodeURIComponent(removeMatch[1]);
        if (userId.includes("/") || userId.includes("\\") || userId === "." || userId.includes("..")) {
          return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
        }
        const body = normalizeBody(request.body);
        const reason = body ? String(body.reason || "").trim() : "";
        await removeConsoleMember(session, userId, reason || undefined);
        return customerConsoleJsonResponse(request.method, 200, { success: true }, "no-store", allowedMethods);
      }
      return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
    }

    return customerConsoleJsonResponse(request.method, 404, { error: "CUSTOMER_CONSOLE_NOT_FOUND" }, "no-store", allowedMethods);
  } catch (error) {
    return customerConsoleErrorResponse(request.method, error, allowedMethods);
  }
}
