import { createHash } from "node:crypto";
import type { StyleDocument } from "../styles/types";
import { getStyle } from "../styles/styles.service";
import { resolveVectorTile } from "../tile-resolver/tile-resolver.service";
import {
  RenderError,
  RenderErrorCode,
  type RasterTileRequest,
  type RenderedImage,
  type RenderFormat,
  type StaticMapRequest,
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

interface SourceCoordinates {
  readonly sourceZ: number;
  readonly sourceX: number;
  readonly sourceY: number;
}

function formatForImage(format: RenderFormat): string {
  if (format === "webp") {
    return "image/webp";
  }
  return "image/png";
}

function assertInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, label);
  }
}

function parseStaticCoordinate(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, label);
  }
  return value;
}

function assertRasterCoordinates(z: number, x: number, y: number): void {
  const maxZoom = 30;
  if (z > maxZoom) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, "z");
  }
  const axisLimit = 2 ** z;
  if (x >= axisLimit || y >= axisLimit) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, "tile");
  }
}

function normalizeRequiredIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, label);
  }
  return trimmed;
}

function normalizeOptionalIdentifier(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, label);
  }
  return trimmed;
}

function assertNonNegativeFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value) || value < 0) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, label);
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

function throwRenderError(code: RenderErrorCode, details?: string): never {
  throw new RenderError(code, details);
}

function isRenderError(value: unknown): value is RenderError {
  return value instanceof RenderError;
}

function messageCode(value: unknown): string | undefined {
  if (!(value instanceof Error) || typeof value !== "object" || value === null) {
    return undefined;
  }
  const maybeCode = Reflect.get(value, "code");
  if (typeof maybeCode === "string" && maybeCode.length > 0) {
    return maybeCode;
  }
  return undefined;
}

async function resolveStyle(styleId: string, versionId?: string): Promise<ResolvedStyle> {
  try {
    const document = getStyle(styleId, versionId);
    return {
      versionKey: buildStyleVersionKey(document),
    };
  } catch (error) {
    if (isRenderError(error)) {
      throw error;
    }
    const code = messageCode(error);
    if (code === "STYLE_NOT_FOUND" || code === "STYLE_VERSION_NOT_FOUND") {
      throwRenderError(RenderErrorCode.STYLE_NOT_FOUND);
    }
    if (code === "STYLE_INVALID_DOCUMENT") {
      throwRenderError(RenderErrorCode.BAD_REQUEST);
    }
    throwRenderError(RenderErrorCode.BACKEND_UNAVAILABLE, "style");
  }
}

function selectRenderer() {
  const backend = process.env.RENDER_BACKEND;
  if (backend === "remote") {
    return renderWithRemoteService;
  }
  return renderLocally;
}

function parseRasterTileSource(input: RasterTileRequest): SourceCoordinates & { readonly styleVersionId?: string } {
  assertInteger(input.z, "z");
  assertInteger(input.x, "x");
  assertInteger(input.y, "y");
  assertRasterCoordinates(input.z, input.x, input.y);
  return {
    styleVersionId: input.versionId,
    sourceZ: input.z,
    sourceX: input.x,
    sourceY: input.y,
  };
}

function parseStaticMapSource(
  input: StaticMapRequest,
): SourceCoordinates & {
  readonly styleVersionId?: string;
  readonly width: number;
  readonly height: number;
  readonly overlays?: ReadonlyArray<string>;
} {
  if (input.width < 1 || input.height < 1) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, "width");
  }
  const maxDimension = 4096;
  if (input.width > maxDimension || input.height > maxDimension) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, "dimension");
  }
  const normalizedZoom = assertNonNegativeFinite(input.zoom, "zoom");
  const maxZoom = 30;
  if (normalizedZoom > maxZoom) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, "zoom");
  }
  const lon = parseStaticCoordinate(input.lon, "lon");
  const lat = parseStaticCoordinate(input.lat, "lat");
  const tile = tileFromLatLon(lon, lat, Math.floor(normalizedZoom));
  return {
    styleVersionId: input.versionId,
    sourceZ: tile.z,
    sourceX: tile.x,
    sourceY: tile.y,
    width: input.width,
    height: input.height,
    overlays: input.overlays,
  };
}

async function renderFromSource(input: TileRequestInput): Promise<RenderedImage> {
  const style = await resolveStyle(input.styleId, input.styleVersionId);
  if (input.sourceZ === undefined || input.sourceX === undefined || input.sourceY === undefined) {
    throwRenderError(RenderErrorCode.BAD_REQUEST, "source");
  }
  let resolvedTile: Awaited<ReturnType<typeof resolveVectorTile>>;
  try {
    resolvedTile = await resolveVectorTile({
      z: input.sourceZ,
      x: input.sourceX,
      y: input.sourceY,
    });
  } catch (error) {
    const code = messageCode(error);
    if (code === "RESOLVER_BAD_COORDINATES") {
      throwRenderError(RenderErrorCode.BAD_REQUEST, "coordinates");
    }
    if (
      code === "RESOLVER_TILE_NOT_FOUND"
      || code === "RESOLVER_ARTIFACT_UNAVAILABLE"
      || code === "RESOLVER_ORIGIN_READ_FAILED"
    ) {
      throwRenderError(RenderErrorCode.TILE_RESOLVE_FAILED);
    }
    throwRenderError(RenderErrorCode.BACKEND_UNAVAILABLE, "resolver");
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
    if (isRenderError(error)) {
      throw error;
    }
    const code = messageCode(error);
    if (code === "RENDER_BAD_REQUEST") {
      throwRenderError(RenderErrorCode.BAD_REQUEST);
    }
    throwRenderError(RenderErrorCode.BACKEND_UNAVAILABLE);
  }
}

export async function renderRasterTile(input: RasterTileRequest): Promise<RenderedImage> {
  if (input.format !== "png" && input.format !== "webp") {
    throwRenderError(RenderErrorCode.BAD_REQUEST, "format");
  }
  const normalizedStyleId = normalizeRequiredIdentifier(input.styleId, "styleId");
  const normalizedVersionId = normalizeOptionalIdentifier(input.versionId, "versionId");
  const metadata = parseRasterTileSource(input);
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
  if (input.format !== "png" && input.format !== "webp") {
    throwRenderError(RenderErrorCode.BAD_REQUEST, "format");
  }
  const normalizedStyleId = normalizeRequiredIdentifier(input.styleId, "styleId");
  const normalizedVersionId = normalizeOptionalIdentifier(input.versionId, "versionId");
  const metadata = parseStaticMapSource(input);
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
