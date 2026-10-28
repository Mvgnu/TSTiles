import { normalizeHeaderMap } from "../../contracts/contracts";
import { loadConfig } from "../../config/load-config";
import type { AuthorizeContext } from "../../contracts/types";
import { authorizeTileRequest, buildCorsHeaders, resolveAllowedOrigins } from "../access/access.service";
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
const maxMercatorLatitude = 85.05112878;
let activeRenderRequests = 0;

function throwRasterApiError(code: RasterApiErrorCode): never {
  throw new RasterApiError(code);
}

function encodeJsonError(message: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ error: message }));
}

function responseBodyForMethod(method: RasterRequest["method"], body: Uint8Array): Uint8Array | undefined {
  if (method === "HEAD") {
    return undefined;
  }
  return body;
}

function parseQueryValue(query: RasterRequest["query"], key: string): string | undefined {
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

function pickAccessToken(query: RasterRequest["query"]): string | undefined {
  return parseQueryValue(query, "access_token") ?? parseQueryValue(query, "token");
}

function pickVersionId(query: RasterRequest["query"]): string | undefined {
  return parseQueryValue(query, "versionId");
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? path;
}

function normalizeRuntimeQuery(
  query: RasterRequest["query"],
): Readonly<Record<string, string | string[] | undefined>> {
  if (query === undefined) {
    return {};
  }
  if (typeof query !== "object" || query === null || Array.isArray(query)) {
    throwRasterApiError(RasterApiErrorCode.BAD_REQUEST);
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
    throwRasterApiError(RasterApiErrorCode.BAD_REQUEST);
  }
  return Object.fromEntries(normalized);
}

function resolveQuery(path: string, query: RasterRequest["query"]): Readonly<Record<string, string | string[] | undefined>> {
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

function normalizeOrigin(headers: Record<string, string | undefined>): string | undefined {
  const direct = headers.origin;
  if (typeof direct === "string") {
    return direct;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "origin") {
      return value;
    }
  }
  return undefined;
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

function assertRequestMethod(method: string, expectedKind?: "raster" | "static"): void {
  if (method === "GET" || method === "HEAD") {
    return;
  }
  throwRasterApiError(expectedKind === "static" ? RasterApiErrorCode.STATIC_BAD_REQUEST : RasterApiErrorCode.BAD_REQUEST);
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
  if (width < 1 || height < 1) {
    throwRasterApiError(RasterApiErrorCode.STATIC_BAD_REQUEST);
  }
  if (width > maxStaticDimension || height > maxStaticDimension) {
    throwRasterApiError(RasterApiErrorCode.STATIC_BAD_REQUEST);
  }
}

function assertStaticCoordinates(lon: number, lat: number): void {
  if (lon < -180 || lon > 180 || lat < -maxMercatorLatitude || lat > maxMercatorLatitude) {
    throwRasterApiError(RasterApiErrorCode.STATIC_BAD_REQUEST);
  }
}

function mapDenyStatus(reason?: string): number {
  return reason === "ACCESS_RATE_LIMITED" || reason === "ACCESS_QUOTA_EXCEEDED"
    ? 429
    : reason === "ACCESS_ORIGIN_DENIED" || reason === "ACCESS_WORKSPACE_SUSPENDED" || reason === "ACCESS_PROJECT_REVOKED"
      ? 403
      : reason === "ACCESS_UNAUTHORIZED"
        ? 401
        : 400;
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
  if (
    normalized.length === 0
    || normalized === "."
    || normalized.includes("/")
    || normalized.includes("\\")
    || normalized.includes("..")
  ) {
    throwRasterApiError(errorCode);
  }
  return normalized;
}

function parseOverlays(query: Readonly<Record<string, string | string[] | undefined>>): string[] {
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
      allowedOrigins: undefined,
    },
    origin,
  );
}

const preflightVaryHeader = "origin,access-control-request-method,access-control-request-headers";

function asAuthorizeContext(input: RasterRequest): AuthorizeContext {
  const headers = normalizeHeaderMap(input.headers);
  const query = resolveQuery(input.path, input.query);
  return {
    method: input.method,
    path: normalizePath(stripV1Prefix(input.path)),
    query,
    headers,
    clientIp: input.clientIp,
    rawToken: pickAccessToken(query),
  };
}

function isExpectedKind(match: RasterPathMatch, expectedKind?: "raster" | "static"): boolean {
  return expectedKind === undefined || match.request.kind === expectedKind;
}

