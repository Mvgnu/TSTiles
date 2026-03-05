import { loadConfig } from "../../../config/load-config";

export function normalizeAdminToken(adminToken: string | undefined): string | undefined {
  if (!adminToken) {
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

export function isAuthorized(adminToken?: string): boolean {
  const config = loadConfig();
  const normalized = normalizeAdminToken(adminToken);
  if (!normalized) {
    return false;
  }
  return normalized === config.security.adminToken;
}
