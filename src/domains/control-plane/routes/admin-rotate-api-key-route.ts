import { rotateApiKeyEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  normalizeAdminResourceId,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminRotateApiKeyRoute(projectId: string, token: string): Promise<AdminRouteResponse> {
  if (!(await isAuthorized(token))) {
    return unauthorizedAdminResponse();
  }
  const normalizedProjectId = normalizeAdminResourceId(projectId, "projectId");
  if (typeof normalizedProjectId !== "string") {
    return normalizedProjectId;
  }
  try {
    const body = await rotateApiKeyEndpoint(normalizedProjectId, token);
    return adminJsonResponse(200, body);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 503,
      defaultMessage: "API key rotation failed",
    });
  }
}