async function withRenderTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new RenderError(RenderErrorCode.BACKEND_UNAVAILABLE, "timeout"));
    }, timeoutMs);
    work.then((result) => {
      clearTimeout(timeout);
      resolve(result);
    }).catch((error: unknown) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function withRenderCapacity<T>(
  work: () => Promise<T>,
  limits: {
    readonly timeoutMs: number;
    readonly maxConcurrent: number;
  },
): Promise<T> {
  if (activeRenderRequests >= limits.maxConcurrent) {
    throw new RenderError(RenderErrorCode.BACKEND_UNAVAILABLE, "saturated");
  }
  activeRenderRequests += 1;
  try {
    return await withRenderTimeout(work(), limits.timeoutMs);
  } finally {
    activeRenderRequests -= 1;
  }
}

async function handleRasterRequest(
  input: RasterRequest,
  expectedKind?: "raster" | "static",
): Promise<RasterResponse> {
  const requestHeaders = normalizeHeaderMap(input.headers);
  const origin = normalizeOrigin(requestHeaders);
  let errorHeaders = {
    ...buildPreflightHeaders(origin),
    "content-type": "application/json",
    "cache-control": "no-store",
  };
  try {
    const path = normalizePath(input.path);
    const query = resolveQuery(input.path, input.query);
    if (isOptions(input)) {
      const allowedOrigins = await resolveAllowedOrigins({
        headers: requestHeaders,
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
      const parsed = parseRasterPath(path);
      if (!isExpectedKind(parsed, expectedKind)) {
        throwRasterApiError(expectedKind === "static" ? RasterApiErrorCode.STATIC_BAD_REQUEST : RasterApiErrorCode.BAD_COORDINATES);
      }
      return {
        status: 204,
        headers: {
          ...preflightHeaders,
          vary: preflightVaryHeader,
        },
      };
    }
    const match = parseRasterPath(path);
    if (!isExpectedKind(match, expectedKind)) {
      throwRasterApiError(expectedKind === "static" ? RasterApiErrorCode.STATIC_BAD_REQUEST : RasterApiErrorCode.BAD_COORDINATES);
    }
    const config = loadConfig();
    assertRequestMethod(input.method, expectedKind);
    assertHeadEnabled(input.method, config.tileDeliveryPolicy.headEnabled);
    const auth = await authorizeTileRequest(asAuthorizeContext(input));
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
        "cache-control": "no-store",
      };
      if (auth.denyReason === "ACCESS_WORKSPACE_SUSPENDED") {
        deniedHeaders["retry-after"] = "0";
      }
      return {
        status: mapDenyStatus(auth.denyReason),
        body: responseBodyForMethod(input.method, encodeJsonError("DENIED")),
        headers: deniedHeaders,
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
        versionId: pickVersionId(query),
      };
      image = await withRenderCapacity(() => renderRasterTile(rasterRequest), {
        timeoutMs: config.tileDeliveryPolicy.renderTimeoutMs,
        maxConcurrent: config.tileDeliveryPolicy.renderMaxConcurrent,
      });
    } else {
      const staticRequest: StaticMapRequest = {
        styleId: match.styleId,
        lon: match.request.lon,
        lat: match.request.lat,
        zoom: match.request.zoom,
        width: match.request.width,
        height: match.request.height,
        format: match.format,
        versionId: pickVersionId(query),
      };
      image = await withRenderCapacity(() => renderStaticMap({
        ...staticRequest,
        overlays: parseOverlays(query),
      }), {
        timeoutMs: config.tileDeliveryPolicy.renderTimeoutMs,
        maxConcurrent: config.tileDeliveryPolicy.renderMaxConcurrent,
      });
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
          body: responseBodyForMethod(input.method, encodeJsonError(RasterApiErrorCode.STYLE_NOT_FOUND)),
          headers: errorHeaders,
        };
      }
      if (error.code === RenderErrorCode.TILE_RESOLVE_FAILED) {
        return {
          status: 502,
          body: responseBodyForMethod(input.method, encodeJsonError(RasterApiErrorCode.RENDER_FAILED)),
          headers: errorHeaders,
        };
      }
      if (error.code === RenderErrorCode.BACKEND_UNAVAILABLE) {
        return {
          status: 503,
          body: responseBodyForMethod(input.method, encodeJsonError(RasterApiErrorCode.RENDER_FAILED)),
          headers: errorHeaders,
        };
      }
      if (error.code === RenderErrorCode.BAD_REQUEST) {
        return {
          status: 400,
          body: responseBodyForMethod(input.method, encodeJsonError(RasterApiErrorCode.BAD_REQUEST)),
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
          body: responseBodyForMethod(input.method, encodeJsonError(RasterApiErrorCode.BAD_REQUEST)),
          headers: errorHeaders,
        };
      }
      if (error.code === RasterApiErrorCode.BAD_COORDINATES || error.code === RasterApiErrorCode.STATIC_BAD_REQUEST) {
        return {
          status: 400,
          body: responseBodyForMethod(input.method, encodeJsonError(error.code)),
          headers: errorHeaders,
        };
      }
    }
    return {
      status: 500,
      body: responseBodyForMethod(input.method, encodeJsonError(RasterApiErrorCode.RENDER_FAILED)),
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
