import { normalizeHeaderMap } from "../../contracts/contracts";
import { loadConfig } from "../../config/load-config";
import type { AuthorizeContext } from "../../contracts/types";
import { authorizeTileRequest, buildCorsHeaders } from "../access/access.service";
import { renderRasterTile, renderStaticMap } from "../render/render.service";
import { RenderError, RenderErrorCode, type RasterTileRequest, type StaticMapRequest, type RenderedImage } from "../render/types";
import { RasterApiError, RasterApiErrorCode, type RasterRequest, type RasterResponse } from "./types";

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
const defaultRenderTimeoutMs = 15_000;

function throwRasterApiError(code: RasterApiErrorCode): never {
  throw new RasterApiError(code);
}

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

function toNumber(value: string, errorCode: RasterApiErrorCode): number {
  const converted = Number(value);
  if (!Number.isFinite(converted)) {
    throwRasterApiError(errorCode);
  }
  return converted;
}

function toInteger(value: string, errorCode: RasterApiErrorCode): number {
  const converted = Number(value);
  if (!Number.isFinite(converted) || !Number.isInteger(converted) || converted < 0) {
    throwRasterApiError(errorCode);
  }
  return converted;
}

function assertHeadEnabled(method: RasterRequest["method"], headEnabled: boolean): void {
  if (method === "HEAD" && !headEnabled) {
    throwRasterApiError(RasterApiErrorCode.HEAD_DISABLED);
  }
}

function assertRasterMethod(method: string): void {
  if (method === "GET" || method === "HEAD") {
    return;
  }
  throwRasterApiError(RasterApiErrorCode.BAD_REQUEST);
}

function assertRasterTileCoordinates(z: number, x: number, y: number): void {
  const maxZoom = 30;
  if (z > maxZoom) {
    throwRasterApiError(RasterApiErrorCode.BAD_COORDINATES);
  }
  const maxIndex = 2 ** z;
  if (x >= maxIndex || y >= maxIndex) {
    throwRasterApiError(RasterApiErrorCode.BAD_COORDINATES);
  }
}

function assertStaticRequestBounds(zoom: number, width: number, height: number): void {
  if (zoom > maxStaticZoom) {
    throwRasterApiError(RasterApiErrorCode.STATIC_BAD_REQUEST);
  }
  if (width > maxStaticDimension || height > maxStaticDimension) {
    throwRasterApiError(RasterApiErrorCode.STATIC_BAD_REQUEST);
  }
}

function assertStaticCoordinates(lon: number, lat: number): void {
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throwRasterApiError(RasterApiErrorCode.STATIC_BAD_REQUEST);
  }
}

function mapDenyStatus(reason?: string): number {
  return reason === "ACCESS_RATE_LIMITED" || reason === "ACCESS_QUOTA_EXCEEDED" ? 429 : reason === "ACCESS_ORIGIN_DENIED" ? 403 : reason === "ACCESS_UNAUTHORIZED" ? 401 : 400;
}

function renderTimeoutMs(): number {
  const raw = process.env.RENDER_TIMEOUT_MS;
  if (raw === undefined) {
    return defaultRenderTimeoutMs;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return defaultRenderTimeoutMs;
  }
  return parsed;
}

function parseFormat(
  value: string | undefined,
  errorCode: RasterApiErrorCode.BAD_COORDINATES | RasterApiErrorCode.STATIC_BAD_REQUEST,
): "png" | "webp" {
  if (value === "png" || value === "webp") {
    return value;
  }
  throwRasterApiError(errorCode);
}

function buildRasterRequest(match: RegExpExecArray, styleId: string): RasterPathMatch {
  const z = toInteger(match[2] ?? "", RasterApiErrorCode.BAD_COORDINATES);
  const x = toInteger(match[3] ?? "", RasterApiErrorCode.BAD_COORDINATES);
  const y = toInteger(match[4] ?? "", RasterApiErrorCode.BAD_COORDINATES);
  assertRasterTileCoordinates(z, x, y);
  return {
    styleId,
    format: parseFormat(match[5], RasterApiErrorCode.BAD_COORDINATES),
    request: {
      kind: "raster",
      z,
      x,
      y,
    },
  };
}

