import { normalizeHeaderMap } from "../../contracts/contracts";
import { loadConfig } from "../../config/load-config";
import type { AuthorizeContext } from "../../contracts/types";
import { authorizeTileRequest, buildCorsHeaders } from "../access/access.service";
import { renderRasterTile, renderStaticMap } from "../render/render.service";
import type { RasterRequest, RasterResponse } from "./types";
import type { RasterTileRequest, StaticMapRequest } from "../render/types";
import type { RenderedImage } from "../render/types";

interface RasterPathMatch {
  readonly styleId: string;
  readonly format: "png" | "webp";
  readonly request:
    | {
        readonly kind: "raster";
        readonly z: number;
        readonly x: number;
        readonly y: number;
      }
    | {
        readonly kind: "static";
        readonly lon: number;
        readonly lat: number;
        readonly zoom: number;
        readonly width: number;
        readonly height: number;
      };
}

const rasterPathRegex = /^\/(?:v1\/)?raster\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(png|webp)$/;
const staticPathRegex = /^\/(?:v1\/)?static\/([^/]+)\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\/(\d+)x(\d+)\.(png|webp)$/;
const maxStaticDimension = 4096;
const maxStaticZoom = 30;

function encodeJsonError(message: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ error: message }));
}

function parseQueryValue(query: RasterRequest["query"], key: string): string | undefined {
  const raw = query?.[key];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

function pickAccessToken(query: RasterRequest["query"]): string | undefined {
  return parseQueryValue(query, "access_token") ?? parseQueryValue(query, "token");
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? path;
}

function stripV1Prefix(path: string): string {
  return path.startsWith("/v1/") ? path.slice(3) : path;
}

function normalizeOrigin(headers: Record<string, string | undefined>): string | undefined {
  return headers.origin ?? headers.Origin;
}

function toNumber(value: string): number {
  const converted = Number(value);
  if (!Number.isFinite(converted)) {
    throw new Error("RASTER_BAD_COORDINATES");
  }
  return converted;
}

function toInteger(value: string): number {
  const converted = Number(value);
  if (!Number.isFinite(converted) || !Number.isInteger(converted) || converted < 0) {
    throw new Error("RASTER_BAD_COORDINATES");
  }
  return converted;
}

function assertHeadEnabled(method: RasterRequest["method"], headEnabled: boolean): void {
  if (method === "HEAD" && !headEnabled) {
    throw new Error("HEAD_DISABLED");
  }
}

function assertRasterTileCoordinates(z: number, x: number, y: number): void {
  const maxZoom = 30;
  if (z > maxZoom) {
    throw new Error("RASTER_BAD_COORDINATES");
  }
  const maxIndex = 2 ** z;
  if (x >= maxIndex || y >= maxIndex) {
    throw new Error("RASTER_BAD_COORDINATES");
  }
}

function assertStaticRequestBounds(zoom: number, width: number, height: number): void {
  if (zoom > maxStaticZoom) {
    throw new Error("STATIC_BAD_REQUEST");
  }
  if (width > maxStaticDimension || height > maxStaticDimension) {
    throw new Error("STATIC_BAD_REQUEST");
  }
}

function mapDenyStatus(reason?: string): number {
  return reason === "ACCESS_RATE_LIMITED" || reason === "ACCESS_QUOTA_EXCEEDED" ? 429 : reason === "ACCESS_ORIGIN_DENIED" ? 403 : reason === "ACCESS_UNAUTHORIZED" ? 401 : 400;
}

function parseRasterPath(path: string): RasterPathMatch {
  const normalized = stripV1Prefix(path);
  if (normalized.startsWith("/raster/")) {
    const match = rasterPathRegex.exec(normalized);
    if (!match || match.length !== 6) {
      throw new Error("RASTER_BAD_COORDINATES");
    }
    let styleId: string;
    try {
      styleId = normalizeStyleIdSegment(match[1] ?? "", "RASTER_BAD_COORDINATES");
    } catch {
      throw new Error("RASTER_BAD_COORDINATES");
    }
    return {
      styleId,
      format: (match[5] ?? "png") as "png" | "webp",
      request: (() => {
        const z = toInteger(match[2] ?? "");
        const x = toInteger(match[3] ?? "");
        const y = toInteger(match[4] ?? "");
        assertRasterTileCoordinates(z, x, y);
        return {
          kind: "raster" as const,
          z,
          x,
          y,
        };
      })(),
    };
  }
    if (normalized.startsWith("/static/")) {
      const match = staticPathRegex.exec(normalized);
      if (!match || match.length !== 8) {
        throw new Error("STATIC_BAD_REQUEST");
      }
    let styleId: string;
    try {
      styleId = normalizeStyleIdSegment(match[1] ?? "", "STATIC_BAD_REQUEST");
    } catch {
      throw new Error("STATIC_BAD_REQUEST");
    }
      return {
        styleId,
        format: (match[7] ?? "png") as "png" | "webp",
        request: (() => {
          const zoom = toNumber(match[4] ?? "");
          const width = toInteger(match[5] ?? "");
          const height = toInteger(match[6] ?? "");
          assertStaticRequestBounds(zoom, width, height);
          return {
            kind: "static" as const,
            lon: toNumber(match[2] ?? ""),
            lat: toNumber(match[3] ?? ""),
            zoom,
            width,
            height,
          };
        })(),
      };
  }
  throw new Error("RASTER_BAD_COORDINATES");
}

function normalizeStyleIdSegment(value: string, errorCode: "RASTER_BAD_COORDINATES" | "STATIC_BAD_REQUEST"): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(errorCode);
  }
  const normalized = decoded.trim();
  if (normalized.length === 0 || normalized.includes("/")) {
    throw new Error(errorCode);
  }
  return normalized;
}

