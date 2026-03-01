import { promoteArtifactEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminPromoteArtifactRoute(token: string, versionId: string): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return unauthorizedAdminResponse();
  }
  const normalizedVersionId = versionId.trim();
  if (normalizedVersionId.length === 0) {
    return adminJsonResponse(400, { error: "versionId is required" });
  }
  try {
    const body = promoteArtifactEndpoint(normalizedVersionId, token);
    return adminJsonResponse(200, body);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 409,
      defaultMessage: "Promotion failed",
    });
  }
}
