import { strict as assert } from "node:assert";
import { StorageErrorCode } from "../types";
import { withRetry } from "../adapters/retry-policy";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("retry policy retries failed operations", async (): Promise<void> => {
  let attempts = 0;
  const eventualSuccess = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error("temporary timeout: network");
    }
    return "ok";
  }, { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 });
  assert.equal(attempts, 3);
  assert.equal(eventualSuccess, "ok");

  attempts = 0;
  try {
    await withRetry(async () => {
      attempts += 1;
      throw new Error("network timeout");
    }, { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 });
    assert.fail("expected retry to surface timeout");
  } catch (error: unknown) {
    assert.equal(attempts, 2);
    assert.equal((error as { code?: string }).code, StorageErrorCode.TIMEOUT);
  }

  attempts = 0;
  try {
    await withRetry(async () => {
      attempts += 1;
      throw new Error("not found");
    }, { maxAttempts: 5, baseDelayMs: 0, maxDelayMs: 0 });
    assert.fail("expected not found to be non-retriable");
  } catch (error: unknown) {
    assert.equal(attempts, 1);
    assert.equal((error as { code?: string }).code, StorageErrorCode.NOT_FOUND);
  }

  attempts = 0;
  try {
    await withRetry(async () => {
      attempts += 1;
      throw new Error("range invalid");
    }, { maxAttempts: 5, baseDelayMs: 0, maxDelayMs: 0 });
    assert.fail("expected range invalid to be non-retriable");
  } catch (error: unknown) {
    assert.equal(attempts, 1);
    assert.equal((error as { code?: string }).code, StorageErrorCode.RANGE_INVALID);
  }

  attempts = 0;
  try {
    await withRetry(async () => {
      attempts += 1;
      throw new Error("connection reset by peer");
    }, { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 });
    assert.fail("expected unknown transport failure to retry and surface timeout");
  } catch (error: unknown) {
    assert.equal(attempts, 3);
    assert.equal((error as { code?: string }).code, StorageErrorCode.TIMEOUT);
  }

  attempts = 0;
  try {
    await withRetry(async () => {
      attempts += 1;
      return "never";
    }, { maxAttempts: 0, baseDelayMs: 0, maxDelayMs: 0 });
    assert.fail("expected invalid retry policy to fail");
  } catch (error: unknown) {
    assert.equal(attempts, 0);
    assert.equal((error as { code?: string }).code, StorageErrorCode.PRECONDITION_FAILED);
  }

  attempts = 0;
  try {
    await withRetry(async () => {
      attempts += 1;
      return "never";
    }, { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 5 });
    assert.fail("expected invalid retry policy bounds to fail");
  } catch (error: unknown) {
    assert.equal(attempts, 0);
    assert.equal((error as { code?: string }).code, StorageErrorCode.PRECONDITION_FAILED);
  }
});
