import { authorizeTileRequest, buildCorsHeaders, resolveAllowedOrigins } from "../access/access.service";
import {
  TileApiError,
  TileApiErrorCode,
  type TileRequest,
  type TileResponse,
  type TileMetadataResponse,
} from "./types";
import type { AuthorizeContext, HttpMethod } from "../../contracts/types";
import { resolveArchiveProfile, resolveMetadata, resolveVectorTile } from "../tile-resolver/tile-resolver.service";
import { ResolverError, ResolverErrorCode } from "../tile-resolver/types";
import { buildTileCacheKey } from "./components/cache-key";
import { buildTileHeaders } from "./components/response-headers";
import { loadConfig } from "../../config/load-config";
import { normalizeHeaderMap } from "../../contracts/contracts";

const tilePathRegex = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/;
const metadataPath = "/tiles/metadata";
const healthPath = "/health";

interface HealthPayload {
  readonly status: "ok";
  readonly service: string;
  readonly timestamp: string;
}

function throwTileApiError(code: TileApiErrorCode): never {
  throw new TileApiError(code);
}

function normalizeRequestPath(path: unknown): string {
  if (typeof path !== "string") {
    throwTileApiError(TileApiErrorCode.BAD_REQUEST);
  }
  return path;
}

function encodeJsonError(error: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ error }));
}

function mapAccessStatus(reason?: string): number {
  return reason === "ACCESS_RATE_LIMITED"
    ? 429
    : reason === "ACCESS_QUOTA_EXCEEDED"
      ? 429
    : reason === "ACCESS_ORIGIN_DENIED"
      ? 403
    : reason === "ACCESS_WORKSPACE_SUSPENDED"
      ? 403
    : reason === "ACCESS_PROJECT_REVOKED"
      ? 403
      : reason === "ACCESS_UNAUTHORIZED"
        ? 401
        : 400;
}

function resolveOrigin(input: Record<string, string | undefined>): string | undefined {
  const direct = input.origin;
  if (typeof direct === "string") {
    return direct;
  }
  for (const [key, value] of Object.entries(input)) {
    if (key.toLowerCase() === "origin") {
      return value;
    }
  }
  return undefined;
}

function normalizePath(path: string): string {
  const queryIndex = path.indexOf("?");
  return queryIndex >= 0 ? path.slice(0, queryIndex) : path;
}

function normalizeRuntimeQuery(
  query: TileRequest["query"],
): Readonly<Record<string, string | string[] | undefined>> {
  if (query === undefined) {
    return {};
  }
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    throwTileApiError(TileApiErrorCode.BAD_REQUEST);
  }
  const normalized = new Map<string, string | string[] | undefined>();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || typeof value === "string") {
      normalized.set(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      normalized.set(
        key,
        value.filter((entry): entry is string => typeof entry === "string"),
      );
      continue;
    }
    throwTileApiError(TileApiErrorCode.BAD_REQUEST);
  }
  return Object.fromEntries(normalized);
}

function resolveQuery(path: string, query: TileRequest["query"]): Readonly<Record<string, string | string[] | undefined>> {
  const normalizedQuery = normalizeRuntimeQuery(query);
  const queryIndex = path.indexOf("?");
  if (queryIndex < 0) {
    return normalizedQuery;
  }
  const parsed = new URLSearchParams(path.slice(queryIndex + 1));
  const merged = new Map<string, string | string[] | undefined>();
  for (const [key, value] of parsed.entries()) {
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, value);
      continue;
    }
    if (Array.isArray(existing)) {
      merged.set(key, [...existing, value]);
      continue;
    }
    merged.set(key, [existing, value]);
  }
  for (const [key, value] of Object.entries(normalizedQuery)) {
    if (value === undefined) {
      continue;
    }
    merged.set(key, value);
  }
  return Object.fromEntries(merged);
}

function stripV1Prefix(path: string): string {
  return path.startsWith("/v1/") ? path.slice(3) : path;
}

