import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import type { RuntimeConfig } from "../../config/types";
import {
  StorageError,
  StorageErrorCode,
  type ObjectMetadata,
  type ObjectStore,
  type RangeReadRequest,
  type RangeReadResult,
  type StorageFactory,
} from "./types";
import { InMemoryObjectStoreClient } from "./adapters/s3-compatible-client";
import { clampRange } from "./adapters/range-reader";
import { withRetry } from "./adapters/retry-policy";
import { mapStorageError } from "./adapters/error-mapper";

const objectStoreByBucket = new Map<string, InMemoryObjectStoreClient>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function isFileUrlKey(key: string): boolean {
  return key.toLowerCase().startsWith("file://");
}

function asFilePathFromUrl(key: string): string {
  try {
    const parsed = new URL(key);
    if (parsed.protocol !== "file:") {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Unsupported object key scheme", key);
    }
    return decodeURIComponent(parsed.pathname);
  } catch (error) {
    if (error instanceof StorageError) {
      throw error;
    }
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Invalid file object key", key);
  }
}

function mapFsError(error: unknown, key: string): never {
  if (error instanceof StorageError) {
    throw error;
  }
  const code = errorCode(error);
  if (code === "ENOENT") {
    throw new StorageError(StorageErrorCode.NOT_FOUND, "Object not found", key);
  }
  if (code === "EACCES" || code === "EPERM") {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Object is not readable", key);
  }
  throw new StorageError(StorageErrorCode.TIMEOUT, "Storage timeout", key);
}

async function headFileUrlObject(key: string): Promise<ObjectMetadata> {
  const filePath = asFilePathFromUrl(key);
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      throw new StorageError(StorageErrorCode.NOT_FOUND, "Object not found", key);
    }
    const digest = createHash("sha256")
      .update(`${fileStats.size}:${fileStats.mtimeMs}`)
      .digest("hex");
    return {
      key,
      size: fileStats.size,
      etag: digest,
      contentType: "application/vnd.mapbox-vector-tile",
      lastModified: fileStats.mtime.toISOString(),
    };
  } catch (error) {
    mapFsError(error, key);
  }
}

async function getRangeForFileUrlObject(
  key: string,
  start: number | undefined,
  end: number | undefined,
  maxRangeBytes: number,
): Promise<RangeReadResult> {
  const filePath = asFilePathFromUrl(key);
  try {
    const metadata = await headFileUrlObject(key);
    const bounds = clampRange(metadata.size, start, end, maxRangeBytes);
    const byteLength = bounds.end - bounds.start + 1;
    const handle = await open(filePath, "r");
    try {
      const bytes = new Uint8Array(byteLength);
      const { bytesRead } = await handle.read(bytes, 0, byteLength, bounds.start);
      if (bytesRead !== byteLength) {
        throw new StorageError(StorageErrorCode.RANGE_INVALID, "Range invalid", key);
      }
      return {
        key,
        bytes,
        start: bounds.start,
        end: bounds.end,
        totalBytes: metadata.size,
        contentType: metadata.contentType,
        etag: metadata.etag,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    mapFsError(error, key);
  }
}

const defaultCreateObjectStore = (config: RuntimeConfig): ObjectStore => {
  const backend = getBackend(config.storage.bucketName);

  const getRange = async (input: RangeReadRequest): Promise<RangeReadResult> => {
    const key = normalizeObjectKey(input.key);
    if (isFileUrlKey(key)) {
      return getRangeForFileUrlObject(
        key,
        input.start,
        input.end,
        config.tileDeliveryPolicy.maxRangeBytes,
      );
    }
    try {
      return await withRetry(async () => {
        const metadata = await backend.head(key);
        const bounds = clampRange(
          metadata.size,
          input.start,
          input.end,
          config.tileDeliveryPolicy.maxRangeBytes,
        );
        const result = await backend.get(key, bounds.start, bounds.end);
        return result;
      });
    } catch (error) {
      throw mapStorageError(error, redactUrl(key));
    }
  };

  const head = async (rawKey: string): Promise<ObjectMetadata> => {
    const key = normalizeObjectKey(rawKey);
    if (isFileUrlKey(key)) {
      return headFileUrlObject(key);
    }
    try {
      return await withRetry(async () => backend.head(key));
    } catch (error) {
      throw mapStorageError(error, redactUrl(key));
    }
  };

  const putObject = async (
    rawKey: string,
    bytes: Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<ObjectMetadata> => {
    const key = normalizeObjectKey(rawKey);
    if (isFileUrlKey(key)) {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "File object keys are read-only", key);
    }
    if (bytes.byteLength <= 0) {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Empty object writes are not allowed", key);
    }
    try {
      return await withRetry(async () => backend.put(key, bytes, contentType));
    } catch (error) {
      throw mapStorageError(error, redactUrl(key));
    }
  };

  return {
    getRange,
    head,
    putObject,
  };
};

let createObjectStoreImpl: StorageFactory = defaultCreateObjectStore;

/**
 * Test seam: allow injection of a custom factory for fault-injection scenarios.
 */
export function setCreateObjectStore(factory: StorageFactory | undefined): void {
  createObjectStoreImpl = factory ?? defaultCreateObjectStore;
}

function getBackend(bucketName: string): InMemoryObjectStoreClient {
  const existing = objectStoreByBucket.get(bucketName);
  if (existing) {
    return existing;
  }
  const created = new InMemoryObjectStoreClient();
  objectStoreByBucket.set(bucketName, created);
  return created;
}

function redactUrl(input: string): string {
  if (!input) {
    return "[redacted]";
  }
  const sanitized = input
    .replace(/([?&](?:token|access_token)=)[^&#]*/gi, "$1[redacted]")
    .replace(/([?&](?:x-amz-signature|signature)=)[^&#]*/gi, "$1[redacted]")
    .replace(/([?&](?:x-amz-credential|credential)=)[^&#]*/gi, "$1[redacted]")
    .replace(/([?&](?:x-amz-security-token|security_token)=)[^&#]*/gi, "$1[redacted]");
  const fragmentIndex = sanitized.indexOf("#");
  if (fragmentIndex < 0) {
    return sanitized;
  }
  return `${sanitized.slice(0, fragmentIndex)}#[redacted]`;
}

function normalizeObjectKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Object key must be non-empty");
  }
  return normalized;
}

export function createObjectStore(config: RuntimeConfig): ObjectStore {
  return createObjectStoreImpl(config);
}
