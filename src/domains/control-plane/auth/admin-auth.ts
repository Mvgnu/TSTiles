import { loadConfig } from "../../../config/load-config";
import { requireOperatorSession } from "../../identity/identity.service";

export function normalizeAdminToken(adminToken: unknown): string | undefined {
  if (typeof adminToken !== "string") {
    return undefined;
  }
  const trimmed = adminToken.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const normalized = trimmed.toLowerCase().startsWith("bearer ")
    ? trimmed.slice(7).trim()
    : trimmed;
  return normalized.length > 0 ? normalized : undefined;
}

export async function isAuthorized(
  adminToken?: unknown,
  headers?: Readonly<Record<string, string | undefined>>
): Promise<boolean> {
  const config = loadConfig();
  const normalized = normalizeAdminToken(adminToken);
  if (normalized && normalized === config.security.adminToken) {
    return true;
  }

  const headersToUse = headers || (normalized ? { "x-session-token": normalized } : {});
  try {
    const session = await requireOperatorSession(headersToUse);
    return !!session;
  } catch {
    return false;
  }
}

