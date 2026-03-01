import { publishStyleVersionEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminPublishStyleVersionRoute(
  styleId: string,
  versionId: string,
  token: string,
): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return unauthorizedAdminResponse();
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
    return adminErrorResponse(error, {
      defaultStatus: 400,
      defaultMessage: "Style publish failed",
    });
  }
}
