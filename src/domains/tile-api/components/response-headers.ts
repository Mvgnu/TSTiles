import type { HttpMethod } from "../../../contracts/types";

export interface CacheProfile {
  readonly cacheControl: string;
  readonly vary: string;
}

export function buildTileHeaders(
  method: HttpMethod,
  cacheKey: string,
  etag?: string,
  cacheControl?: string,
  byteLength?: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-tile-cache-key": cacheKey,
    vary: "origin,accept",
  };
  if (etag !== undefined && etag.length > 0) {
    headers.etag = etag;
  }
  if (byteLength !== undefined && Number.isInteger(byteLength) && byteLength >= 0) {
    headers["content-length"] = String(byteLength);
  }
  if (method === "HEAD") {
    headers["content-type"] = "application/vnd.mapbox-vector-tile";
  } else {
    headers["content-type"] = "application/vnd.mapbox-vector-tile";
  }
  headers["cache-control"] = cacheControl ?? "public, max-age=300";
  return headers;
}
