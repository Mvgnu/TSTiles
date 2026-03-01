import { createProjectEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import { ControlPlaneError, ControlPlaneErrorCode } from "../types";
import type { ProjectCreationInput } from "../../projects/types";
import { adminJsonResponse, type AdminRouteResponse } from "./response";

export async function adminCreateProjectRoute(token: string, input: ProjectCreationInput): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return adminJsonResponse(401, { error: "Unauthorized" });
  }
  try {
    const body = createProjectEndpoint(input, token);
    return adminJsonResponse(201, body);
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
    return adminJsonResponse(400, { error: error instanceof Error ? error.message : "Project creation failed" });
  }
}
