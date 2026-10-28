import { rollbackArtifactEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminRollbackArtifactRoute(token: string): Promise<AdminRouteResponse> {
  if (!(await isAuthorized(token))) {
    return unauthorizedAdminResponse();
  }
  try {
    return adminJsonResponse(200, await rollbackArtifactEndpoint(token));
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 409,
      defaultMessage: "Rollback failed",
    });
  }
}
