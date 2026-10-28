import type { RetryPolicy } from "../types";
import { StorageError, StorageErrorCode } from "../types";
import { mapStorageError } from "./error-mapper";

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 5,
  maxDelayMs: 50,
};

export function backoffDelayMs(baseDelayMs: number, attempt: number, maxDelayMs: number): number {
  const delay = Math.min(baseDelayMs * attempt, maxDelayMs);
  return delay;
}

function assertValidRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Retry policy maxAttempts must be >= 1");
  }
  if (!Number.isInteger(policy.baseDelayMs) || policy.baseDelayMs < 0) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Retry policy baseDelayMs must be >= 0");
  }
  if (!Number.isInteger(policy.maxDelayMs) || policy.maxDelayMs < 0) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Retry policy maxDelayMs must be >= 0");
  }
  if (policy.baseDelayMs > policy.maxDelayMs) {
    throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "Retry policy baseDelayMs must be <= maxDelayMs");
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy,
): Promise<T> {
  assertValidRetryPolicy(policy);
  let attempt = 1;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const mapped = mapStorageError(error);
      if (
        mapped.code === StorageErrorCode.NOT_FOUND ||
        mapped.code === StorageErrorCode.RANGE_INVALID ||
        mapped.code === StorageErrorCode.PRECONDITION_FAILED
      ) {
        throw mapped;
      }
      if (attempt >= policy.maxAttempts) {
        throw mapped;
      }
      const delay = backoffDelayMs(policy.baseDelayMs, attempt, policy.maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}
