import { createHash } from "node:crypto";
import { loadConfig } from "../../config/load-config";
import type { StyleDocument } from "../styles/types";
import { getStyle } from "../styles/styles.service";
import { resolveVectorTile } from "../tile-resolver/tile-resolver.service";
import type {
  RasterTileRequest,
  RenderedImage,
  RenderFormat,
  StaticMapRequest,
} from "./types";
import { renderLocally } from "./adapters/local-native-renderer";
import { renderWithRemoteService } from "./adapters/remote-renderer-client";

interface ResolvedStyle {
  readonly versionKey: string;
}

interface TileRequestInput {
  readonly styleId: string;
  readonly styleVersionId?: string;
  readonly format: RenderFormat;
  readonly width?: number;
  readonly height?: number;
  readonly overlays?: ReadonlyArray<string>;
  readonly sourcePath: string;
  readonly sourceZ?: number;
  readonly sourceX?: number;
  readonly sourceY?: number;
}

function asRenderError(message: string): Error {
  return new Error(message);
}


function formatForImage(format: RenderFormat): string {
  if (format === "webp") {
    return "image/webp";
  }
  return "image/png";
}

function assertInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw asRenderError(`RENDER_BAD_REQUEST:${label}`);
  }
}

function parseStaticCoordinate(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw asRenderError(`RENDER_BAD_REQUEST:${label}`);
  }
  return value;
}

function assertRasterCoordinates(z: number, x: number, y: number): void {
  const maxZoom = 30;
  if (z > maxZoom) {
    throw asRenderError("RENDER_BAD_REQUEST:z");
  }
  const axisLimit = 2 ** z;
  if (x >= axisLimit || y >= axisLimit) {
    throw asRenderError("RENDER_BAD_REQUEST:tile");
  }
}

function normalizeRequiredIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw asRenderError(`RENDER_BAD_REQUEST:${label}`);
  }
  return trimmed;
}

function normalizeOptionalIdentifier(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw asRenderError(`RENDER_BAD_REQUEST:${label}`);
  }
  return trimmed;
}

function assertNonNegativeFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value) || value < 0) {
    throw asRenderError(`RENDER_BAD_REQUEST:${label}`);
  }
  return value;
}

function clampLatitude(lat: number): number {
  if (lat > 85.05112878) {
    return 85.05112878;
  }
  if (lat < -85.05112878) {
    return -85.05112878;
  }
  return lat;
}

function normalizeOverlays(overlays: ReadonlyArray<string> | undefined): string[] {
  if (overlays === undefined || overlays.length === 0) {
    return [];
  }
  const filtered = overlays
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const uniqueSorted = [...new Set(filtered)].sort();
  return uniqueSorted;
}

function tileFromLatLon(lon: number, lat: number, zoom: number): { z: number; x: number; y: number } {
  const maxCoord = 2 ** zoom;
  const boundedLon = lon >= 180
    ? 180 - Number.EPSILON
    : lon <= -180
      ? -180
      : lon;
  const normalizedLon = (boundedLon + 180) / 360;
  const x = Math.min(
    Math.max(Math.floor(normalizedLon * maxCoord), 0),
    maxCoord - 1,
  );
  const sinLat = Math.sin((clampLatitude(lat) * Math.PI) / 180);
  const mercatorY = (1 - Math.log((1 + sinLat) / (1 - sinLat)) / Math.PI) / 2;
  const y = Math.min(Math.max(Math.floor(mercatorY * maxCoord), 0), maxCoord - 1);
  return { z: zoom, x, y };
}

function buildStyleVersionKey(document: StyleDocument): string {
  const serialized = JSON.stringify(document);
  return createHash("sha256").update(serialized).digest("hex").slice(0, 24);
}

