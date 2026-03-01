import { getProjectUsageEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import { ControlPlaneError, ControlPlaneErrorCode } from "../types";
import { adminJsonResponse, type AdminRouteResponse } from "./response";

export async function adminProjectUsageRoute(
  projectId: string,
  window: string,
  token: string,
): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return adminJsonResponse(401, { error: "Unauthorized" });
  }
  const normalizedProjectId = projectId.trim();
  if (normalizedProjectId.length === 0) {
    return adminJsonResponse(400, { error: "projectId is required" });
  }
  try {
    const normalized = window.trim().toLowerCase();
    if (normalized !== "day" && normalized !== "month") {
      return adminJsonResponse(400, { error: "Invalid usage window" });
    }
    const body = getProjectUsageEndpoint(normalizedProjectId, normalized, token);
    return adminJsonResponse(200, body);
  } catch (error) {
    if (error instanceof ControlPlaneError) {
      if (error.code === ControlPlaneErrorCode.UNAUTHORIZED) {
        return adminJsonResponse(401, { code: error.code, error: error.message });
      }
      if (error.code === ControlPlaneErrorCode.CONFLICT) {
        return adminJsonResponse(409, { code: error.code, error: error.message });
      }
      return adminJsonResponse(503, { code: error.code, error: error.message });
    }
    return adminJsonResponse(400, { error: error instanceof Error ? error.message : "Usage lookup failed" });
  }
}
