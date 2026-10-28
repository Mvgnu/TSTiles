import { triggerIngest } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminIngestRoute(token: string): Promise<AdminRouteResponse> {
  if (!(await isAuthorized(token))) {
    return unauthorizedAdminResponse();
  }
  try {
    const job = await triggerIngest(token);
    return adminJsonResponse(202, job);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 503,
      defaultMessage: "Ingest failed",
    });
  }
}
