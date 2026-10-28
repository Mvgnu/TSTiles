import { publishStyleVersionEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  normalizeAdminResourceId,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminPublishStyleVersionRoute(
  styleId: string,
  versionId: string,
  token: string,
): Promise<AdminRouteResponse> {
  if (!(await isAuthorized(token))) {
    return unauthorizedAdminResponse();
  }
  const normalizedStyleId = normalizeAdminResourceId(styleId, "styleId");
  if (typeof normalizedStyleId !== "string") {
    return normalizedStyleId;
  }
  const normalizedVersionId = normalizeAdminResourceId(versionId, "versionId");
  if (typeof normalizedVersionId !== "string") {
    return normalizedVersionId;
  }
  try {
    const body = await publishStyleVersionEndpoint(normalizedStyleId, normalizedVersionId, token);
    return adminJsonResponse(200, body);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 503,
      defaultMessage: "Style publish failed",
    });
  }
}