function asRenderRequest(match: RasterPathMatch): RasterTileRequest | StaticMapRequest {
  if (match.request.kind === "raster") {
    return {
      styleId: match.styleId,
      z: match.request.z,
      x: match.request.x,
      y: match.request.y,
      format: match.format,
    };
  }
  return {
    styleId: match.styleId,
    lon: match.request.lon,
    lat: match.request.lat,
    zoom: match.request.zoom,
    width: match.request.width,
    height: match.request.height,
    format: match.format,
  };
}

function parseOverlays(query: RasterRequest["query"]): string[] {
  const raw = query?.overlays;
  if (raw === undefined || raw === "") {
    return [];
  }
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function buildHeaders(
  authStatus: { sanitizedIdentity?: string },
  image: RenderedImage,
  cors: Record<string, string>,
  cacheTtlSeconds: number,
): RasterResponse["headers"] {
  return {
    "content-type": image.contentType,
    "content-length": String(image.bytes.byteLength),
    "cache-control": `public, max-age=${cacheTtlSeconds}`,
    vary: "origin",
    "x-raster-cache-key": image.cacheKey,
    "x-raster-request-id": authStatus.sanitizedIdentity ?? "anon",
    "x-raster-source": image.sourcePath,
    ...cors,
  };
}

function isOptions(input: RasterRequest): boolean {
  return input.method === "OPTIONS";
}

function buildPreflightHeaders(origin?: string): RasterResponse["headers"] {
  return buildCorsHeaders(
    {
      allow: true,
      sanitizedIdentity: "preflight",
    },
    origin,
  );
}

function asAuthorizeContext(input: RasterRequest): AuthorizeContext {
  const headers = normalizeHeaderMap(input.headers as Record<string, string | undefined>);
  return {
    method: input.method,
    path: normalizePath(stripV1Prefix(input.path)),
    query: input.query ?? {},
    headers,
    clientIp: input.clientIp,
    rawToken: pickAccessToken(input.query),
  };
}

async function handleRasterRequest(
  input: RasterRequest,
  expectedKind?: "raster" | "static",
): Promise<RasterResponse> {
  const path = normalizePath(input.path);
  const headers = normalizeHeaderMap(input.headers as Record<string, string | undefined>);
  const origin = normalizeOrigin(headers);
  const errorHeaders = {
    ...buildPreflightHeaders(origin),
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (isOptions(input)) {
    try {
      const parsed = parseRasterPath(path);
      if (expectedKind && parsed.request.kind !== expectedKind) {
        throw new Error(expectedKind === "static" ? "STATIC_BAD_REQUEST" : "RASTER_BAD_COORDINATES");
      }
      return {
        status: 204,
        headers: {
          ...buildPreflightHeaders(origin),
          vary: "origin",
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "RASTER_BAD_COORDINATES";
      const mappedMessage = message === "STATIC_BAD_REQUEST" ? "STATIC_BAD_REQUEST" : "RASTER_BAD_COORDINATES";
      return {
        status: 400,
        body: encodeJsonError(mappedMessage),
        headers: errorHeaders,
      };
    }
  }
  try {
    const match = parseRasterPath(path);
    if (expectedKind && match.request.kind !== expectedKind) {
      throw new Error(expectedKind === "static" ? "STATIC_BAD_REQUEST" : "RASTER_BAD_COORDINATES");
    }
    const config = loadConfig();
    assertHeadEnabled(input.method, config.tileDeliveryPolicy.headEnabled);
    const auth = authorizeTileRequest(asAuthorizeContext(input));
    const cors = buildCorsHeaders(auth, origin);
    if (!auth.allow) {
      return {
        status: mapDenyStatus(auth.denyReason),
        body: encodeJsonError("DENIED"),
        headers: {
          ...cors,
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      };
    }
    let image: RenderedImage;
    const request = asRenderRequest(match);
    if (match.request.kind === "raster") {
      image = await renderRasterTile(request as RasterTileRequest);
    } else {
      const staticRequest = request as StaticMapRequest;
      image = await renderStaticMap({
        ...staticRequest,
        overlays: parseOverlays(input.query),
      });
    }
    const headers = buildHeaders(auth, image, cors, config.tileDeliveryPolicy.cacheTtlSeconds);
    if (input.method === "HEAD") {
      return {
        status: 200,
        body: undefined,
        headers,
      };
    }
    return {
      status: 200,
      body: image.bytes,
      headers,
    };
  } catch (error) {
    if ((error as Error).message === "HEAD_DISABLED") {
      return {
        status: 405,
        body: encodeJsonError("HEAD_DISABLED"),
        headers: errorHeaders,
      };
    }
    if (error instanceof Error) {
      const message = error.message;
      if (message === "RASTER_BAD_COORDINATES" || message === "STATIC_BAD_REQUEST") {
        return {
          status: 400,
          body: encodeJsonError(message),
          headers: errorHeaders,
        };
      }
      if (message === "RENDER_STYLE_NOT_FOUND") {
        return {
          status: 404,
          body: encodeJsonError("RASTER_STYLE_NOT_FOUND"),
          headers: errorHeaders,
        };
      }
      if (message === "RENDER_TILE_RESOLVE_FAILED") {
        return {
          status: 502,
          body: encodeJsonError("RASTER_RENDER_FAILED"),
          headers: errorHeaders,
        };
      }
      if (message === "RENDER_BACKEND_UNAVAILABLE") {
        return {
          status: 503,
          body: encodeJsonError("RASTER_RENDER_FAILED"),
          headers: errorHeaders,
        };
      }
      if (message === "RENDER_BAD_REQUEST") {
        return {
          status: 400,
          body: encodeJsonError("RASTER_BAD_REQUEST"),
          headers: errorHeaders,
        };
      }
    }
    return {
      status: 500,
      body: encodeJsonError("RASTER_RENDER_FAILED"),
      headers: errorHeaders,
    };
  }
}

export async function handleRasterTileRequest(input: RasterRequest): Promise<RasterResponse> {
  return handleRasterRequest(input, "raster");
}

export async function handleStaticMapRequest(input: RasterRequest): Promise<RasterResponse> {
  return handleRasterRequest(input, "static");
}
