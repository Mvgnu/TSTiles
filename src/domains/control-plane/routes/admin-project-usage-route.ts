import { getProjectUsageEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminProjectUsageRoute(
  projectId: string,
  window: string,
  token: string,
): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return unauthorizedAdminResponse();
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
    return adminErrorResponse(error, {
      defaultStatus: 400,
      defaultMessage: "Usage lookup failed",
    });
  }
}