function buildCacheKey(input: TileRequestInput & { artifactId: string; styleVersionKey: string }): string {
  const overlayHashInput = normalizeOverlays(input.overlays);
  const overlayPart = overlayHashInput.join(",");
  return [
    "raster",
    input.styleId,
    input.styleVersionKey,
    input.artifactId,
    input.sourcePath,
    `${input.format}`,
    overlayPart,
  ].join(":");
}

function buildErrorForMap(error: unknown): never {
  if (error instanceof Error && error.message === "RENDER_BAD_REQUEST:format") {
    throw new Error("RENDER_BAD_REQUEST");
  }
  throw error instanceof Error ? error : new Error("RENDER_RENDER_FAILED");
}

async function resolveStyle(styleId: string, versionId?: string): Promise<ResolvedStyle> {
  try {
    const document = getStyle(styleId, versionId);
    return {
      versionKey: buildStyleVersionKey(document),
    };
  } catch (error) {
    const cause = error instanceof Error ? error.message : "";
    if (cause.includes("STYLE_NOT_FOUND")) {
      throw new Error("RENDER_STYLE_NOT_FOUND");
    }
    if (cause.includes("STYLE_VERSION_NOT_FOUND")) {
      throw new Error("RENDER_STYLE_NOT_FOUND");
    }
    if (cause.includes("STYLE_INVALID_DOCUMENT")) {
      throw new Error("RENDER_BAD_REQUEST");
    }
    throw new Error("RENDER_STYLE_NOT_FOUND");
  }
}

function selectRenderer() {
  const backend = process.env.RENDER_BACKEND;
  if (backend === "remote") {
    return renderWithRemoteService;
  }
  return renderLocally;
}

function parseTileMetadataInput(input: RasterTileRequest | StaticMapRequest, isStatic = false): Omit<TileRequestInput, "sourcePath" | "styleId" | "format"> {
  if (isStatic) {
    const staticInput = input as StaticMapRequest;
    if (staticInput.width < 1 || staticInput.height < 1) {
      throw asRenderError("RENDER_BAD_REQUEST:width");
    }
    const maxDimension = 4096;
    if (staticInput.width > maxDimension || staticInput.height > maxDimension) {
      throw asRenderError("RENDER_BAD_REQUEST:dimension");
    }
    const z = staticInput.zoom;
    const normalizedZoom = assertNonNegativeFinite(z, "zoom");
    const maxZoom = 30;
    if (normalizedZoom > maxZoom) {
      throw asRenderError("RENDER_BAD_REQUEST:zoom");
    }
    const lon = parseStaticCoordinate(staticInput.lon, "lon");
    const lat = parseStaticCoordinate(staticInput.lat, "lat");
    const tile = tileFromLatLon(lon, lat, Math.floor(normalizedZoom));
    return {
      styleVersionId: staticInput.versionId,
      sourceZ: tile.z,
      sourceX: tile.x,
      sourceY: tile.y,
      width: staticInput.width,
      height: staticInput.height,
      overlays: staticInput.overlays,
    };
  }
  const rasterInput = input as RasterTileRequest;
  assertInteger(rasterInput.z, "z");
  assertInteger(rasterInput.x, "x");
  assertInteger(rasterInput.y, "y");
  assertRasterCoordinates(rasterInput.z, rasterInput.x, rasterInput.y);
  return {
    styleVersionId: rasterInput.versionId,
    sourceZ: rasterInput.z,
    sourceX: rasterInput.x,
    sourceY: rasterInput.y,
    overlays: undefined,
  };
}

