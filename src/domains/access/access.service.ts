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
import { prisma } from "../../config/db";

function normalizeRequestPath(path: unknown): string | undefined {
  if (typeof path !== "string") {
    return undefined;
  }
  return path;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isValidAllowedOriginsList(value: unknown): value is readonly string[] {
  return isStringArray(value) && value.every((entry) => entry.trim().length > 0);
}

function buildRestrictiveCorsHeaders(): Record<string, string> {
  const config = loadConfig();
  return {
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-api-token",
    "access-control-allow-origin": "null",
    "access-control-max-age": String(config.security.corsMaxAgeSeconds),
    "cache-control": "no-store",
    vary: "origin",
  };
}

function readHeader(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const direct = headers[name];
  if (typeof direct === "string") {
    return direct;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function readQueryToken(
  query: Readonly<Record<string, string | string[] | undefined>> | undefined,
): { readonly token?: string; readonly malformed: boolean } {
  if (!query) {
    return { malformed: false };
  }
  for (const key of ["access_token", "token"] as const) {
    const rawValue = query[key];
    if (typeof rawValue === "string") {
      const normalized = rawValue.trim();
      if (normalized.length > 0) {
        return { token: normalized, malformed: false };
      }
      continue;
    }
    if (Array.isArray(rawValue)) {
      for (const entry of rawValue) {
        if (typeof entry !== "string") {
          continue;
        }
        const normalized = entry.trim();
        if (normalized.length > 0) {
          return { token: normalized, malformed: false };
        }
      }
      continue;
    }
    if (rawValue !== undefined) {
      return { malformed: true };
    }
  }
  return { malformed: false };
}

export async function resolveAllowedOrigins(
  input: Pick<AuthorizeContext, "headers" | "rawToken"> & { readonly query?: AuthorizeContext["query"] },
): Promise<readonly string[]> {
  const config = loadConfig();
  const headers = normalizeHeaderMap(input.headers);
  const authHeader = headers.authorization;
  const queryToken = readQueryToken(input.query);
  if (queryToken.malformed) {
    return config.security.allowedOrigins;
  }
  const tokenCandidate = input.rawToken ?? queryToken.token ?? readHeader(headers, "x-api-token") ?? authHeader;
  const projectIdentity = await resolveProjectIdentity({ rawToken: tokenCandidate });
  if (!projectIdentity) {
    return config.security.allowedOrigins;
  }
  try {
    const projectPolicy = await getProjectPolicy(projectIdentity.projectId);
    return projectPolicy.allowedOrigins ?? config.security.allowedOrigins;
  } catch {
    return config.security.allowedOrigins;
  }
}

export async function authorizeTileRequest(input: AuthorizeContext): Promise<AuthorizeResult> {
  const config = loadConfig();
  const method = input.method;
  const path = normalizeRequestPath(input.path);
  const headers = normalizeHeaderMap(input.headers);
  const origin = headers.origin;
  const authHeader = headers.authorization;
  const queryToken = readQueryToken(input.query);
  if (queryToken.malformed) {
    return {
      allow: false,
      denyReason: "ACCESS_BAD_REQUEST",
      sanitizedIdentity: "anon",
      allowedOrigins: config.security.allowedOrigins,
    };
  }
  const tokenCandidate = input.rawToken ?? queryToken.token ?? readHeader(headers, "x-api-token") ?? authHeader;
  const projectIdentity = await resolveProjectIdentity({ rawToken: tokenCandidate });
  const resolvedIdentity = projectIdentity ? `${projectIdentity.projectId}:${projectIdentity.keyIdHash}` : "anon";
  let projectPolicy: ProjectPolicy | undefined;
  let allowedOrigins: readonly string[] = config.security.allowedOrigins;
  if (projectIdentity) {
    try {
      projectPolicy = await getProjectPolicy(projectIdentity.projectId);
      allowedOrigins = projectPolicy.allowedOrigins ?? config.security.allowedOrigins;

      const workspace = await prisma.identityWorkspace.findUnique({
        where: { id: projectIdentity.workspaceId },
        select: { suspendedAt: true, deletedAt: true },
      });
      if (workspace) {
        if (workspace.deletedAt) {
          return {
            allow: false,
            denyReason: "ACCESS_PROJECT_REVOKED",
            sanitizedIdentity: resolvedIdentity,
            allowedOrigins,
          };
        }
        if (workspace.suspendedAt) {
          return {
            allow: false,
            denyReason: "ACCESS_WORKSPACE_SUSPENDED",
            sanitizedIdentity: resolvedIdentity,
            allowedOrigins,
          };
        }
      }
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
  if (!path || !isValidRequestPath(path)) {
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
  const endpointGroup = mapEndpointGroup(path);
  if (projectPolicy && !isEndpointAllowed(projectPolicy, endpointGroup)) {
    return deny("ACCESS_UNAUTHORIZED");
  }
  const quota = await consumeRequestUnit({
    projectId: projectIdentity.projectId,
    keyHash: projectIdentity.keyHash,
    planId: projectIdentity.planId,
  }, endpointGroup);
  if (!quota.allow) {
    const denyReason = quota.denyReason === "workspace_suspended"
      ? "ACCESS_WORKSPACE_SUSPENDED"
      : quota.denyReason === "rate_limit"
        ? "ACCESS_RATE_LIMITED"
        : "ACCESS_QUOTA_EXCEEDED";
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
  identity: Awaited<ReturnType<typeof resolveProjectIdentity>>,
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
  if (typeof input !== "object" || input === null || typeof input.allow !== "boolean") {
    return buildRestrictiveCorsHeaders();
  }
  if (origin !== undefined && typeof origin !== "string") {
    return buildRestrictiveCorsHeaders();
  }
  if (input.allowedOrigins !== undefined && !isValidAllowedOriginsList(input.allowedOrigins)) {
    return buildRestrictiveCorsHeaders();
  }
  const headers = buildCors(input, origin, input.allowedOrigins);
  return headers;
}
