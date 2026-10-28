import {
  getConsoleProjectUsage,
  getConsoleProject,
  rotateConsoleProjectKey,
  updateConsoleProject,
} from "../customer-console.service";
import type { ConsoleProjectUsageWindow } from "../types";
import { requireSession } from "../../identity/identity.service";
import {
  customerConsoleErrorResponse,
  customerConsoleJsonResponse,
  customerConsoleOptionsResponse,
  type CustomerConsoleRouteMethod,
  type CustomerConsoleRouteResponse,
} from "./response";

interface ProjectRouteRequest {
  readonly method: CustomerConsoleRouteMethod;
  readonly path: string;
  readonly body?: unknown;
  readonly headers: Readonly<Record<string, string | undefined>>;
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

function normalizeRequest(input: unknown): ProjectRouteRequest | null {
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
    body: input.body,
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

function normalizeUsageWindow(path: string): ConsoleProjectUsageWindow {
  const url = new URL(path, "http://customer-console.local");
  const window = url.searchParams.get("window")?.trim().toLowerCase();
  if (window === "day" || window === "month") {
    return window;
  }
  throw new Error("usage window must be day or month");
}

function matchProjectPath(path: string): {
  readonly projectId: string;
  readonly action: "detail" | "rotate" | "usage";
} | null {
  const normalized = normalizePath(path);
  const rotateMatch = /^\/app-api\/projects\/([^/]+)\/keys\/rotate\/?$/.exec(normalized);
  if (rotateMatch?.[1]) {
    const projectId = decodePathSegment(rotateMatch[1]);
    if (!projectId) {
      return null;
    }
    return {
      projectId,
      action: "rotate",
    };
  }
  const usageMatch = /^\/app-api\/projects\/([^/]+)\/usage\/?$/.exec(normalized);
  if (usageMatch?.[1]) {
    const projectId = decodePathSegment(usageMatch[1]);
    if (!projectId) {
      return null;
    }
    return {
      projectId,
      action: "usage",
    };
  }
  const detailMatch = /^\/app-api\/projects\/([^/]+)\/?$/.exec(normalized);
  if (detailMatch?.[1]) {
    const projectId = decodePathSegment(detailMatch[1]);
    if (!projectId) {
      return null;
    }
    return {
      projectId,
      action: "detail",
    };
  }
  return null;
}

export async function customerConsoleProjectRoute(
  input: ProjectRouteRequest,
): Promise<CustomerConsoleRouteResponse> {
  const request = normalizeRequest(input);
  const matched = request ? matchProjectPath(request.path) : null;
  const allowedMethods = matched?.action === "rotate"
    ? "POST,OPTIONS"
    : matched?.action === "usage"
      ? "GET,HEAD,OPTIONS"
      : "GET,HEAD,OPTIONS,PATCH";
  if (!request) {
    return customerConsoleJsonResponse("GET", 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", "GET,HEAD,OPTIONS,PATCH,POST");
  }
  if (!matched) {
    return customerConsoleJsonResponse(request.method, 404, { error: "CUSTOMER_CONSOLE_NOT_FOUND" }, "no-store", "GET,HEAD,OPTIONS,PATCH,POST");
  }
  if (request.method === "OPTIONS") {
    return customerConsoleOptionsResponse(allowedMethods);
  }
  try {
    const session = await requireSession(request.headers);
    if (matched.action === "rotate") {
      if (request.method !== "POST") {
        return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
      }
      return customerConsoleJsonResponse(
        request.method,
        200,
        await rotateConsoleProjectKey(matched.projectId, session.workspace.id),
        "no-store",
        allowedMethods,
      );
    }
    if (matched.action === "usage") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
      }
      const window = normalizeUsageWindow(request.path);
      return customerConsoleJsonResponse(
        request.method,
        200,
        await getConsoleProjectUsage(matched.projectId, window, session.workspace.id),
        "no-store",
        allowedMethods,
      );
    }
    if (request.method === "GET" || request.method === "HEAD") {
      return customerConsoleJsonResponse(
        request.method,
        200,
        await getConsoleProject(matched.projectId, session.workspace.id),
        "no-store",
        allowedMethods,
      );
    }
    if (request.method === "PATCH") {
      const body = normalizeBody(request.body);
      if (body === null) {
        return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
      }
      return customerConsoleJsonResponse(
        request.method,
        200,
        await updateConsoleProject(
          matched.projectId,
          body as unknown as Parameters<typeof updateConsoleProject>[1],
          session.workspace.id,
        ),
        "no-store",
        allowedMethods,
      );
    }
    return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
  } catch (error) {
    if (error instanceof Error && error.message === "usage window must be day or month") {
      return customerConsoleJsonResponse(request.method, 400, { error: "CUSTOMER_CONSOLE_BAD_REQUEST" }, "no-store", allowedMethods);
    }
    return customerConsoleErrorResponse(request.method, error, allowedMethods);
  }
}
