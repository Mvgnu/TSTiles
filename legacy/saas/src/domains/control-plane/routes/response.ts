import { ControlPlaneError, ControlPlaneErrorCode } from "../types";

export interface AdminRouteResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

export function adminJsonResponse(
  status: number,
  body: unknown,
  cacheControl = "no-store",
): AdminRouteResponse {
  return {
    status,
    body,
    headers: {
      "content-type": "application/json",
      "cache-control": cacheControl,
    },
  };
}

export function normalizeAdminResourceId(value: unknown, label: string): AdminRouteResponse | string {
  if (typeof value !== "string") {
    return adminJsonResponse(400, { error: `${label} must be a string` });
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return adminJsonResponse(400, { error: `${label} is required` });
  }
  if (
    normalized.includes("/")
    || normalized.includes("\\")
    || normalized === "."
    || normalized === ".."
    || normalized.includes("..")
  ) {
    return adminJsonResponse(400, { error: `${label} contains unsupported path characters` });
  }
  return normalized;
}

export function normalizeAdminUsageWindow(value: unknown): AdminRouteResponse | "day" | "month" {
  if (typeof value !== "string") {
    return adminJsonResponse(400, { error: "Invalid usage window" });
  }
  const normalized = value.trim().toLowerCase();
  if (normalized !== "day" && normalized !== "month") {
    return adminJsonResponse(400, { error: "Invalid usage window" });
  }
  return normalized;
}

function controlPlaneErrorStatus(code: ControlPlaneErrorCode): number {
  if (code === ControlPlaneErrorCode.BAD_REQUEST) {
    return 400;
  }
  if (code === ControlPlaneErrorCode.UNAUTHORIZED) {
    return 401;
  }
  if (code === ControlPlaneErrorCode.FORBIDDEN) {
    return 403;
  }
  if (code === ControlPlaneErrorCode.CONFLICT) {
    return 409;
  }
  return 503;
}

export function unauthorizedAdminResponse(): AdminRouteResponse {
  return adminJsonResponse(401, { error: "Unauthorized" });
}

export function adminErrorResponse(
  error: unknown,
  options: {
    readonly defaultStatus: number;
    readonly defaultMessage: string;
  },
): AdminRouteResponse {
  if (error instanceof ControlPlaneError) {
    return adminJsonResponse(controlPlaneErrorStatus(error.code), {
      code: error.code,
      error: error.message,
    });
  }
  return adminJsonResponse(options.defaultStatus, {
    error: options.defaultMessage,
  });
}