async function renderFromSource(input: TileRequestInput): Promise<RenderedImage> {
  if (!input.format) {
    throw asRenderError("RENDER_BAD_REQUEST:format");
  }
  const style = await resolveStyle(input.styleId, input.styleVersionId);
  let resolvedTile: Awaited<ReturnType<typeof resolveVectorTile>>;
  try {
    const coords = input.sourceZ === undefined || input.sourceX === undefined || input.sourceY === undefined
      ? undefined
      : { z: input.sourceZ, x: input.sourceX, y: input.sourceY };
    resolvedTile = await resolveVectorTile(coords === undefined ? { z: 0, x: 0, y: 0 } : coords);
  } catch (error) {
    const message = error instanceof Error ? error.message : "error";
    if (message === "RESOLVER_BAD_COORDINATES" || message === "RESOLVER_TILE_NOT_FOUND" || message === "RESOLVER_ARTIFACT_UNAVAILABLE") {
      throw new Error("RENDER_TILE_RESOLVE_FAILED");
    }
    throw buildErrorForMap(error);
  }
  const renderer = selectRenderer();
  try {
    const rendered = await renderer({
      styleId: input.styleId,
      styleVersionKey: style.versionKey,
      artifactId: resolvedTile.artifactId,
      sourcePath: input.sourcePath,
      format: input.format,
      width: input.width,
      height: input.height,
    });
    const cacheKey = buildCacheKey({
      ...input,
      artifactId: resolvedTile.artifactId,
      styleVersionKey: style.versionKey,
    });
    return {
      bytes: rendered.bytes,
      contentType: formatForImage(input.format),
      cacheKey,
      styleId: input.styleId,
      styleVersionKey: style.versionKey,
      artifactId: resolvedTile.artifactId,
      sourcePath: input.sourcePath,
      format: input.format,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "RENDER_BACKEND_UNAVAILABLE") {
      throw error;
    }
    throw new Error("RENDER_BACKEND_UNAVAILABLE");
  }
}

export async function renderRasterTile(input: RasterTileRequest): Promise<RenderedImage> {
  loadConfig();
  if (input.format !== "png" && input.format !== "webp") {
    throw asRenderError("RENDER_BAD_REQUEST");
  }
  const normalizedStyleId = normalizeRequiredIdentifier(input.styleId, "styleId");
  const normalizedVersionId = normalizeOptionalIdentifier(input.versionId, "versionId");
  const metadata = parseTileMetadataInput(input);
  if (metadata.sourceZ === undefined || metadata.sourceX === undefined || metadata.sourceY === undefined) {
    throw asRenderError("RENDER_BAD_REQUEST");
  }
  return renderFromSource({
    styleId: normalizedStyleId,
    styleVersionId: normalizedVersionId ?? metadata.styleVersionId,
    format: input.format,
    sourcePath: `/tiles/${metadata.sourceZ}/${metadata.sourceX}/${metadata.sourceY}.mvt`,
    sourceZ: metadata.sourceZ,
    sourceX: metadata.sourceX,
    sourceY: metadata.sourceY,
  });
}

export async function renderStaticMap(input: StaticMapRequest): Promise<RenderedImage> {
  loadConfig();
  if (input.format !== "png" && input.format !== "webp") {
    throw asRenderError("RENDER_BAD_REQUEST");
  }
  const normalizedStyleId = normalizeRequiredIdentifier(input.styleId, "styleId");
  const normalizedVersionId = normalizeOptionalIdentifier(input.versionId, "versionId");
  const metadata = parseTileMetadataInput(input, true);
  if (
    metadata.sourceZ === undefined ||
    metadata.sourceX === undefined ||
    metadata.sourceY === undefined ||
    metadata.width === undefined ||
    metadata.height === undefined
  ) {
    throw asRenderError("RENDER_BAD_REQUEST");
  }
  if (metadata.width > 4096 || metadata.height > 4096) {
    throw asRenderError("RENDER_BAD_REQUEST");
  }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
    throw asRenderError("RENDER_BAD_REQUEST");
  }
  return renderFromSource({
    styleId: normalizedStyleId,
    styleVersionId: normalizedVersionId ?? metadata.styleVersionId,
    format: input.format,
    sourcePath: `static/${input.lon},${input.lat},${input.zoom}`,
    sourceZ: metadata.sourceZ,
    sourceX: metadata.sourceX,
    sourceY: metadata.sourceY,
    width: metadata.width,
    height: metadata.height,
    overlays: metadata.overlays,
  });
}
