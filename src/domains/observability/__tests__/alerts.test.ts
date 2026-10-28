import { strict as assert } from "node:assert";
import {
  dispatchAlert,
  resetAlertSuppressionState,
  setAlertDispatchFailureMode,
  setAlertSuppressionWindowMs,
} from "../analytics/alerts";
import { ObservabilityError, type CacheHealthSignal } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

function buildSignal(status: CacheHealthSignal["status"]): CacheHealthSignal {
  return {
    artifactVersion: "artifact-test",
    endpointGroup: "/tiles/{z}/{x}/{y}.mvt",
    status,
    cacheHitRatio: status === "ok" ? 0.9 : 0.4,
    errorRate: status === "ok" ? 0.001 : 0.1,
    window: {
      artifactVersion: "artifact-test",
      endpointGroup: "/tiles/{z}/{x}/{y}.mvt",
      windowStart: 1_700_000_000_000,
      totalRequests: 100,
      cacheHits: status === "ok" ? 90 : 40,
      originReads: 60,
      errors: status === "ok" ? 0 : 10,
    },
  };
}

test("dispatchAlert suppresses repeats within the configured window", () => {
  resetAlertSuppressionState();
  setAlertSuppressionWindowMs(60_000);
  const first = dispatchAlert(buildSignal("critical"), true);
  assert.equal(first.sent, true);
  assert.equal(first.reason, "status=critical");

  const repeat = dispatchAlert(buildSignal("critical"), true);
  assert.equal(repeat.sent, false);
  assert.equal(repeat.reason.startsWith("suppressed"), true);

  // Different status path is tracked independently.
  const warn = dispatchAlert(buildSignal("warn"), true);
  assert.equal(warn.sent, true);
});

test("dispatchAlert with zero suppression window emits every time", () => {
  resetAlertSuppressionState();
  setAlertSuppressionWindowMs(0);
  const first = dispatchAlert(buildSignal("critical"), true);
  const second = dispatchAlert(buildSignal("critical"), true);
  assert.equal(first.sent, true);
  assert.equal(second.sent, true);
  resetAlertSuppressionState();
});

test("dispatchAlert returns ok reason for healthy windows without suppressing", () => {
  resetAlertSuppressionState();
  const result = dispatchAlert(buildSignal("ok"), true);
  assert.equal(result.sent, false);
  assert.equal(result.reason, "ok");
});

test("dispatchAlert is short-circuited when observability is disabled", () => {
  resetAlertSuppressionState();
  const result = dispatchAlert(buildSignal("critical"), false);
  assert.equal(result.sent, false);
  assert.equal(result.reason, "observability disabled");
});

test("dispatchAlert forwards forced failure mode for dispatch errors", () => {
  resetAlertSuppressionState();
  setAlertDispatchFailureMode(true);
  try {
    let captured: ObservabilityError | null = null;
    try {
      dispatchAlert(buildSignal("critical"), true);
    } catch (error) {
      if (error instanceof ObservabilityError) {
        captured = error;
      }
    }
    assert.equal(captured !== null, true);
  } finally {
    setAlertDispatchFailureMode(false);
    resetAlertSuppressionState();
  }
});
