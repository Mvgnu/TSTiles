import { StorageError, StorageErrorCode } from "../types";

export interface RangeBounds {
  readonly start: number;
  readonly end: number;
}

export function clampRange(size: number, start?: number, end?: number, maxRangeBytes?: number): RangeBounds {
  const defaultStart = 0;
  const defaultEnd = size > 0 ? size - 1 : 0;

  const resolvedStart = start ?? defaultStart;
  const resolvedEnd = end ?? defaultEnd;

  if (!Number.isInteger(resolvedStart) || !Number.isFinite(resolvedStart)) {
    throw new StorageError(StorageErrorCode.RANGE_INVALID, "Range start must be an integer");
  }
  if (!Number.isInteger(resolvedEnd) || !Number.isFinite(resolvedEnd)) {
    throw new StorageError(StorageErrorCode.RANGE_INVALID, "Range end must be an integer");
  }

  if (resolvedStart < 0 || resolvedEnd < 0) {
    throw new StorageError(StorageErrorCode.RANGE_INVALID, "Range values must be non-negative");
  }
  if (resolvedStart > resolvedEnd) {
    throw new StorageError(StorageErrorCode.RANGE_INVALID, "Range start must be <= end");
  }
  if (size <= 0) {
    throw new StorageError(StorageErrorCode.RANGE_INVALID, "Object size must be positive");
  }
  if (resolvedStart >= size) {
    throw new StorageError(StorageErrorCode.RANGE_INVALID, "Range start exceeds object size");
  }
  if (maxRangeBytes !== undefined) {
    if (!Number.isInteger(maxRangeBytes) || !Number.isFinite(maxRangeBytes) || maxRangeBytes <= 0) {
      throw new StorageError(StorageErrorCode.RANGE_INVALID, "Invalid max range bytes");
    }
    const requestedEnd = Math.min(resolvedEnd, size - 1);
    const boundedEnd = Math.min(requestedEnd, resolvedStart + maxRangeBytes - 1);
    return {
      start: resolvedStart,
      end: Math.max(resolvedStart, boundedEnd),
    };
  }
  return {
    start: resolvedStart,
    end: Math.min(resolvedEnd, Math.max(size - 1, 0)),
  };
}
