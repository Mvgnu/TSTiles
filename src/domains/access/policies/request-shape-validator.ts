import type { HttpMethod } from "../../../contracts/types";

const tilePathPattern = /^\/(?:v1\/)?tiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/;
const rasterPathPattern = /^\/(?:v1\/)?raster\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(?:png|webp)$/;
const staticPathPattern = /^\/(?:v1\/)?static\/([^/]+)\/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\/([1-9]\d*)x([1-9]\d*)\.(?:png|webp)$/;
const metadataPath = "/tiles/metadata";
const metadataPathV1 = "/v1/tiles/metadata";
const maxStaticDimension = 4096;
const maxStaticZoom = 30;
const maxRasterZoom = 30;
const maxTileZoom = 30;

function isValidDecodedStyleId(rawSegment: string | undefined): boolean {
  if (rawSegment === undefined) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawSegment);
  } catch {
    return false;
  }
  const normalized = decoded.trim();
  return normalized.length > 0 && !normalized.includes("/");
}

function stripQuery(path: string): string {
  const [withoutQuery] = path.split("?");
  return withoutQuery ?? path;
}

export function isValidTilePath(path: string): boolean {
  const normalizedPath = stripQuery(path);
  const match = tilePathPattern.exec(normalizedPath);
  if (!match) {
    return false;
  }
  const z = Number(match[1] ?? "");
  const x = Number(match[2] ?? "");
  const y = Number(match[3] ?? "");
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return false;
  }
  if (z > maxTileZoom) {
    return false;
  }
  const maxIndex = 2 ** z;
  return x >= 0 && y >= 0 && x < maxIndex && y < maxIndex;
}

export function isValidRequestPath(path: string): boolean {
  const normalized = stripQuery(path).replace(/^\/v1\//, "/");
  const rasterMatch = rasterPathPattern.exec(normalized);
  if (rasterMatch) {
    if (!isValidDecodedStyleId(rasterMatch[1])) {
      return false;
    }
    const z = Number(rasterMatch[2] ?? "");
    const x = Number(rasterMatch[3] ?? "");
    const y = Number(rasterMatch[4] ?? "");
    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
      return false;
    }
    if (z > maxRasterZoom) {
      return false;
    }
    const maxIndex = 2 ** z;
    if (x >= maxIndex || y >= maxIndex) {
      return false;
    }
  }
  const staticMatch = staticPathPattern.exec(normalized);
  if (staticMatch) {
    if (!isValidDecodedStyleId(staticMatch[1])) {
      return false;
    }
    const lon = Number(staticMatch[2] ?? "");
    const lat = Number(staticMatch[3] ?? "");
    const zoom = Number(staticMatch[4] ?? "");
    const width = Number(staticMatch[5] ?? "");
    const height = Number(staticMatch[6] ?? "");
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return false;
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      return false;
    }
    if (!Number.isFinite(zoom) || zoom > maxStaticZoom) {
      return false;
    }
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      return false;
    }
    if (width > maxStaticDimension || height > maxStaticDimension) {
      return false;
    }
  }
  return isValidTilePath(normalized)
    || rasterMatch !== null
    || staticMatch !== null
    || normalized === metadataPath
    || normalized === metadataPathV1.replace(/^\/v1\//, "/");
}

export function isValidMethod(method: HttpMethod): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}
