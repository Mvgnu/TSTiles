import { promoteArtifactEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import { ControlPlaneError, ControlPlaneErrorCode } from "../types";
import { adminJsonResponse, type AdminRouteResponse } from "./response";

export async function adminPromoteArtifactRoute(token: string, versionId: string): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return adminJsonResponse(401, { error: "Unauthorized" });
  }
  const normalizedVersionId = versionId.trim();
  if (normalizedVersionId.length === 0) {
    return adminJsonResponse(400, { error: "versionId is required" });
  }
  try {
    const body = promoteArtifactEndpoint(normalizedVersionId, token);
    return adminJsonResponse(200, body);
  } catch (error) {
    if (error instanceof ControlPlaneError) {
      if (error.code === ControlPlaneErrorCode.CONFLICT) {
        return adminJsonResponse(409, { code: error.code, error: error.message });
      }
      if (error.code === ControlPlaneErrorCode.UNAUTHORIZED) {
        return adminJsonResponse(401, { code: error.code, error: error.message });
      }
      if (error.code === ControlPlaneErrorCode.FORBIDDEN) {
        return adminJsonResponse(403, { code: error.code, error: error.message });
      }
      return adminJsonResponse(503, { code: error.code, error: error.message });
    }
    const message = error instanceof Error ? error.message : "Promotion failed";
    return adminJsonResponse(409, { error: message });
  }
}
