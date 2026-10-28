import { requireSession } from "../../identity/identity.service";
import {
  transferConsoleWorkspaceOwnership,
  deleteConsoleWorkspace,
  restoreConsoleWorkspace,
  exportConsoleWorkspace
} from "../customer-console.service";
import {
  customerConsoleErrorResponse,
  customerConsoleJsonResponse,
  customerConsoleOptionsResponse,
  type CustomerConsoleRouteMethod,
  type CustomerConsoleRouteResponse,
} from "./response";

interface WorkspaceRouteRequest {
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

function normalizeRequest(input: unknown): WorkspaceRouteRequest | null {
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

export async function customerConsoleWorkspaceRoute(
  input: unknown,
): Promise<CustomerConsoleRouteResponse> {
  const allowedMethods = "OPTIONS,POST";
  const request = normalizeRequest(input);
  if (!request) {
    return customerConsoleJsonResponse("POST", 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  }

  const path = normalizePath(request.path);
  if (request.method === "OPTIONS") {
    return customerConsoleOptionsResponse(allowedMethods);
  }

  if (request.method !== "POST") {
    return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  }

  try {
    const session = await requireSession(request.headers);

    if (path === "/app-api/workspace/transfer-ownership" || path === "/app-api/workspace/transfer-ownership/") {
      const body = normalizeBody(request.body);
      if (!body || typeof body.toUserId !== "string") {
        return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
      }
      await transferConsoleWorkspaceOwnership(session, body.toUserId);
      return customerConsoleJsonResponse(request.method, 200, { success: true }, "no-store", allowedMethods);
    }

    if (path === "/app-api/workspace/delete" || path === "/app-api/workspace/delete/") {
      const body = normalizeBody(request.body);
      const reason = body ? String(body.reason || "").trim() : "";
      await deleteConsoleWorkspace(session, reason || undefined);
      return customerConsoleJsonResponse(request.method, 200, { success: true }, "no-store", allowedMethods);
    }

    if (path === "/app-api/workspace/restore" || path === "/app-api/workspace/restore/") {
      await restoreConsoleWorkspace(session);
      return customerConsoleJsonResponse(request.method, 200, { success: true }, "no-store", allowedMethods);
    }

    if (path === "/app-api/workspace/export" || path === "/app-api/workspace/export/") {
      await exportConsoleWorkspace(session);
      return customerConsoleJsonResponse(request.method, 200, { success: true }, "no-store", allowedMethods);
    }

    return customerConsoleJsonResponse(request.method, 404, { error: "CUSTOMER_CONSOLE_NOT_FOUND" }, "no-store", allowedMethods);
  } catch (error) {
    return customerConsoleErrorResponse(request.method, error, allowedMethods);
  }
}
