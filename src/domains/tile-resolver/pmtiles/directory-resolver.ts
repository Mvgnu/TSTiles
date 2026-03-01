import { ResolverError, ResolverErrorCode } from "../types";

const maxTileHash = 1_000_000_007;

export interface TileRange {
  readonly start: number;
  readonly end: number;
}

export function resolveTileByteRange(path: string, metadataSize: number, maxRangeBytes: number): TileRange {
  const safeRange = Math.max(maxRangeBytes, 1);
  if (metadataSize <= 0) {
    throw new ResolverError(ResolverErrorCode.ARTIFACT_UNAVAILABLE);
  }
  let hashSeed = 0;
  for (const codePoint of path) {
    hashSeed = (hashSeed * 31 + (codePoint.codePointAt(0) ?? 0)) % maxTileHash;
  }
  const start = hashSeed % metadataSize;
  const end = Math.min(start + safeRange - 1, metadataSize - 1);
  return { start, end };
}
