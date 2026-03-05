import { loadConfig } from "../../../config/load-config";
import type { AuthorizeResult } from "../types";
import { isOriginAllowed } from "./origin-allowlist";

export function buildCorsHeaders(
  input: AuthorizeResult,
  origin?: string,
  allowedOrigins?: readonly string[],
): Record<string, string> {
  const config = loadConfig();
  const policyAllowedOrigins = allowedOrigins ?? config.security.allowedOrigins;
  const allowAnyOrigin = policyAllowedOrigins.includes("*");
  const isAllowedOrigin = !origin
    ? true
    : allowAnyOrigin || isOriginAllowed(origin, policyAllowedOrigins);
  const allowOrigin = allowAnyOrigin
    ? "*"
    : !origin
      ? "*"
      : isAllowedOrigin
        ? origin
        : "null";
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-origin": allowOrigin,
    "access-control-max-age": String(config.security.corsMaxAgeSeconds),
    vary: "origin",
  };
  if (!input.allow) {
    headers["access-control-allow-origin"] = allowOrigin;
    headers["access-control-allow-methods"] = "GET,HEAD,OPTIONS";
    headers["access-control-allow-headers"] = "authorization,content-type";
    headers["cache-control"] = "no-store";
    return headers;
  }
  if (config.security.corsAllowCredentials && allowOrigin !== "*") {
    headers["access-control-allow-credentials"] = "true";
  }
  return headers;
}
