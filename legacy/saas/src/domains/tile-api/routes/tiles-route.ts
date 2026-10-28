import type { TileRequest } from "../types";
import type { TileResponse } from "../types";
import { TileApiErrorCode } from "../types";
import { handleTileRequest } from "../tile-api.service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeQuery(value: unknown): TileRequest["query"] | null {
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

function normalizeTileRouteRequest(request: unknown): TileRequest | null {
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
    method: request.method as TileRequest["method"],
    path: request.path,
    query,
    headers: request.headers as TileRequest["headers"],
  };
}

export async function tileRoute(request: TileRequest): Promise<TileResponse> {
  const normalized = normalizeTileRouteRequest(request);
  if (!normalized) {
    return {
      status: 400,
      body: new TextEncoder().encode(JSON.stringify({ error: TileApiErrorCode.BAD_REQUEST })),
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  return handleTileRequest(normalized);
}