function buildStaticRequest(match: RegExpExecArray, styleId: string): RasterPathMatch {
  const lon = toNumber(match[2] ?? "", RasterApiErrorCode.STATIC_BAD_REQUEST);
  const lat = toNumber(match[3] ?? "", RasterApiErrorCode.STATIC_BAD_REQUEST);
  const zoom = toNumber(match[4] ?? "", RasterApiErrorCode.STATIC_BAD_REQUEST);
  const width = toInteger(match[5] ?? "", RasterApiErrorCode.STATIC_BAD_REQUEST);
  const height = toInteger(match[6] ?? "", RasterApiErrorCode.STATIC_BAD_REQUEST);
  assertStaticCoordinates(lon, lat);
  assertStaticRequestBounds(zoom, width, height);
  return {
    styleId,
    format: parseFormat(match[7], RasterApiErrorCode.STATIC_BAD_REQUEST),
    request: {
      kind: "static",
      lon,
      lat,
      zoom,
      width,
      height,
    },
  };
}

function parseRasterPath(path: string): RasterPathMatch {
  const normalized = stripV1Prefix(path);
  if (normalized.startsWith("/raster/")) {
    const match = rasterPathRegex.exec(normalized);
    if (!match || match.length !== 6) {
      throwRasterApiError(RasterApiErrorCode.BAD_COORDINATES);
    }
    let styleId: string;
    try {
      styleId = normalizeStyleIdSegment(match[1] ?? "", RasterApiErrorCode.BAD_COORDINATES);
    } catch {
      throwRasterApiError(RasterApiErrorCode.BAD_COORDINATES);
    }
    return buildRasterRequest(match, styleId);
  }
  if (normalized.startsWith("/static/")) {
    const match = staticPathRegex.exec(normalized);
    if (!match || match.length !== 8) {
      throwRasterApiError(RasterApiErrorCode.STATIC_BAD_REQUEST);
    }
    let styleId: string;
    try {
      styleId = normalizeStyleIdSegment(match[1] ?? "", RasterApiErrorCode.STATIC_BAD_REQUEST);
    } catch {
      throwRasterApiError(RasterApiErrorCode.STATIC_BAD_REQUEST);
    }
    return buildStaticRequest(match, styleId);
  }
  throwRasterApiError(RasterApiErrorCode.BAD_COORDINATES);
}

function normalizeStyleIdSegment(
  value: string,
  errorCode: RasterApiErrorCode.BAD_COORDINATES | RasterApiErrorCode.STATIC_BAD_REQUEST,
): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throwRasterApiError(errorCode);
  }
  const normalized = decoded.trim();
  if (normalized.length === 0 || normalized.includes("/")) {
    throwRasterApiError(errorCode);
  }
  return normalized;
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
  const headers = normalizeHeaderMap(input.headers);
  return {
    method: input.method,
    path: normalizePath(stripV1Prefix(input.path)),
    query: input.query ?? {},
    headers,
    clientIp: input.clientIp,
    rawToken: pickAccessToken(input.query),
  };
}

function mapParseFailure(
  error: unknown,
  expectedKind?: "raster" | "static",
): RasterApiErrorCode.BAD_COORDINATES | RasterApiErrorCode.STATIC_BAD_REQUEST {
  if (error instanceof RasterApiError && error.code === RasterApiErrorCode.STATIC_BAD_REQUEST) {
    return RasterApiErrorCode.STATIC_BAD_REQUEST;
  }
  if (expectedKind === "static") {
    return RasterApiErrorCode.STATIC_BAD_REQUEST;
  }
  return RasterApiErrorCode.BAD_COORDINATES;
}

function isExpectedKind(match: RasterPathMatch, expectedKind?: "raster" | "static"): boolean {
  return expectedKind === undefined || match.request.kind === expectedKind;
}

