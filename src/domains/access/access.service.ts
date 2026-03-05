import type { AuthorizeContext } from "./types";
import { normalizeHeaderMap } from "../../contracts/contracts";
import { loadConfig } from "../../config/load-config";
import type { AuthorizeResult, DenyReason } from "./types";
import { isOriginAllowed } from "./policies/origin-allowlist";
import { isValidMethod, isValidRequestPath } from "./policies/request-shape-validator";
import { checkRateLimit } from "./policies/rate-limit";
import { buildCorsHeaders as buildCors } from "./policies/cors-headers";
import { getProjectPolicy, resolveProjectIdentity } from "../projects/projects.service";
import { consumeRequestUnit } from "../metering/metering.service";
import type { ProjectPolicy } from "../projects/types";

export function resolveAllowedOrigins(
  input: Pick<AuthorizeContext, "headers" | "rawToken">,
): readonly string[] {
  const config = loadConfig();
  const headers = normalizeHeaderMap(input.headers);
  const authHeader = headers.authorization;
  const tokenCandidate = (input.rawToken ?? headers["x-api-token"]) ?? authHeader;
  const projectIdentity = resolveProjectIdentity({ rawToken: tokenCandidate });
  if (!projectIdentity) {
    return config.security.allowedOrigins;
  }
  try {
    const projectPolicy = getProjectPolicy(projectIdentity.projectId);
    return projectPolicy.allowedOrigins ?? config.security.allowedOrigins;
  } catch {
    return config.security.allowedOrigins;
  }
}

export function authorizeTileRequest(input: AuthorizeContext): AuthorizeResult {
  const config = loadConfig();
  const method = input.method;
  const headers = normalizeHeaderMap(input.headers);
  const origin = headers.origin;
  const authHeader = headers.authorization;
  const tokenCandidate = (input.rawToken ?? headers["x-api-token"]) ?? authHeader;
  const projectIdentity = resolveProjectIdentity({ rawToken: tokenCandidate });
  const resolvedIdentity = projectIdentity ? `${projectIdentity.projectId}:${projectIdentity.keyIdHash}` : "anon";
  let projectPolicy: ProjectPolicy | undefined;
  let allowedOrigins: readonly string[] = config.security.allowedOrigins;
  if (projectIdentity) {
    try {
      projectPolicy = getProjectPolicy(projectIdentity.projectId);
      allowedOrigins = projectPolicy.allowedOrigins ?? config.security.allowedOrigins;
    } catch {
      return {
        allow: false,
        denyReason: "ACCESS_UNAUTHORIZED",
        sanitizedIdentity: resolvedIdentity,
        allowedOrigins: config.security.allowedOrigins,
      };
    }
  }

  function deny(reason: DenyReason): AuthorizeResult {
    return {
      allow: false,
      denyReason: reason,
      sanitizedIdentity: resolvedIdentity,
      allowedOrigins,
    };
  }

  if (!isValidMethod(method)) {
    return deny("ACCESS_BAD_REQUEST");
  }
  if (!isValidRequestPath(input.path)) {
    return deny("ACCESS_BAD_REQUEST");
  }
  if (!isOriginAllowed(origin, allowedOrigins)) {
    return deny("ACCESS_ORIGIN_DENIED");
  }
  let rateLimitRemaining: number | undefined;
  if (config.security.enableRateLimit) {
    const rateLimit = checkRateLimit(
      buildRateLimitClientKey(projectIdentity, input.clientIp),
      config.security.rateLimitMaxRequestsPerMinute,
    );
    if (!rateLimit.allowed) {
      return deny("ACCESS_RATE_LIMITED");
    }
    rateLimitRemaining = rateLimit.remaining;
  }
  if (!projectIdentity) {
    return deny("ACCESS_UNAUTHORIZED");
  }
  const endpointGroup = mapEndpointGroup(input.path);
  if (projectPolicy && !isEndpointAllowed(projectPolicy, endpointGroup)) {
    return deny("ACCESS_UNAUTHORIZED");
  }
  const quota = consumeRequestUnit({
    projectId: projectIdentity.projectId,
    keyHash: projectIdentity.keyHash,
    planId: projectIdentity.planId,
  }, endpointGroup);
  if (!quota.allow) {
    const denyReason = quota.denyReason === "rate_limit" ? "ACCESS_RATE_LIMITED" : "ACCESS_QUOTA_EXCEEDED";
    return {
      allow: false,
      denyReason,
      sanitizedIdentity: resolvedIdentity,
      allowedOrigins,
    };
  }
  return {
    allow: true,
    sanitizedIdentity: resolvedIdentity,
    rateLimitRemaining,
    allowedOrigins,
  };
}

function buildRateLimitClientKey(
  identity: ReturnType<typeof resolveProjectIdentity>,
  clientIp: string | undefined,
): string {
  if (identity) {
    return `auth:${identity.projectId}:${identity.keyIdHash}`;
  }
  const normalizedClientIp = clientIp?.trim();
  if (normalizedClientIp && normalizedClientIp.length > 0) {
    return `anon:${normalizedClientIp}`;
  }
  return "anon:unknown";
}

function mapEndpointGroup(path: string): "tiles" | "raster" | "static" {
  const [withoutQuery] = path.split("?");
  const normalized = (withoutQuery ?? path).replace(/^\/v1\//, "/");
  if (normalized.startsWith("/raster/")) {
    return "raster";
  }
  if (normalized.startsWith("/static/")) {
    return "static";
  }
  return "tiles";
}

function isEndpointAllowed(policy: ProjectPolicy, endpointGroup: "tiles" | "raster" | "static"): boolean {
  if (endpointGroup === "raster") {
    return policy.allowedEndpoints.raster;
  }
  if (endpointGroup === "static") {
    return policy.allowedEndpoints.staticMaps;
  }
  return policy.allowedEndpoints.tiles;
}

export function buildCorsHeaders(input: AuthorizeResult, origin?: string): Record<string, string> {
  const headers = buildCors(input, origin, input.allowedOrigins);
  return headers;
}