function buildPreflightHeaders(origin?: string): Record<string, string> {
  return buildCorsHeaders(
    {
      allow: true,
      sanitizedIdentity: "preflight",
      allowedOrigins: undefined,
    },
    origin,
  );
}

const preflightVaryHeader = "origin,access-control-request-method,access-control-request-headers";

function parseTilePath(path: string): { z: number; x: number; y: number } {
  const match = tilePathRegex.exec(path);
  if (!match || match.length !== 4) {
    throwTileApiError(TileApiErrorCode.BAD_COORDINATES);
  }
  const z = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  const maxZoom = 30;
  if (z > maxZoom) {
    throwTileApiError(TileApiErrorCode.BAD_COORDINATES);
  }
  const axisLimit = 2 ** z;
  if (x >= axisLimit || y >= axisLimit) {
    throwTileApiError(TileApiErrorCode.BAD_COORDINATES);
  }
  return { z, x, y };
}

function parseQueryValue(query: TileRequest["query"], key: string): string | undefined {
  const raw = query?.[key];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== "string") {
        continue;
      }
      const normalized = entry.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
    return undefined;
  }
  if (typeof raw !== "string") {
    return raw;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function pickAccessToken(query: TileRequest["query"]): string | undefined {
  return parseQueryValue(query, "access_token") ?? parseQueryValue(query, "token");
}

function assertHeadEnabled(method: HttpMethod, headEnabled: boolean): void {
  if (method === "HEAD" && !headEnabled) {
    throwTileApiError(TileApiErrorCode.HEAD_DISABLED);
  }
}

function assertTileMethod(method: string): void {
  if (method === "GET" || method === "HEAD") {
    return;
  }
  throwTileApiError(TileApiErrorCode.BAD_REQUEST);
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function responseBodyForMethod<T extends string | Uint8Array>(method: HttpMethod, body: T): T | undefined {
  if (method === "HEAD") {
    return undefined;
  }
  return body;
}

function mapTileResolverError(error: ResolverError, headers: Record<string, string>, method: HttpMethod): TileResponse {
  if (error.code === ResolverErrorCode.BAD_COORDINATES) {
    return {
      status: 400,
      body: responseBodyForMethod(method, encodeJsonError(TileApiErrorCode.BAD_COORDINATES)),
      headers,
    };
  }
  if (error.code === ResolverErrorCode.TILE_NOT_FOUND) {
    return {
      status: 404,
      body: responseBodyForMethod(method, encodeJsonError(TileApiErrorCode.NOT_FOUND)),
      headers,
    };
  }
  if (error.code === ResolverErrorCode.ARTIFACT_UNAVAILABLE) {
    return {
      status: 409,
      body: responseBodyForMethod(method, encodeJsonError(TileApiErrorCode.ARTIFACT_UNAVAILABLE)),
      headers,
    };
  }
  return {
    status: 502,
    body: responseBodyForMethod(method, encodeJsonError(TileApiErrorCode.ORIGIN_READ_FAILED)),
    headers,
  };
}

function mapTileApiError(error: TileApiError, headers: Record<string, string>, method: HttpMethod): TileResponse {
  if (error.code === TileApiErrorCode.HEAD_DISABLED) {
    return {
      status: 405,
      body: undefined,
      headers,
    };
  }
  if (error.code === TileApiErrorCode.BAD_REQUEST) {
    return {
      status: 400,
      body: responseBodyForMethod(method, encodeJsonError(TileApiErrorCode.BAD_REQUEST)),
      headers,
    };
  }
  if (error.code === TileApiErrorCode.BAD_COORDINATES) {
    return {
      status: 400,
      body: responseBodyForMethod(method, encodeJsonError(TileApiErrorCode.BAD_COORDINATES)),
      headers,
    };
  }
  if (error.code === TileApiErrorCode.ARTIFACT_UNAVAILABLE) {
    return {
      status: 409,
      body: responseBodyForMethod(method, encodeJsonError(TileApiErrorCode.ARTIFACT_UNAVAILABLE)),
      headers,
    };
  }
  return {
    status: 500,
    body: responseBodyForMethod(method, encodeJsonError(TileApiErrorCode.ORIGIN_READ_FAILED)),
    headers,
  };
}

function mapMetadataResolverError(error: ResolverError, headers: Record<string, string>, method: HttpMethod): TileMetadataResponse {
  if (error.code === ResolverErrorCode.ARTIFACT_UNAVAILABLE) {
    return {
      status: 409,
      body: responseBodyForMethod(method, JSON.stringify({ error: TileApiErrorCode.ARTIFACT_UNAVAILABLE })),
      headers,
    };
  }
  if (error.code === ResolverErrorCode.TILE_NOT_FOUND) {
    return {
      status: 404,
      body: responseBodyForMethod(method, JSON.stringify({ error: TileApiErrorCode.NOT_FOUND })),
      headers,
    };
  }
  return {
    status: 503,
    body: responseBodyForMethod(method, JSON.stringify({ error: TileApiErrorCode.ORIGIN_READ_FAILED })),
    headers,
  };
}

export async function handleTileRequest(input: TileRequest): Promise<TileResponse> {
  const headers = normalizeHeaderMap(input.headers);
  const origin = resolveOrigin(headers);
  let errorHeaders = {
    ...buildPreflightHeaders(origin),
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  try {
    const rawPath = normalizeRequestPath(input.path);
    const path = normalizePath(rawPath);
    const query = resolveQuery(rawPath, input.query);
    const normalizedPath = stripV1Prefix(path);
    if (input.method === "OPTIONS") {
      const allowedOrigins = await resolveAllowedOrigins({
        headers,
        rawToken: pickAccessToken(query),
      });
      const preflightHeaders = buildCorsHeaders(
        {
          allow: true,
          sanitizedIdentity: "preflight",
          allowedOrigins,
        },
        origin,
      );
      try {
        parseTilePath(normalizedPath);
        return {
          status: 204,
          headers: {
            ...preflightHeaders,
            vary: preflightVaryHeader,
          },
        };
      } catch {
        return {
          status: 400,
          body: encodeJsonError(TileApiErrorCode.BAD_COORDINATES),
          headers: {
            ...preflightHeaders,
            "content-type": "application/json",
            "cache-control": "no-store",
            vary: preflightVaryHeader,
          },
        };
      }
    }
    const config = loadConfig();
    assertTileMethod(input.method);
    assertHeadEnabled(input.method, config.tileDeliveryPolicy.headEnabled);
    const auth = await authorizeTileRequest({
      method: input.method,
      path: normalizedPath,
      query,
      headers,
      rawToken: pickAccessToken(query),
    } satisfies AuthorizeContext);
    const cors = buildCorsHeaders(auth, origin);
    errorHeaders = {
      ...cors,
      "content-type": "application/json",
      "cache-control": "no-store",
    };
    if (!auth.allow) {
      const deniedHeaders: Record<string, string> = {
        ...cors,
        "content-type": "application/json",
      };
      if (auth.denyReason === "ACCESS_WORKSPACE_SUSPENDED") {
        deniedHeaders["retry-after"] = "0";
        deniedHeaders["cache-control"] = "no-store";
      }
      return {
        status: mapAccessStatus(auth.denyReason),
        body: responseBodyForMethod(input.method, new TextEncoder().encode(JSON.stringify({ denied: true }))),
        headers: deniedHeaders,
      };
    }
    const coords = parseTilePath(normalizedPath);
    const resolvedTile = await resolveVectorTile({
      z: coords.z,
      x: coords.x,
      y: coords.y,
    });
    const cacheKey = buildTileCacheKey(resolvedTile.artifactId, normalizedPath);
    const responseHeaders = buildTileHeaders(
      input.method,
      cacheKey,
      resolvedTile.etagSeed,
      `public, max-age=${config.tileDeliveryPolicy.cacheTtlSeconds}`,
      resolvedTile.byteLength,
    );
    const bytes = resolvedTile.bytes;
    const body = input.method === "HEAD" ? undefined : bytes;
    return {
      status: 200,
      body,
      headers: {
        ...responseHeaders,
        ...cors,
        "x-tile-request-id": auth.sanitizedIdentity ?? "anon",
        "x-tile-coordinates": `${coords.z},${coords.x},${coords.y}`,
      },
    };
  } catch (error) {
    if (error instanceof ResolverError) {
      return mapTileResolverError(error, errorHeaders, input.method);
    }
    if (error instanceof TileApiError) {
      return mapTileApiError(error, errorHeaders, input.method);
    }
    return {
      status: 500,
      body: responseBodyForMethod(input.method, encodeJsonError(TileApiErrorCode.ORIGIN_READ_FAILED)),
      headers: errorHeaders,
    };
  }
}

export async function handleMetadataRequest(input: TileRequest): Promise<TileMetadataResponse> {
  const headers = normalizeHeaderMap(input.headers);
  const origin = resolveOrigin(headers);
  let errorHeaders = {
    ...buildPreflightHeaders(origin),
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  try {
    const rawPath = normalizeRequestPath(input.path);
    const path = normalizePath(rawPath);
    const query = resolveQuery(rawPath, input.query);
    const normalizedPath = stripV1Prefix(path);
    if (input.method === "OPTIONS") {
      const allowedOrigins = await resolveAllowedOrigins({
        headers,
        rawToken: pickAccessToken(query),
      });
      const preflightHeaders = buildCorsHeaders(
        {
          allow: true,
          sanitizedIdentity: "preflight",
          allowedOrigins,
        },
        origin,
      );
      if (normalizedPath !== metadataPath) {
        return {
          status: 400,
          body: JSON.stringify({ error: TileApiErrorCode.BAD_REQUEST }),
          headers: {
            ...preflightHeaders,
            "content-type": "application/json",
            "cache-control": "no-store",
            vary: preflightVaryHeader,
          },
        };
      }
      return {
        status: 204,
        headers: {
          ...preflightHeaders,
          vary: preflightVaryHeader,
        },
      };
    }
    const config = loadConfig();
    assertTileMethod(input.method);
    assertHeadEnabled(input.method, config.tileDeliveryPolicy.headEnabled);
    const auth = await authorizeTileRequest({
      method: input.method,
      path: normalizedPath,
      query,
      headers,
      rawToken: pickAccessToken(query),
    } satisfies AuthorizeContext);
    const cors = buildCorsHeaders(auth, origin);
    errorHeaders = {
      ...cors,
      "content-type": "application/json",
      "cache-control": "no-store",
    };
    if (!auth.allow) {
      const deniedHeaders: Record<string, string> = {
        ...cors,
        "content-type": "application/json",
      };
      if (auth.denyReason === "ACCESS_WORKSPACE_SUSPENDED") {
        deniedHeaders["retry-after"] = "0";
        deniedHeaders["cache-control"] = "no-store";
      }
      return {
        status: mapAccessStatus(auth.denyReason),
        body: responseBodyForMethod(input.method, JSON.stringify({ denied: true })),
        headers: deniedHeaders,
      };
    }
    if (normalizedPath !== metadataPath) {
      return {
        status: 404,
        body: responseBodyForMethod(input.method, JSON.stringify({ error: TileApiErrorCode.NOT_FOUND })),
        headers: {
          ...cors,
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      };
    }
    const metadata = await resolveMetadata();
    let archiveProfile = null;
    try {
      archiveProfile = await resolveArchiveProfile();
    } catch {
      archiveProfile = null;
    }
    const serialized = JSON.stringify({
      ...metadata,
      archiveProfile,
    });
    const metadataLength = byteLengthUtf8(serialized);
    if (input.method === "HEAD") {
      return {
        status: 200,
        headers: {
          ...cors,
          "content-type": "application/json",
          "cache-control": `public, max-age=${config.tileDeliveryPolicy.metadataCacheTtlSeconds}`,
          "content-length": String(metadataLength),
          etag: metadata.etagSeed,
          vary: "origin",
        },
      };
    }
    const body = serialized;
    return {
      status: 200,
      body,
      headers: {
        ...cors,
        "content-type": "application/json",
        "cache-control": `public, max-age=${config.tileDeliveryPolicy.metadataCacheTtlSeconds}`,
        "content-length": String(metadataLength),
        etag: metadata.etagSeed,
        vary: "origin",
      },
    };
  } catch (error) {
    if (error instanceof ResolverError) {
      return mapMetadataResolverError(error, errorHeaders, input.method);
    }
    if (error instanceof TileApiError) {
      if (error.code === TileApiErrorCode.BAD_REQUEST) {
        return {
          status: 400,
          body: responseBodyForMethod(input.method, JSON.stringify({ error: TileApiErrorCode.BAD_REQUEST })),
          headers: errorHeaders,
        };
      }
      if (error.code === TileApiErrorCode.HEAD_DISABLED) {
        return {
          status: 405,
          body: undefined,
          headers: errorHeaders,
        };
      }
    }
    return {
      status: 503,
      body: responseBodyForMethod(input.method, JSON.stringify({ error: TileApiErrorCode.ORIGIN_READ_FAILED })),
      headers: errorHeaders,
    };
  }
}

export async function handleHealthRequest(input: TileRequest): Promise<TileResponse> {
  const errorHeaders = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  try {
    const path = normalizePath(normalizeRequestPath(input.path));
    const normalizedPath = stripV1Prefix(path);
    if (normalizedPath !== healthPath && normalizedPath !== `${healthPath}/`) {
      throwTileApiError(TileApiErrorCode.HEALTH_NOT_FOUND);
    }
    if (input.method === "OPTIONS") {
      return {
        status: 204,
        headers: {
          allow: "GET,HEAD,OPTIONS",
          "cache-control": "public, max-age=60",
        },
      };
    }
    if (input.method !== "GET" && input.method !== "HEAD") {
      throwTileApiError(TileApiErrorCode.HEALTH_BAD_REQUEST);
    }
    const config = loadConfig();
    assertHeadEnabled(input.method, config.tileDeliveryPolicy.headEnabled);
    const payload: HealthPayload = {
      status: "ok",
      service: "tileserver",
      timestamp: new Date().toISOString(),
    };
    const serializedPayload = JSON.stringify(payload);
    const contentLength = String(byteLengthUtf8(serializedPayload));
    if (input.method === "HEAD") {
      return {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "content-length": contentLength,
        },
      };
    }
    return {
      status: 200,
      body: new TextEncoder().encode(serializedPayload),
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "content-length": contentLength,
      },
    };
  } catch (error) {
    if (error instanceof TileApiError) {
      if (error.code === TileApiErrorCode.BAD_REQUEST) {
        return {
          status: 400,
          body: responseBodyForMethod(input.method, encodeJsonError(TileApiErrorCode.HEALTH_BAD_REQUEST)),
          headers: errorHeaders,
        };
      }
      if (error.code === TileApiErrorCode.HEALTH_NOT_FOUND) {
        return {
          status: 404,
          body: responseBodyForMethod(input.method, encodeJsonError(TileApiErrorCode.HEALTH_NOT_FOUND)),
          headers: errorHeaders,
        };
      }
      if (error.code === TileApiErrorCode.HEALTH_BAD_REQUEST) {
        return {
          status: 400,
          body: responseBodyForMethod(input.method, encodeJsonError(TileApiErrorCode.HEALTH_BAD_REQUEST)),
          headers: errorHeaders,
        };
      }
      if (error.code === TileApiErrorCode.HEAD_DISABLED) {
        return {
          status: 405,
          body: undefined,
          headers: errorHeaders,
        };
      }
    }
    return {
      status: 500,
      body: responseBodyForMethod(input.method, encodeJsonError(TileApiErrorCode.HEALTH_UNAVAILABLE)),
      headers: errorHeaders,
    };
  }
}
