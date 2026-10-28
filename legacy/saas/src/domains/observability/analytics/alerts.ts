import { ObservabilityError, ObservabilityErrorCode, type CacheHealthSignal } from "../types";

export interface AlertDispatchResult {
  readonly sent: boolean;
  readonly reason: string;
}

const DEFAULT_SUPPRESSION_WINDOW_MS = 5 * 60 * 1000;
const lastDispatchByKey = new Map<string, number>();
let forceAlertDispatchFailure = false;
let suppressionWindowMs = DEFAULT_SUPPRESSION_WINDOW_MS;

export function setAlertDispatchFailureMode(forceFailure: boolean): void {
  forceAlertDispatchFailure = forceFailure;
}

export function setAlertSuppressionWindowMs(windowMs: number): void {
  if (Number.isFinite(windowMs) && windowMs >= 0) {
    suppressionWindowMs = windowMs;
  }
}

export function resetAlertSuppressionState(): void {
  lastDispatchByKey.clear();
  suppressionWindowMs = DEFAULT_SUPPRESSION_WINDOW_MS;
}

function suppressionKey(signal: CacheHealthSignal): string {
  return `${signal.artifactVersion}|${signal.endpointGroup}|${signal.status}`;
}

export function dispatchAlert(signal: CacheHealthSignal, active: boolean): AlertDispatchResult {
  if (!active) {
    return { sent: false, reason: "observability disabled" };
  }
  if (forceAlertDispatchFailure) {
    throw new ObservabilityError(
      ObservabilityErrorCode.ALERT_DISPATCH_FAILED,
      "Failed to dispatch observability alert",
    );
  }
  if (signal.status !== "critical" && signal.status !== "warn") {
    return { sent: false, reason: "ok" };
  }
  const key = suppressionKey(signal);
  const now = Date.now();
  const last = lastDispatchByKey.get(key);
  if (last !== undefined && now - last < suppressionWindowMs) {
    return { sent: false, reason: `suppressed status=${signal.status}` };
  }
  lastDispatchByKey.set(key, now);
  return { sent: true, reason: `status=${signal.status}` };
}
