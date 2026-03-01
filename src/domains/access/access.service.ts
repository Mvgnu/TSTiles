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
import type { ProjectIdentity } from "../projects/types";
import type { ProjectPolicy } from "../projects/types";

export function authorizeTileRequest(input: AuthorizeContext): AuthorizeResult {
  const config = loadConfig();
  const method = input.method;
  const headers = normalizeHeaderMap(input.headers as Record<string, string | undefined>);
  const origin = headers.origin;
  const authHeader = headers.authorization;
  const tokenCandidate = (input.rawToken ?? headers["x-api-token"]) ?? authHeader;
  const projectIdentity = resolveProjectIdentity({ rawToken: tokenCandidate }) as ProjectIdentity | null;
  const resolvedIdentity = projectIdentity ? `${projectIdentity.projectId}:${projectIdentity.keyIdHash}` : "anon";
  const projectPolicy = projectIdentity ? getProjectPolicy(projectIdentity.projectId) : undefined;
  const allowedOrigins = projectPolicy?.allowedOrigins ?? config.security.allowedOrigins;

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
  if (!projectIdentity) {
    return deny("ACCESS_UNAUTHORIZED");
  }
  const endpointGroup = mapEndpointGroup(input.path);
  if (projectPolicy && !isEndpointAllowed(projectPolicy, endpointGroup)) {
    return deny("ACCESS_UNAUTHORIZED");
  }
  let rateLimitRemaining: number | undefined;
  if (config.security.enableRateLimit) {
    const rateLimit = checkRateLimit(
      input.clientIp ?? projectIdentity.keyId,
      config.security.rateLimitMaxRequestsPerMinute,
    );
    if (!rateLimit.allowed) {
      return deny("ACCESS_RATE_LIMITED");
    }
    rateLimitRemaining = rateLimit.remaining;
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
