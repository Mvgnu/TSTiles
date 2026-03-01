import { authorizeTileRequest, buildCorsHeaders } from "../access/access.service";
import type { TileRequest, TileResponse, TileMetadataResponse } from "./types";
import type { AuthorizeContext, HttpMethod } from "../../contracts/types";
import { ArtifactError } from "../artifact/types";
import { resolveMetadata, resolveVectorTile } from "../tile-resolver/tile-resolver.service";
import { buildTileCacheKey } from "./components/cache-key";
import { buildTileHeaders } from "./components/response-headers";
import { loadConfig } from "../../config/load-config";
import { StorageError, StorageErrorCode } from "../storage/types";
import { normalizeHeaderMap } from "../../contracts/contracts";

const tilePathRegex = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/;
const metadataPath = "/tiles/metadata";
const healthPath = "/health";

interface HealthPayload {
  readonly status: "ok";
  readonly service: string;
  readonly timestamp: string;
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
    throw new Error("TILE_BAD_COORDINATES");
  }
  const z = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  const maxZoom = 30;
  if (z > maxZoom) {
    throw new Error("TILE_BAD_COORDINATES");
  }
  const axisLimit = 2 ** z;
  if (x >= axisLimit || y >= axisLimit) {
    throw new Error("TILE_BAD_COORDINATES");
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
    throw new Error("HEAD_DISABLED");
  }
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function handleTileRequest(input: TileRequest): Promise<TileResponse> {
  const path = normalizePath(input.path);
  const headers = normalizeHeaderMap(input.headers as Record<string, string | undefined>);
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
          body: encodeJsonError("TILE_BAD_COORDINATES"),
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
    if (error instanceof ArtifactError) {
      if (error.code === "ARTIFACT_NOT_FOUND") {
        return {
          status: 404,
          body: encodeJsonError("TILE_NOT_FOUND"),
          headers: errorHeaders,
        };
      }
      if (error.code === "ARTIFACT_NOT_VALIDATED") {
        return {
          status: 409,
          body: encodeJsonError("TILE_ARTIFACT_UNAVAILABLE"),
          headers: errorHeaders,
        };
      }
    }
    const message = (error as Error).message;
    if (message === "TILE_BAD_COORDINATES") {
      return {
        status: 400,
        body: encodeJsonError(message),
        headers: errorHeaders,
      };
    }
    if (message === "TILE_ARTIFACT_UNAVAILABLE") {
      return {
        status: 409,
        body: encodeJsonError(message),
        headers: errorHeaders,
      };
    }
    if (error instanceof StorageError && error.code === StorageErrorCode.NOT_FOUND) {
      return {
        status: 404,
        body: encodeJsonError("TILE_NOT_FOUND"),
        headers: errorHeaders,
      };
    }
    if (error instanceof StorageError && error.code === StorageErrorCode.RANGE_INVALID) {
      return {
        status: 416,
        body: encodeJsonError(message),
        headers: errorHeaders,
      };
    }
    if (error instanceof StorageError && error.code === StorageErrorCode.PRECONDITION_FAILED) {
      return {
        status: 409,
        body: encodeJsonError("TILE_ARTIFACT_UNAVAILABLE"),
        headers: errorHeaders,
      };
    }
    if (error instanceof StorageError && error.code === StorageErrorCode.TIMEOUT) {
      return {
        status: 503,
        body: encodeJsonError("TILE_ORIGIN_READ_FAILED"),
        headers: errorHeaders,
      };
    }
    if (error instanceof StorageError) {
      return {
        status: 502,
        body: encodeJsonError("TILE_ORIGIN_READ_FAILED"),
        headers: errorHeaders,
      };
    }
    if (message === "RESOLVER_BAD_COORDINATES") {
      return {
        status: 400,
        body: encodeJsonError("TILE_BAD_COORDINATES"),
        headers: errorHeaders,
      };
    }
    if (message === "RESOLVER_TILE_NOT_FOUND") {
      return {
        status: 404,
        body: encodeJsonError("TILE_NOT_FOUND"),
        headers: errorHeaders,
      };
    }
    if (message === "RESOLVER_ARTIFACT_UNAVAILABLE") {
      return {
        status: 409,
        body: encodeJsonError("TILE_ARTIFACT_UNAVAILABLE"),
        headers: errorHeaders,
      };
    }
    if (message === "RESOLVER_ORIGIN_READ_FAILED") {
      return {
        status: 502,
        body: encodeJsonError("TILE_ORIGIN_READ_FAILED"),
        headers: errorHeaders,
      };
    }
    if (message === "HEAD_DISABLED") {
      return {
        status: 405,
        body: encodeJsonError("HEAD_DISABLED"),
        headers: errorHeaders,
      };
    }
    if (message === "TILE_NOT_FOUND") {
      return {
        status: 404,
        body: encodeJsonError(message),
        headers: errorHeaders,
      };
    }
    return {
      status: 500,
      body: encodeJsonError("TILE_ORIGIN_READ_FAILED"),
      headers: errorHeaders,
    };
  }
}

