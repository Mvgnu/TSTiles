import type { RuntimeConfig } from "../../config/types";

export const enum StorageErrorCode {
  NOT_FOUND = "STORAGE_NOT_FOUND",
  RANGE_INVALID = "STORAGE_RANGE_INVALID",
  PRECONDITION_FAILED = "STORAGE_PRECONDITION_FAILED",
  TIMEOUT = "STORAGE_TIMEOUT",
}

export class StorageError extends Error {
  public readonly code: StorageErrorCode;
  public readonly key?: string;

  public constructor(code: StorageErrorCode, message: string, key?: string) {
    super(message);
    this.code = code;
    this.key = key;
    this.name = "StorageError";
  }
}

export interface ObjectMetadata {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly contentType: string;
  readonly lastModified: string;
}

export interface RangeReadRequest {
  readonly key: string;
  readonly start?: number;
  readonly end?: number;
}

export interface RangeReadResult {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly start: number;
  readonly end: number;
  readonly totalBytes: number;
  readonly contentType: string;
  readonly etag: string;
}

export interface ObjectStore {
  getRange(input: RangeReadRequest): Promise<RangeReadResult>;
  head(key: string): Promise<ObjectMetadata>;
  putObject(
    key: string,
    bytes: Uint8Array,
    contentType?: string,
  ): Promise<ObjectMetadata>;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export type StorageFactory = (config: RuntimeConfig) => ObjectStore;
