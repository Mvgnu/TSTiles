import { getProjectUsageEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  normalizeAdminResourceId,
  normalizeAdminUsageWindow,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminProjectUsageRoute(
  projectId: string,
  window: string,
  token: string,
): Promise<AdminRouteResponse> {
  if (!(await isAuthorized(token))) {
    return unauthorizedAdminResponse();
  }
  const normalizedProjectId = normalizeAdminResourceId(projectId, "projectId");
  if (typeof normalizedProjectId !== "string") {
    return normalizedProjectId;
  }
  const normalizedWindow = normalizeAdminUsageWindow(window);
  if (typeof normalizedWindow !== "string") {
    return normalizedWindow;
  }
  try {
    const body = await getProjectUsageEndpoint(normalizedProjectId, normalizedWindow, token);
    return adminJsonResponse(200, body);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 503,
      defaultMessage: "Usage lookup failed",
    });
  }
}
