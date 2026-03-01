import { ObservabilityError, ObservabilityErrorCode, type CacheHealthSignal } from "../types";

export interface AlertDispatchResult {
  readonly sent: boolean;
  readonly reason: string;
}

export function dispatchAlert(signal: CacheHealthSignal, active: boolean): AlertDispatchResult {
  if (!active) {
    return { sent: false, reason: "observability disabled" };
  }
  if (process.env.OBS_ALERT_FORCE_FAIL === "true") {
    throw new ObservabilityError(
      ObservabilityErrorCode.ALERT_DISPATCH_FAILED,
      "Failed to dispatch observability alert",
    );
  }
  if (signal.status === "critical" || signal.status === "warn") {
    return { sent: true, reason: `status=${signal.status}` };
  }
  return { sent: false, reason: "ok" };
}