async function withRenderTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new RenderError(RenderErrorCode.BACKEND_UNAVAILABLE, "timeout"));
    }, renderTimeoutMs());
    work.then((result) => {
      clearTimeout(timeout);
      resolve(result);
    }).catch((error: unknown) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function handleRasterRequest(
  input: RasterRequest,
  expectedKind?: "raster" | "static",
): Promise<RasterResponse> {
  const path = normalizePath(input.path);
  const requestHeaders = normalizeHeaderMap(input.headers);
  const origin = normalizeOrigin(requestHeaders);
  const errorHeaders = {
    ...buildPreflightHeaders(origin),
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  if (isOptions(input)) {
    try {
      const parsed = parseRasterPath(path);
      if (!isExpectedKind(parsed, expectedKind)) {
        throwRasterApiError(expectedKind === "static" ? RasterApiErrorCode.STATIC_BAD_REQUEST : RasterApiErrorCode.BAD_COORDINATES);
      }
      return {
        status: 204,
        headers: {
          ...buildPreflightHeaders(origin),
          vary: "origin",
        },
      };
    } catch (error) {
      const mappedMessage = mapParseFailure(error, expectedKind);
      return {
        status: 400,
        body: encodeJsonError(mappedMessage),
        headers: errorHeaders,
      };
    }
  }
  try {
    const match = parseRasterPath(path);
    if (!isExpectedKind(match, expectedKind)) {
      throwRasterApiError(expectedKind === "static" ? RasterApiErrorCode.STATIC_BAD_REQUEST : RasterApiErrorCode.BAD_COORDINATES);
    }
    const config = loadConfig();
    assertRasterMethod(input.method);
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
    if (match.request.kind === "raster") {
      const rasterRequest: RasterTileRequest = {
        styleId: match.styleId,
        z: match.request.z,
        x: match.request.x,
        y: match.request.y,
        format: match.format,
      };
      image = await withRenderTimeout(renderRasterTile(rasterRequest));
    } else {
      const staticRequest: StaticMapRequest = {
        styleId: match.styleId,
        lon: match.request.lon,
        lat: match.request.lat,
        zoom: match.request.zoom,
        width: match.request.width,
        height: match.request.height,
        format: match.format,
      };
      image = await withRenderTimeout(renderStaticMap({
        ...staticRequest,
        overlays: parseOverlays(input.query),
      }));
    }
    const responseHeaders = buildHeaders(auth, image, cors, config.tileDeliveryPolicy.cacheTtlSeconds);
    if (input.method === "HEAD") {
      return {
        status: 200,
        body: undefined,
        headers: responseHeaders,
      };
    }
    return {
      status: 200,
      body: image.bytes,
      headers: responseHeaders,
    };
  } catch (error) {
    if (error instanceof RenderError) {
      if (error.code === RenderErrorCode.STYLE_NOT_FOUND) {
        return {
          status: 404,
          body: encodeJsonError(RasterApiErrorCode.STYLE_NOT_FOUND),
          headers: errorHeaders,
        };
      }
      if (error.code === RenderErrorCode.TILE_RESOLVE_FAILED) {
        return {
          status: 502,
          body: encodeJsonError(RasterApiErrorCode.RENDER_FAILED),
          headers: errorHeaders,
        };
      }
      if (error.code === RenderErrorCode.BACKEND_UNAVAILABLE) {
        return {
          status: 503,
          body: encodeJsonError(RasterApiErrorCode.RENDER_FAILED),
          headers: errorHeaders,
        };
      }
      if (error.code === RenderErrorCode.BAD_REQUEST) {
        return {
          status: 400,
          body: encodeJsonError(RasterApiErrorCode.BAD_REQUEST),
          headers: errorHeaders,
        };
      }
    }
    if (error instanceof RasterApiError) {
      if (error.code === RasterApiErrorCode.HEAD_DISABLED) {
        return {
          status: 405,
          body: undefined,
          headers: errorHeaders,
        };
      }
      if (error.code === RasterApiErrorCode.BAD_REQUEST) {
        return {
          status: 400,
          body: encodeJsonError(RasterApiErrorCode.BAD_REQUEST),
          headers: errorHeaders,
        };
      }
      if (error.code === RasterApiErrorCode.BAD_COORDINATES || error.code === RasterApiErrorCode.STATIC_BAD_REQUEST) {
        return {
          status: 400,
          body: encodeJsonError(error.code),
          headers: errorHeaders,
        };
      }
    }
    return {
      status: 500,
      body: encodeJsonError(RasterApiErrorCode.RENDER_FAILED),
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
