import { triggerIngest } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import { ControlPlaneError, ControlPlaneErrorCode } from "../types";
import { adminJsonResponse, type AdminRouteResponse } from "./response";

export async function adminIngestRoute(token: string): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return adminJsonResponse(401, { error: "Unauthorized" });
  }
  try {
    const job = await triggerIngest(token);
    return adminJsonResponse(202, job);
  } catch (error) {
    if (error instanceof ControlPlaneError) {
      if (error.code === ControlPlaneErrorCode.UNAUTHORIZED) {
        return adminJsonResponse(401, { code: error.code, error: error.message });
      }
      if (error.code === ControlPlaneErrorCode.FORBIDDEN) {
        return adminJsonResponse(403, { code: error.code, error: error.message });
      }
      if (error.code === ControlPlaneErrorCode.DEPENDENCY_FAILED) {
        return adminJsonResponse(503, { code: error.code, error: error.message });
      }
      return adminJsonResponse(409, { code: error.code, error: error.message });
    }
    return adminJsonResponse(400, { error: error instanceof Error ? error.message : "Ingest failed" });
  }
}
