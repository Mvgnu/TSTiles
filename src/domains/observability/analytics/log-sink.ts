import { appendFileSync } from "node:fs";
import type { ObservabilityLogSink } from "../../../config/types";
import type { DeliverySignal } from "../../../contracts/types";
import type { CacheHealthSignal } from "../types";

const REDACT_QUERY_PARAM = /([?&](?:access_token|token|signature|x-amz-signature|x-amz-credential|x-amz-security-token|credential|security_token)=)[^&#]*/gi;

function redactPath(path: string): string {
  if (typeof path !== "string" || path.length === 0) {
    return path;
  }
  const fragmentIndex = path.indexOf("#");
  const withoutFragment = fragmentIndex >= 0 ? path.slice(0, fragmentIndex) : path;
  return withoutFragment.replace(REDACT_QUERY_PARAM, "$1[redacted]");
}

interface DeliveryRecord {
  readonly type: "delivery_signal";
  readonly schemaVersion: number;
  readonly emittedAt: string;
  readonly artifactVersion: string;
  readonly tilePath: string;
  readonly cacheStatus: "hit" | "miss";
  readonly originRead: boolean;
  readonly responseBytes: number;
  readonly latencyMs: number;
  readonly statusCode: number;
  readonly normalizedMethod: "GET" | "HEAD" | "OPTIONS";
  readonly receivedAt: string;
}

interface AlertRecord {
  readonly type: "slo_alert";
  readonly emittedAt: string;
  readonly artifactVersion: string;
  readonly endpointGroup: string;
  readonly status: CacheHealthSignal["status"];
  readonly cacheHitRatio: number;
  readonly errorRate: number;
  readonly windowStart: number;
  readonly totalRequests: number;
  readonly cacheHits: number;
  readonly originReads: number;
  readonly errors: number;
}

type SinkRecord = DeliveryRecord | AlertRecord;

function deliverySignalToRecord(signal: DeliverySignal, emittedAt: string): DeliveryRecord {
  return {
    type: "delivery_signal",
    schemaVersion: signal.schemaVersion,
    emittedAt,
    artifactVersion: signal.artifactVersion,
    tilePath: redactPath(signal.tilePath),
    cacheStatus: signal.cacheStatus,
    originRead: signal.originRead,
    responseBytes: signal.responseBytes,
    latencyMs: signal.latencyMs,
    statusCode: signal.statusCode,
    normalizedMethod: signal.normalizedMethod,
    receivedAt: signal.receivedAt,
  };
}

function cacheHealthToRecord(signal: CacheHealthSignal, emittedAt: string): AlertRecord {
  return {
    type: "slo_alert",
    emittedAt,
    artifactVersion: signal.artifactVersion,
    endpointGroup: signal.endpointGroup,
    status: signal.status,
    cacheHitRatio: signal.cacheHitRatio,
    errorRate: signal.errorRate,
    windowStart: signal.window.windowStart,
    totalRequests: signal.window.totalRequests,
    cacheHits: signal.window.cacheHits,
    originReads: signal.window.originReads,
    errors: signal.window.errors,
  };
}

function emitToSink(sink: ObservabilityLogSink, record: SinkRecord): void {
  if (sink.kind === "none") {
    return;
  }
  const line = `${JSON.stringify(record)}\n`;
  if (sink.kind === "stdout") {
    process.stdout.write(line);
    return;
  }
  appendFileSync(sink.path, line, { encoding: "utf8" });
}

export function emitDeliverySignalToSink(sink: ObservabilityLogSink, signal: DeliverySignal): void {
  if (sink.kind === "none") {
    return;
  }
  try {
    emitToSink(sink, deliverySignalToRecord(signal, new Date().toISOString()));
  } catch {
    // Telemetry emission must never break the request path.
  }
}

export function emitSloSignalToSink(sink: ObservabilityLogSink, signal: CacheHealthSignal): void {
  if (sink.kind === "none") {
    return;
  }
  if (signal.status !== "warn" && signal.status !== "critical") {
    return;
  }
  try {
    emitToSink(sink, cacheHealthToRecord(signal, new Date().toISOString()));
  } catch {
    // Telemetry emission must never break the request path.
  }
}
