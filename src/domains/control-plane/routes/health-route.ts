import { healthStatusEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import { ControlPlaneError, ControlPlaneErrorCode } from "../types";
import { adminJsonResponse, type AdminRouteResponse } from "./response";

export async function controlPlaneHealthRoute(token?: string): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return adminJsonResponse(401, { error: "Unauthorized" });
  }
  try {
    return adminJsonResponse(200, healthStatusEndpoint(token), "public, max-age=5");
  } catch (error) {
    if (error instanceof ControlPlaneError) {
      if (error.code === ControlPlaneErrorCode.UNAUTHORIZED) {
        return adminJsonResponse(401, { code: error.code, error: error.message });
      }
      if (error.code === ControlPlaneErrorCode.DEPENDENCY_FAILED) {
        return adminJsonResponse(503, { code: error.code, error: error.message });
      }
    }
    return adminJsonResponse(503, { error: error instanceof Error ? error.message : "Health check failed" });
  }
}
