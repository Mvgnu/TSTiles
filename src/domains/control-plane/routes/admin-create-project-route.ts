import { createProjectEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import type { ProjectCreationInput } from "../../projects/types";
import {
  adminErrorResponse,
  adminJsonResponse,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

export async function adminCreateProjectRoute(token: string, input: ProjectCreationInput): Promise<AdminRouteResponse> {
  if (!isAuthorized(token)) {
    return unauthorizedAdminResponse();
  }
  try {
    const body = createProjectEndpoint(input, token);
    return adminJsonResponse(201, body);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 400,
      defaultMessage: "Project creation failed",
    });
  }
}
