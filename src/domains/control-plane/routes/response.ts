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

function controlPlaneErrorStatus(code: ControlPlaneErrorCode): number {
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
    error: error instanceof Error ? error.message : options.defaultMessage,
  });
}