export async function handleMetadataRequest(input: TileRequest): Promise<TileMetadataResponse> {
  const path = normalizePath(input.path);
  const headers = normalizeHeaderMap(input.headers as Record<string, string | undefined>);
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
          body: JSON.stringify({ error: "TILE_BAD_COORDINATES" }),
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
    if (input.method === "HEAD" && !config.tileDeliveryPolicy.headEnabled) {
      return {
        status: 405,
        body: JSON.stringify({ error: "HEAD_DISABLED" }),
        headers: errorHeaders,
      };
    }
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
        body: JSON.stringify({ error: "TILE_NOT_FOUND" }),
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
    if (error instanceof ArtifactError) {
      if (error.code === "ARTIFACT_NOT_FOUND") {
        return {
          status: 404,
          body: JSON.stringify({ error: "TILE_NOT_FOUND" }),
          headers: errorHeaders,
        };
      }
      if (error.code === "ARTIFACT_NOT_VALIDATED") {
        return {
          status: 409,
          body: JSON.stringify({ error: "TILE_ARTIFACT_UNAVAILABLE" }),
          headers: errorHeaders,
        };
      }
    }
    if (error instanceof StorageError && error.code === StorageErrorCode.NOT_FOUND) {
      return {
        status: 404,
        body: JSON.stringify({ error: "TILE_NOT_FOUND" }),
        headers: errorHeaders,
      };
    }
    if (error instanceof StorageError && error.code === StorageErrorCode.RANGE_INVALID) {
      return {
        status: 416,
        body: JSON.stringify({ error: error.message }),
        headers: errorHeaders,
      };
    }
    if (error instanceof StorageError) {
      return {
        status: 503,
        body: JSON.stringify({ error: "TILE_ORIGIN_READ_FAILED" }),
        headers: errorHeaders,
      };
    }
    const message = (error as Error).message;
    if (message === "RESOLVER_ARTIFACT_UNAVAILABLE") {
      return {
        status: 409,
        body: JSON.stringify({ error: "TILE_ARTIFACT_UNAVAILABLE" }),
        headers: errorHeaders,
      };
    }
    return {
      status: 503,
      body: JSON.stringify({ error: "TILE_ORIGIN_READ_FAILED" }),
      headers: errorHeaders,
    };
  }
}

export async function handleHealthRequest(input: TileRequest): Promise<TileResponse> {
  const path = normalizePath(input.path);
  try {
    const normalizedPath = stripV1Prefix(path);
    if (normalizedPath !== healthPath && normalizedPath !== `${healthPath}/`) {
      return {
        status: 404,
        body: encodeJsonError("HEALTH_NOT_FOUND"),
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      };
    }
    if (input.method !== "GET" && input.method !== "HEAD") {
      return {
        status: 400,
        body: encodeJsonError("HEALTH_BAD_REQUEST"),
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      };
    }
    const config = loadConfig();
    if (input.method === "HEAD" && !config.tileDeliveryPolicy.headEnabled) {
      return {
        status: 405,
        body: encodeJsonError("HEAD_DISABLED"),
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      };
    }
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
  } catch {
    return {
      status: 500,
      body: encodeJsonError("HEALTH_UNAVAILABLE"),
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
}
