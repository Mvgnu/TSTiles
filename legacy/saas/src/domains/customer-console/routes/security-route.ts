import { requireSession } from "../../identity/identity.service";
import {
  updateConsolePassword,
  enrollConsoleMfa,
  disableConsoleMfa
} from "../customer-console.service";
import {
  customerConsoleErrorResponse,
  customerConsoleJsonResponse,
  customerConsoleOptionsResponse,
  type CustomerConsoleRouteMethod,
  type CustomerConsoleRouteResponse,
} from "./response";

interface SecurityRouteRequest {
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

function normalizeRequest(input: unknown): SecurityRouteRequest | null {
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

export async function customerConsoleSecurityRoute(
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
    const body = normalizeBody(request.body);
    if (!body) {
      return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
    }

    if (path === "/app-api/security/password" || path === "/app-api/security/password/") {
      await updateConsolePassword(session, body);
      return customerConsoleJsonResponse(request.method, 200, { success: true }, "no-store", allowedMethods);
    }

    if (path === "/app-api/security/mfa/enroll" || path === "/app-api/security/mfa/enroll/") {
      const result = await enrollConsoleMfa(session, body);
      return customerConsoleJsonResponse(request.method, 200, result, "no-store", allowedMethods);
    }

    if (path === "/app-api/security/mfa/disable" || path === "/app-api/security/mfa/disable/") {
      await disableConsoleMfa(session, body);
      return customerConsoleJsonResponse(request.method, 200, { success: true }, "no-store", allowedMethods);
    }

    return customerConsoleJsonResponse(request.method, 404, { error: "CUSTOMER_CONSOLE_NOT_FOUND" }, "no-store", allowedMethods);
  } catch (error) {
    return customerConsoleErrorResponse(request.method, error, allowedMethods);
  }
}
