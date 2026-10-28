import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
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
import {
  InMemoryObjectStoreClient,
  S3CompatibleObjectStoreClient,
  type KeyValueObjectStoreClient,
} from "./adapters/s3-compatible-client";
import { clampRange } from "./adapters/range-reader";
import { withRetry } from "./adapters/retry-policy";
import { mapStorageError } from "./adapters/error-mapper";

const objectStoreByBucket = new Map<string, InMemoryObjectStoreClient>();
const s3StoreByConfigKey = new Map<string, S3CompatibleObjectStoreClient>();
const filesystemStoreByRoot = new Map<string, FilesystemObjectStoreClient>();

class FilesystemObjectStoreClient implements KeyValueObjectStoreClient {
  private readonly rootPath: string;

  public constructor(rootPath: string) {
    this.rootPath = resolve(rootPath);
  }

  public async get(key: string, start?: number, end?: number): Promise<RangeReadResult> {
    const metadata = await this.head(key);
    const bounds = clampRange(metadata.size, start, end, Number.MAX_SAFE_INTEGER);
    const handle = await open(this.resolveKeyPath(key), "r");
    try {
      const byteLength = bounds.end - bounds.start + 1;
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
    } catch (error) {
      mapFsError(error, key);
    } finally {
      await handle.close();
    }
  }

  public async head(key: string): Promise<ObjectMetadata> {
    const filePath = this.resolveKeyPath(key);
    try {
      const fileStats = await stat(filePath);
      if (!fileStats.isFile()) {
        throw new StorageError(StorageErrorCode.NOT_FOUND, "Object not found", key);
      }
      const digest = createHash("sha256")
        .update(`${fileStats.size}:${fileStats.mtimeMs}`)
        .digest("hex");
      const persistedContentType = await readFilesystemContentType(filePath);
      return {
        key,
        size: fileStats.size,
        etag: digest,
        contentType: persistedContentType ?? inferFilesystemContentType(key),
        lastModified: fileStats.mtime.toISOString(),
      };
    } catch (error) {
      mapFsError(error, key);
    }
  }

  public async put(key: string, bytes: Uint8Array, contentType = "application/octet-stream"): Promise<ObjectMetadata> {
    const filePath = this.resolveKeyPath(key);
    let handle:
      | Awaited<ReturnType<typeof open>>
      | undefined;
    try {
      await mkdir(dirname(filePath), { recursive: true });
      handle = await open(filePath, "wx");
      await handle.writeFile(bytes);
      await handle.close();
      handle = undefined;
      await writeFilesystemMetadata(filePath, contentType);
      const metadata = await this.head(key);
      return {
        ...metadata,
        contentType,
      };
    } catch (error) {
      mapFsError(error, key);
    } finally {
      if (handle) {
        await handle.close();
      }
    }
    throw new StorageError(StorageErrorCode.TIMEOUT, "Storage timeout", key);
  }

  private resolveKeyPath(key: string): string {
    const trimmedKey = key.trim();
    const relativeKey = trimmedKey.replace(/^\/+/, "");
    const resolvedPath = resolve(this.rootPath, relativeKey);
    if (resolvedPath !== this.rootPath && !resolvedPath.startsWith(`${this.rootPath}${sep}`)) {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Object key escapes storage root", key);
    }
    return resolvedPath;
  }
}

function metadataFilePath(filePath: string): string {
  return `${filePath}.meta.json`;
}

async function readFilesystemContentType(filePath: string): Promise<string | undefined> {
  try {
    const metadataBytes = await readFile(metadataFilePath(filePath), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(metadataBytes) as unknown;
    } catch {
      return undefined;
    }
    if (!isRecord(parsed)) {
      return undefined;
    }
    const contentType = parsed.contentType;
    return typeof contentType === "string" && contentType.trim().length > 0
      ? contentType
      : undefined;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR" || code === "EACCES" || code === "EPERM") {
      return undefined;
    }
    throw error;
  }
}

async function writeFilesystemMetadata(filePath: string, contentType: string): Promise<void> {
  await writeFile(
    metadataFilePath(filePath),
    JSON.stringify({ contentType }),
    { flag: "wx" },
  );
}

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

function inferFilesystemContentType(key: string): string {
  const extension = extname(key).toLowerCase();
  if (extension === ".pmtiles") {
    return "application/vnd.pmtiles";
  }
  if (extension === ".json") {
    return "application/json";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".pbf") {
    return "application/x-protobuf";
  }
  if (extension === ".mvt") {
    return "application/vnd.mapbox-vector-tile";
  }
  return "application/octet-stream";
}

