import { promoteArtifactEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  normalizeAdminResourceId,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminPromoteArtifactRoute(token: string, versionId: string): Promise<AdminRouteResponse> {
  if (!(await isAuthorized(token))) {
    return unauthorizedAdminResponse();
  }
  const normalizedVersionId = normalizeAdminResourceId(versionId, "versionId");
  if (typeof normalizedVersionId !== "string") {
    return normalizedVersionId;
  }
  try {
    const body = await promoteArtifactEndpoint(normalizedVersionId, token);
    return adminJsonResponse(200, body);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 409,
      defaultMessage: "Promotion failed",
    });
  }
}
