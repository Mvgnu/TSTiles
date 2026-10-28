import { createStyleVersionEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  normalizeAdminResourceId,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminCreateStyleVersionRoute(
  styleId: string,
  input: unknown,
  token: string,
): Promise<AdminRouteResponse> {
  if (!(await isAuthorized(token))) {
    return unauthorizedAdminResponse();
  }
  const normalizedStyleId = normalizeAdminResourceId(styleId, "styleId");
  if (typeof normalizedStyleId !== "string") {
    return normalizedStyleId;
  }
  try {
    const body = await createStyleVersionEndpoint(normalizedStyleId, input, token);
    return adminJsonResponse(201, body);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 503,
      defaultMessage: "Style version creation failed",
    });
  }
}