function asFilePathFromUrl(key: string): string {
  try {
    const parsed = new URL(key);
    if (parsed.protocol !== "file:") {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Unsupported object key scheme", key);
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "File object keys must not include credentials", key);
    }
    if (parsed.hostname.length > 0) {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "File object keys must be local file URLs", key);
    }
    if (parsed.search.length > 0 || parsed.hash.length > 0) {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "File object keys must not include query or fragment data", key);
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
  if (code === "EEXIST") {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Object already exists", key);
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
      contentType: (await readFilesystemContentType(filePath)) ?? inferFilesystemContentType(key),
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

const defaultObjectStoreCache = new Map<string, ObjectStore>();

function defaultObjectStoreCacheKey(config: RuntimeConfig): string {
  return [
    config.storage.mode,
    config.storage.bucketName,
    config.storage.region ?? "",
    config.storage.endpoint ?? "",
    config.storage.accessKeyId ?? "",
    config.tileDeliveryPolicy.maxRangeBytes,
  ].join("|");
}

const defaultCreateObjectStore = (config: RuntimeConfig): ObjectStore => {
  const cacheKey = defaultObjectStoreCacheKey(config);
  const cached = defaultObjectStoreCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const backend = getBackend(config);

  const getRange = async (input: RangeReadRequest): Promise<RangeReadResult> => {
    if (!isRecord(input)) {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Range request is required");
    }
    const key = normalizeObjectKey(input.key);
    const start = normalizeOptionalRangeBound(input.start, "start");
    const end = normalizeOptionalRangeBound(input.end, "end");
    if (isFileUrlKey(key)) {
      return getRangeForFileUrlObject(
        key,
        start,
        end,
        config.tileDeliveryPolicy.maxRangeBytes,
      );
    }
    try {
      return await withRetry(async () => {
        const metadata = await backend.head(key);
        const bounds = clampRange(
          metadata.size,
          start,
          end,
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
    const normalizedBytes = normalizeObjectBytes(bytes);
    const normalizedContentType = normalizeContentType(contentType);
    if (isFileUrlKey(key)) {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "File object keys are read-only", key);
    }
    if (normalizedBytes.byteLength <= 0) {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Empty object writes are not allowed", key);
    }
    try {
      return await withRetry(async () => backend.put(key, normalizedBytes, normalizedContentType));
    } catch (error) {
      throw mapStorageError(error, redactUrl(key));
    }
  };

  const wrapper: ObjectStore = {
    getRange,
    head,
    putObject,
  };
  defaultObjectStoreCache.set(cacheKey, wrapper);
  return wrapper;
};

let createObjectStoreImpl: StorageFactory = defaultCreateObjectStore;

/**
 * Test seam: allow injection of a custom factory for fault-injection scenarios.
 * Resetting (undefined) clears the default-factory wrapper cache so test
 * fixtures observe a clean store and can re-seed the underlying backend.
 */
export function setCreateObjectStore(factory: StorageFactory | undefined): void {
  createObjectStoreImpl = factory ?? defaultCreateObjectStore;
  if (factory === undefined) {
    defaultObjectStoreCache.clear();
  }
}

function buildS3BackendKey(storage: RuntimeConfig["storage"]): string {
  return [
    storage.bucketName,
    storage.region ?? "",
    storage.endpoint ?? "",
    storage.accessKeyId ?? "",
  ].join("|");
}

function getS3Backend(config: RuntimeConfig): S3CompatibleObjectStoreClient {
  const key = buildS3BackendKey(config.storage);
  const existing = s3StoreByConfigKey.get(key);
  if (existing) {
    return existing;
  }
  const created = new S3CompatibleObjectStoreClient(config.storage);
  s3StoreByConfigKey.set(key, created);
  return created;
}

function getBackend(config: RuntimeConfig): KeyValueObjectStoreClient {
  if (config.storage.mode === "s3-compatible") {
    return getS3Backend(config);
  }
  if (config.storage.mode === "filesystem") {
    return getFilesystemBackend(config.storage.bucketName);
  }
  return getMemoryBackend(config.storage.bucketName);
}

function getFilesystemBackend(rootPath: string): FilesystemObjectStoreClient {
  const normalizedRootPath = resolve(rootPath);
  const existing = filesystemStoreByRoot.get(normalizedRootPath);
  if (existing) {
    return existing;
  }
  const created = new FilesystemObjectStoreClient(normalizedRootPath);
  filesystemStoreByRoot.set(normalizedRootPath, created);
  return created;
}

function getMemoryBackend(bucketName: string): InMemoryObjectStoreClient {
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

function normalizeObjectKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Object key must be a string");
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Object key must be non-empty");
  }
  return normalized;
}

function normalizeContentType(value: unknown): string {
  if (typeof value !== "string") {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "contentType must be a string");
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "contentType must be non-empty");
  }
  return normalized;
}

function normalizeObjectBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Object bytes must be a Uint8Array");
  }
  return value;
}

function normalizeOptionalRangeBound(value: unknown, field: "start" | "end"): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, `${field} must be an integer`);
  }
  return value;
}

function validateRuntimeConfigShape(config: unknown): asserts config is RuntimeConfig {
  if (!isRecord(config)) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Runtime config is required");
  }
  if (!isRecord(config.storage)) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Runtime storage config is required");
  }
  if (typeof config.storage.mode !== "string") {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Runtime storage mode is required");
  }
  if (!["memory", "filesystem", "s3-compatible"].includes(config.storage.mode)) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Runtime storage mode is invalid");
  }
  if (typeof config.storage.bucketName !== "string" || config.storage.bucketName.trim().length === 0) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Runtime storage bucket is required");
  }
  if (!isRecord(config.tileDeliveryPolicy)) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Runtime tile delivery policy is required");
  }
  if (
    typeof config.tileDeliveryPolicy.maxRangeBytes !== "number"
    || !Number.isFinite(config.tileDeliveryPolicy.maxRangeBytes)
    || config.tileDeliveryPolicy.maxRangeBytes <= 0
  ) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Runtime maxRangeBytes is invalid");
  }
}

export function createObjectStore(config: RuntimeConfig): ObjectStore {
  validateRuntimeConfigShape(config);
  return createObjectStoreImpl(config);
}
