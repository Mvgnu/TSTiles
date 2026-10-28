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
  headers["content-type"] = "application/vnd.mapbox-vector-tile";
  headers["cache-control"] = cacheControl ?? "public, max-age=300";
  // Suppress HEAD-specific metadata that would otherwise leak distinct cache
  // entries via the unused method check; behavior is identical for GET/HEAD.
  void method;
  return headers;
}
