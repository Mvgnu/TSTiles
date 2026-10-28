import { listAuditEventsEndpoint } from "../control-plane.service";
import { isAuthorized } from "../auth/admin-auth";
import {
  adminErrorResponse,
  adminJsonResponse,
  type AdminRouteResponse,
  unauthorizedAdminResponse,
} from "./response";

function parseLimit(value: string | undefined): number {
  if (typeof value !== "string") {
    return 100;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 100;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return 100;
  }
  return parsed;
}

export async function adminListAuditEventsRoute(
  token: string,
  query?: Readonly<Record<string, string | undefined>>,
): Promise<AdminRouteResponse> {
  if (!(await isAuthorized(token))) {
    return unauthorizedAdminResponse();
  }
  try {
    const limit = parseLimit(query?.limit);
    const events = await listAuditEventsEndpoint(token, limit);
    return adminJsonResponse(200, events);
  } catch (error) {
    return adminErrorResponse(error, {
      defaultStatus: 503,
      defaultMessage: "Failed to list audit events",
    });
  }
}
