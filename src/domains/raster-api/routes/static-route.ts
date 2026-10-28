import type { RasterRequest, RasterResponse } from "../types";
import { RasterApiErrorCode } from "../types";
import { handleStaticMapRequest } from "../raster-api.service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeQuery(value: unknown): RasterRequest["query"] | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }
  const entries: Array<[string, string | string[] | undefined]> = [];
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || typeof entry === "string") {
      entries.push([key, entry]);
      continue;
    }
    if (Array.isArray(entry) && entry.every((item) => typeof item === "string")) {
      entries.push([key, entry]);
      continue;
    }
    return null;
  }
  return Object.fromEntries(entries);
}

function normalizeRasterRouteRequest(request: unknown): RasterRequest | null {
  if (!isRecord(request)) {
    return null;
  }
  if (typeof request.method !== "string" || typeof request.path !== "string" || !isRecord(request.headers)) {
    return null;
  }
  for (const value of Object.values(request.headers)) {
    if (typeof value !== "string" && value !== undefined) {
      return null;
    }
  }
  const query = normalizeQuery(request.query);
  if (query === null) {
    return null;
  }
  return {
    method: request.method as RasterRequest["method"],
    path: request.path,
    query,
    headers: request.headers as RasterRequest["headers"],
    clientIp: typeof request.clientIp === "string" ? request.clientIp : undefined,
  };
}

export async function staticMapRoute(request: RasterRequest): Promise<RasterResponse> {
  const normalized = normalizeRasterRouteRequest(request);
  if (!normalized) {
    return {
      status: 400,
      body: new TextEncoder().encode(JSON.stringify({ error: RasterApiErrorCode.BAD_REQUEST })),
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  return handleStaticMapRequest(normalized);
}
