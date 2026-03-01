import { publishStyleVersionEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import { ControlPlaneError, ControlPlaneErrorCode } from "../types";
import { adminJsonResponse, type AdminRouteResponse } from "./response";

export async function adminPublishStyleVersionRoute(
  styleId: string,
  versionId: string,
  token: string,
): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return adminJsonResponse(401, { error: "Unauthorized" });
  }
  const normalizedStyleId = styleId.trim();
  if (normalizedStyleId.length === 0) {
    return adminJsonResponse(400, { error: "styleId is required" });
  }
  const normalizedVersionId = versionId.trim();
  if (normalizedVersionId.length === 0) {
    return adminJsonResponse(400, { error: "versionId is required" });
  }
  try {
    const body = publishStyleVersionEndpoint(normalizedStyleId, normalizedVersionId, token);
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
    return adminJsonResponse(400, { error: error instanceof Error ? error.message : "Style publish failed" });
  }
}
