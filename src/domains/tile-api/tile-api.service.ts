import { authorizeTileRequest, buildCorsHeaders } from "../access/access.service";
import {
  TileApiError,
  TileApiErrorCode,
  type TileRequest,
  type TileResponse,
  type TileMetadataResponse,
} from "./types";
import type { AuthorizeContext, HttpMethod } from "../../contracts/types";
import { resolveMetadata, resolveVectorTile } from "../tile-resolver/tile-resolver.service";
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
      : reason === "ACCESS_UNAUTHORIZED"
        ? 401
        : 400;
}

function resolveOrigin(input: Record<string, string | undefined>): string | undefined {
  return input.origin ?? input.Origin;
}

function normalizePath(path: string): string {
  const queryIndex = path.indexOf("?");
  return queryIndex >= 0 ? path.slice(0, queryIndex) : path;
}

function stripV1Prefix(path: string): string {
  return path.startsWith("/v1/") ? path.slice(3) : path;
}

function buildPreflightHeaders(origin?: string): Record<string, string> {
  return buildCorsHeaders(
    {
      allow: true,
      sanitizedIdentity: "preflight",
    },
    origin,
  );
}

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
    return raw[0];
  }
  return raw;
}

function pickAccessToken(query: TileRequest["query"]): string | undefined {
  return parseQueryValue(query, "access_token") ?? parseQueryValue(query, "token");
}

