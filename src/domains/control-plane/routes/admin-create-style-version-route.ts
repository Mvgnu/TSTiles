import { createStyleVersionEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminCreateStyleVersionRoute(
  styleId: string,
  input: unknown,
  token: string,
): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return unauthorizedAdminResponse();
  }
  const normalizedStyleId = styleId.trim();
  if (normalizedStyleId.length === 0) {
    return adminJsonResponse(400, { error: "styleId is required" });
  }
  try {
    const body = createStyleVersionEndpoint(normalizedStyleId, input, token);
    return adminJsonResponse(201, body);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 503,
      defaultMessage: "Style version creation failed",
    });
  }
}
