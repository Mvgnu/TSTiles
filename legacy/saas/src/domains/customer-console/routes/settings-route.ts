import { requireSession } from "../../identity/identity.service";
import { getConsoleSettings, updateConsoleSettings } from "../customer-console.service";
import {
  customerConsoleErrorResponse,
  customerConsoleJsonResponse,
  customerConsoleOptionsResponse,
  type CustomerConsoleRouteMethod,
  type CustomerConsoleRouteResponse,
} from "./response";

interface SettingsRouteRequest {
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

function normalizeRequest(input: unknown): SettingsRouteRequest | null {
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

function isSettingsPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/app-api/settings" || normalized === "/app-api/settings/";
}

export async function customerConsoleSettingsRoute(
  input: SettingsRouteRequest,
): Promise<CustomerConsoleRouteResponse> {
  const allowedMethods = "GET,HEAD,OPTIONS,PATCH";
  const request = normalizeRequest(input);
  if (!request) {
    return customerConsoleJsonResponse("GET", 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  if (!isSettingsPath(request.path)) {
    return customerConsoleJsonResponse(request.method, 404, { error: "CUSTOMER_CONSOLE_NOT_FOUND" }, "no-store", allowedMethods);
  }
  if (request.method === "OPTIONS") {
    return customerConsoleOptionsResponse(allowedMethods);
  }
  try {
    const session = await requireSession(request.headers);
    if (request.method === "GET" || request.method === "HEAD") {
      return customerConsoleJsonResponse(request.method, 200, await getConsoleSettings(session), "no-store", allowedMethods);
    }
    if (request.method === "PATCH") {
      const body = normalizeBody(request.body);
      if (body === null) {
        return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
      }
      return customerConsoleJsonResponse(
        request.method,
        200,
        await updateConsoleSettings(session, body as unknown as Parameters<typeof updateConsoleSettings>[1]),
        "no-store",
        allowedMethods,
      );
    }
    return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  } catch (error) {
    return customerConsoleErrorResponse(request.method, error, allowedMethods);
  }
}
