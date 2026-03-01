import { loadConfig } from "../../../config/load-config";

export function isAuthorized(adminToken?: string): boolean {
  const config = loadConfig();
  if (!adminToken) {
    return false;
  }
  const trimmed = adminToken.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const normalized = trimmed.toLowerCase().startsWith("bearer ")
    ? trimmed.slice(7).trim()
    : trimmed;
  if (normalized.length === 0) {
    return false;
  }
  return normalized === config.security.adminToken;
}