function assertHeadEnabled(method: HttpMethod, headEnabled: boolean): void {
  if (method === "HEAD" && !headEnabled) {
    throwTileApiError(TileApiErrorCode.HEAD_DISABLED);
  }
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function mapTileResolverError(error: ResolverError, headers: Record<string, string>): TileResponse {
  if (error.code === ResolverErrorCode.BAD_COORDINATES) {
    return {
      status: 400,
      body: encodeJsonError(TileApiErrorCode.BAD_COORDINATES),
      headers,
    };
  }
  if (error.code === ResolverErrorCode.TILE_NOT_FOUND) {
    return {
      status: 404,
      body: encodeJsonError(TileApiErrorCode.NOT_FOUND),
      headers,
    };
  }
  if (error.code === ResolverErrorCode.ARTIFACT_UNAVAILABLE) {
    return {
      status: 409,
      body: encodeJsonError(TileApiErrorCode.ARTIFACT_UNAVAILABLE),
      headers,
    };
  }
  return {
    status: 502,
    body: encodeJsonError(TileApiErrorCode.ORIGIN_READ_FAILED),
    headers,
  };
}

function mapTileApiError(error: TileApiError, headers: Record<string, string>): TileResponse {
  if (error.code === TileApiErrorCode.HEAD_DISABLED) {
    return {
      status: 405,
      body: undefined,
      headers,
    };
  }
  if (error.code === TileApiErrorCode.BAD_COORDINATES) {
    return {
      status: 400,
      body: encodeJsonError(TileApiErrorCode.BAD_COORDINATES),
      headers,
    };
  }
  if (error.code === TileApiErrorCode.ARTIFACT_UNAVAILABLE) {
    return {
      status: 409,
      body: encodeJsonError(TileApiErrorCode.ARTIFACT_UNAVAILABLE),
      headers,
    };
  }
  return {
    status: 500,
    body: encodeJsonError(TileApiErrorCode.ORIGIN_READ_FAILED),
    headers,
  };
}

function mapMetadataResolverError(error: ResolverError, headers: Record<string, string>): TileMetadataResponse {
  if (error.code === ResolverErrorCode.ARTIFACT_UNAVAILABLE) {
    return {
      status: 409,
      body: JSON.stringify({ error: TileApiErrorCode.ARTIFACT_UNAVAILABLE }),
      headers,
    };
  }
  if (error.code === ResolverErrorCode.TILE_NOT_FOUND) {
    return {
      status: 404,
      body: JSON.stringify({ error: TileApiErrorCode.NOT_FOUND }),
      headers,
    };
  }
  return {
    status: 503,
    body: JSON.stringify({ error: TileApiErrorCode.ORIGIN_READ_FAILED }),
    headers,
  };
}

export async function handleTileRequest(input: TileRequest): Promise<TileResponse> {
  const path = normalizePath(input.path);
  const headers = normalizeHeaderMap(input.headers);
  const origin = resolveOrigin(headers);
  const errorHeaders = {
    ...buildPreflightHeaders(origin),
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  try {
    const normalizedPath = stripV1Prefix(path);
    if (input.method === "OPTIONS") {
      try {
        parseTilePath(normalizedPath);
        return {
          status: 204,
          headers: {
            ...buildPreflightHeaders(origin),
            vary: "origin",
          },
        };
      } catch {
        return {
          status: 400,
          body: encodeJsonError(TileApiErrorCode.BAD_COORDINATES),
          headers: errorHeaders,
        };
      }
    }
    const config = loadConfig();
    assertHeadEnabled(input.method, config.tileDeliveryPolicy.headEnabled);
    const auth = authorizeTileRequest({
      method: input.method,
      path: normalizedPath,
      query: input.query ?? {},
      headers,
      rawToken: pickAccessToken(input.query ?? {}),
    } satisfies AuthorizeContext);
    const cors = buildCorsHeaders(auth, origin);
    if (!auth.allow) {
      return {
        status: mapAccessStatus(auth.denyReason),
        body: new TextEncoder().encode(JSON.stringify({ denied: true })),
        headers: {
          ...cors,
          "content-type": "application/json",
        },
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
      return mapTileResolverError(error, errorHeaders);
    }
    if (error instanceof TileApiError) {
      return mapTileApiError(error, errorHeaders);
    }
    return {
      status: 500,
      body: encodeJsonError(TileApiErrorCode.ORIGIN_READ_FAILED),
      headers: errorHeaders,
    };
  }
}

export async function handleMetadataRequest(input: TileRequest): Promise<TileMetadataResponse> {
  const path = normalizePath(input.path);
  const headers = normalizeHeaderMap(input.headers);
  const origin = resolveOrigin(headers);
  const errorHeaders = {
    ...buildPreflightHeaders(origin),
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  try {
    const normalizedPath = stripV1Prefix(path);
    if (input.method === "OPTIONS") {
      if (normalizedPath !== metadataPath) {
        return {
          status: 400,
          body: JSON.stringify({ error: TileApiErrorCode.BAD_COORDINATES }),
          headers: errorHeaders,
        };
      }
      return {
        status: 204,
        headers: {
          ...buildPreflightHeaders(origin),
          vary: "origin",
        },
      };
    }
    const config = loadConfig();
    assertHeadEnabled(input.method, config.tileDeliveryPolicy.headEnabled);
    const auth = authorizeTileRequest({
      method: input.method,
      path: normalizedPath,
      query: input.query ?? {},
      headers,
      rawToken: pickAccessToken(input.query ?? {}),
    } satisfies AuthorizeContext);
    const cors = buildCorsHeaders(auth, origin);
    if (!auth.allow) {
      return {
        status: mapAccessStatus(auth.denyReason),
        body: JSON.stringify({ denied: true }),
        headers: {
          ...cors,
          "content-type": "application/json",
        },
      };
    }
    if (normalizedPath !== metadataPath) {
      return {
        status: 404,
        body: JSON.stringify({ error: TileApiErrorCode.NOT_FOUND }),
        headers: {
          ...cors,
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      };
    }
    const metadata = resolveMetadata();
    const serialized = JSON.stringify(metadata);
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
      return mapMetadataResolverError(error, errorHeaders);
    }
    if (error instanceof TileApiError) {
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
      body: JSON.stringify({ error: TileApiErrorCode.ORIGIN_READ_FAILED }),
      headers: errorHeaders,
    };
  }
}

export async function handleHealthRequest(input: TileRequest): Promise<TileResponse> {
  const path = normalizePath(input.path);
  const errorHeaders = {
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  try {
    const normalizedPath = stripV1Prefix(path);
    if (normalizedPath !== healthPath && normalizedPath !== `${healthPath}/`) {
      throwTileApiError(TileApiErrorCode.HEALTH_NOT_FOUND);
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
      if (error.code === TileApiErrorCode.HEALTH_NOT_FOUND) {
        return {
          status: 404,
          body: encodeJsonError(TileApiErrorCode.HEALTH_NOT_FOUND),
          headers: errorHeaders,
        };
      }
      if (error.code === TileApiErrorCode.HEALTH_BAD_REQUEST) {
        return {
          status: 400,
          body: encodeJsonError(TileApiErrorCode.HEALTH_BAD_REQUEST),
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
      body: encodeJsonError(TileApiErrorCode.HEALTH_UNAVAILABLE),
      headers: errorHeaders,
    };
  }
}
