import { StorageError, StorageErrorCode } from "../types";

export function mapStorageError(error: unknown, key?: string): StorageError {
  if (error instanceof StorageError) {
    if (key !== undefined) {
      return new StorageError(error.code, error.message, key);
    }
    return error;
  }
  if (error instanceof Error) {
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
