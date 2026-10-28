import { requireSession } from "../../identity/identity.service";
import { listConsoleNotifications } from "../customer-console.service";
import {
  customerConsoleErrorResponse,
  customerConsoleJsonResponse,
  customerConsoleOptionsResponse,
  type CustomerConsoleRouteMethod,
  type CustomerConsoleRouteResponse,
} from "./response";

interface NotificationsRouteRequest {
  readonly method: CustomerConsoleRouteMethod;
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

function normalizeRequest(input: unknown): NotificationsRouteRequest | null {
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
  };
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? "/";
}

export async function customerConsoleNotificationsRoute(
  input: unknown,
): Promise<CustomerConsoleRouteResponse> {
  const allowedMethods = "GET,HEAD,OPTIONS";
  const request = normalizeRequest(input);
  if (!request) {
    return customerConsoleJsonResponse("GET", 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  }

  const path = normalizePath(request.path);
  if (path !== "/app-api/notifications" && path !== "/app-api/notifications/") {
    return customerConsoleJsonResponse(request.method, 404, { error: "CUSTOMER_CONSOLE_NOT_FOUND" }, "no-store", allowedMethods);
  }

  if (request.method === "OPTIONS") {
    return customerConsoleOptionsResponse(allowedMethods);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  }

  try {
    const session = await requireSession(request.headers);
    const notifications = await listConsoleNotifications(session.workspace.id);
    return customerConsoleJsonResponse(request.method, 200, notifications, "no-store", allowedMethods);
  } catch (error) {
    return customerConsoleErrorResponse(request.method, error, allowedMethods);
  }
}
