import { requireSession } from "../../identity/identity.service";
import { getConsoleStyle, listConsoleStyles } from "../customer-console.service";
import {
  customerConsoleErrorResponse,
  customerConsoleJsonResponse,
  customerConsoleOptionsResponse,
  type CustomerConsoleRouteMethod,
  type CustomerConsoleRouteResponse,
} from "./response";

interface StylesRouteRequest {
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

function normalizeRequest(input: unknown): StylesRouteRequest | null {
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

function decodePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    if (
      decoded.length === 0
      || decoded.includes("/")
      || decoded.includes("\\")
      || decoded === "."
      || decoded.includes("..")
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function matchStylePath(path: string): { readonly styleId?: string } | null {
  const normalized = normalizePath(path);
  if (normalized === "/app-api/styles" || normalized === "/app-api/styles/") {
    return {};
  }
  const detailMatch = /^\/app-api\/styles\/([^/]+)\/?$/.exec(normalized);
  if (detailMatch?.[1]) {
    const styleId = decodePathSegment(detailMatch[1]);
    if (!styleId) {
      return null;
    }
    return {
      styleId,
    };
  }
  return null;
}

export async function customerConsoleStylesRoute(
  input: StylesRouteRequest,
): Promise<CustomerConsoleRouteResponse> {
  const request = normalizeRequest(input);
  const allowedMethods = "GET,HEAD,OPTIONS";
  if (!request) {
    return customerConsoleJsonResponse("GET", 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  const matched = matchStylePath(request.path);
  if (!matched) {
    return customerConsoleJsonResponse(request.method, 404, { error: "CUSTOMER_CONSOLE_NOT_FOUND" }, "no-store", allowedMethods);
  }
  if (request.method === "OPTIONS") {
    return customerConsoleOptionsResponse(allowedMethods);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  }
  try {
    await requireSession(request.headers);
    const payload = matched.styleId ? await getConsoleStyle(matched.styleId) : await listConsoleStyles();
    return customerConsoleJsonResponse(request.method, 200, payload, "no-store", allowedMethods);
  } catch (error) {
    return customerConsoleErrorResponse(request.method, error, allowedMethods);
  }
}
