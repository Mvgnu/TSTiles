import { strict as assert } from "node:assert";
import { clampRange } from "../adapters/range-reader";
import { StorageErrorCode } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("range clamp enforces valid byte ranges", () => {
  assert.equal(clampRange(100, 10, 20).start, 10);
  assert.equal(clampRange(100, 10, 20).end, 20);
  assert.equal(clampRange(100, undefined, undefined).start, 0);
  assert.equal(clampRange(100, undefined, undefined).end, 99);
  assert.equal(clampRange(100, 10, 120).end, 99);
  assert.equal(clampRange(100, 10, 120, 5).end, 14);
  assert.equal(clampRange(100, 20, 30, 8).end, 27);

  let threwForReversed = false;
  try {
    clampRange(10, 20, 30);
  } catch {
    threwForReversed = true;
  }
  assert.equal(threwForReversed, true);

  let threwForNegative = false;
  try {
    clampRange(10, -1, 5);
  } catch {
    threwForNegative = true;
  }
  assert.equal(threwForNegative, true);

  let threwForZeroSize = false;
  try {
    clampRange(0, 0, 0);
  } catch (error: unknown) {
    threwForZeroSize = (error as { code?: string }).code === StorageErrorCode.RANGE_INVALID;
  }
  assert.equal(threwForZeroSize, true);

  let threwForFloat = false;
  try {
    clampRange(100, 1.5, 2);
  } catch (error: unknown) {
    threwForFloat = (error as { code?: string }).code === StorageErrorCode.RANGE_INVALID;
  }
  assert.equal(threwForFloat, true);
});
