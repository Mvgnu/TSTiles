import { StorageError, StorageErrorCode } from "../types";

function extractErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const maybeCode = Reflect.get(error, "code");
  if (typeof maybeCode === "string" && maybeCode.length > 0) {
    return maybeCode.toUpperCase();
  }
  return undefined;
}

function mapNodeErrorCode(code: string, key?: string): StorageError | undefined {
  if (code === "ENOENT" || code === "NO_SUCH_KEY" || code === "NOTFOUND") {
    return new StorageError(StorageErrorCode.NOT_FOUND, "Object not found", key);
  }
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return new StorageError(StorageErrorCode.TIMEOUT, "Storage timeout", key);
  }
  if (code === "EACCES" || code === "EPERM" || code === "PRECONDITIONFAILED") {
    return new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Precondition failed", key);
  }
  if (code === "ERANGE" || code === "RANGE_NOT_SATISFIABLE") {
    return new StorageError(StorageErrorCode.RANGE_INVALID, "Range invalid", key);
  }
  return undefined;
}

export function mapStorageError(error: unknown, key?: string): StorageError {
  if (error instanceof StorageError) {
    if (key !== undefined) {
      return new StorageError(error.code, error.message, key);
    }
    return error;
  }
  if (error instanceof Error) {
    const code = extractErrorCode(error);
    if (code !== undefined) {
      const mappedByCode = mapNodeErrorCode(code, key);
      if (mappedByCode !== undefined) {
        return mappedByCode;
      }
    }
    if (error.name === "AbortError") {
      return new StorageError(StorageErrorCode.TIMEOUT, "Storage timeout", key);
    }
    const message = error.message.toLowerCase();
    if (message.includes("timeout")) {
      return new StorageError(StorageErrorCode.TIMEOUT, "Storage timeout", key);
    }
    if (message.includes("timed out") || message.includes("network") || message.includes("socket") || message.includes("econn")) {
      return new StorageError(StorageErrorCode.TIMEOUT, "Storage timeout", key);
    }
    if (message.includes("precondition")) {
      return new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Precondition failed", key);
    }
    if (message.includes("range") && (message.includes("invalid") || message.includes("out of range"))) {
      return new StorageError(StorageErrorCode.RANGE_INVALID, "Range invalid", key);
    }
    if (message.includes("not found")) {
      return new StorageError(StorageErrorCode.NOT_FOUND, "Object not found", key);
    }
    return new StorageError(StorageErrorCode.TIMEOUT, "Storage timeout", key);
  }
  return new StorageError(StorageErrorCode.TIMEOUT, "Storage timeout", key);
}
