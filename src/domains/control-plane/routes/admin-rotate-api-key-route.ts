import { rotateApiKeyEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminRotateApiKeyRoute(projectId: string, token: string): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return unauthorizedAdminResponse();
  }
  const normalizedProjectId = projectId.trim();
  if (normalizedProjectId.length === 0) {
    return adminJsonResponse(400, { error: "projectId is required" });
  }
  try {
    const body = rotateApiKeyEndpoint(normalizedProjectId, token);
    return adminJsonResponse(200, body);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 400,
      defaultMessage: "API key rotation failed",
    });
  }
}
