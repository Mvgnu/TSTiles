import type { DeliverySignal } from "../../contracts/types";
import {
  type CacheHealthSignal,
  type SLOStatus,
  type TileTrafficWindow,
  ObservabilityError,
  ObservabilityErrorCode,
} from "./types";
import { CONTRACT_SCHEMA_VERSION } from "../../contracts/types";
import { defaultPolicy } from "./analytics/slo-policy";
import { dispatchAlert } from "./analytics/alerts";
import { loadConfig } from "../../config/load-config";

const windows = new Map<string, TileTrafficWindow>();
const WINDOW_MS = 15 * 60 * 1000;
const WINDOW_RETENTION_COUNT = 3;
const MAX_FUTURE_SKEW_MS = WINDOW_MS;

interface SLOThresholdPolicy {
  readonly cacheWarnThreshold: number;
  readonly cacheCriticalThreshold: number;
  readonly errorWarnThreshold: number;
  readonly errorCriticalThreshold: number;
}

function normalizeSignalPath(path: string): string {
  const [withoutQuery] = path.split("?");
  const normalizedPath = withoutQuery || "/";
  return normalizedPath.startsWith("/v1/") ? normalizedPath.slice(3) : normalizedPath;
}

function buildEndpointGroup(path: string): string {
  const normalizedPath = normalizeSignalPath(path);
  const tileMatch = /^\/tiles\/\d+\/\d+\/\d+\.mvt$/i.test(normalizedPath);
  if (tileMatch) {
    return "/tiles/{z}/{x}/{y}.mvt";
  }
  if (normalizedPath === "/tiles/metadata") {
    return "/tiles/metadata";
  }
  const rasterMatch = /^\/raster\/[^/]+\/\d+\/\d+\/\d+\.(png|webp)$/i.test(normalizedPath);
  if (rasterMatch) {
    return "/raster/{styleId}/{z}/{x}/{y}.{format}";
  }
  const staticMatch = /^\/static\/[^/]+\/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,\d+(?:\.\d+)?\/\d+x\d+\.(png|webp)$/i.test(normalizedPath);
  if (staticMatch) {
    return "/static/{styleId}/{lon},{lat},{zoom}/{width}x{height}.{format}";
  }
  return normalizedPath;
}

function bucketWindowStart(signal: DeliverySignal, nowMs: number): number {
  const received = Date.parse(signal.receivedAt);
  const lowerBound = nowMs - WINDOW_MS * WINDOW_RETENTION_COUNT;
  const upperBound = nowMs + MAX_FUTURE_SKEW_MS;
  const timestamp = Number.isNaN(received)
    ? nowMs
    : Math.min(Math.max(received, lowerBound), upperBound);
  return Math.floor(timestamp / WINDOW_MS) * WINDOW_MS;
}

function computeKey(signal: DeliverySignal, endpointGroup: string, bucketStart: number): string {
  return `${signal.artifactVersion}|${endpointGroup}|${bucketStart}`;
}

function isSLOWindowNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function purgeExpiredWindows(nowMs: number): void {
  const currentWindowStart = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
  const cutoff = currentWindowStart - WINDOW_MS * WINDOW_RETENTION_COUNT;
  for (const [key, window] of windows.entries()) {
    if (window.windowStart < cutoff) {
      windows.delete(key);
    }
  }
}

function validateSignal(signal: unknown): DeliverySignal {
  if (!signal || typeof signal !== "object") {
    throw new ObservabilityError(ObservabilityErrorCode.SIGNAL_SCHEMA_INVALID, "Invalid delivery signal");
  }
  const candidate = signal as Record<string, unknown>;
  const artifactVersion = typeof candidate.artifactVersion === "string"
    ? candidate.artifactVersion.trim()
    : "";
  const tilePath = typeof candidate.tilePath === "string"
    ? candidate.tilePath.trim()
    : "";
  const normalizedMethod = candidate.normalizedMethod;
  const schemaVersion = candidate.schemaVersion;
  if (
    artifactVersion.length === 0 ||
    tilePath.length === 0 ||
    !tilePath.startsWith("/") ||
    (candidate.cacheStatus !== "hit" && candidate.cacheStatus !== "miss") ||
    typeof candidate.originRead !== "boolean" ||
    typeof candidate.responseBytes !== "number" ||
    !Number.isFinite(candidate.responseBytes) ||
    candidate.responseBytes < 0 ||
    typeof candidate.latencyMs !== "number" ||
    !Number.isFinite(candidate.latencyMs) ||
    candidate.latencyMs < 0 ||
    typeof candidate.statusCode !== "number" ||
    !Number.isFinite(candidate.statusCode) ||
    !Number.isInteger(candidate.statusCode) ||
    candidate.statusCode < 100 ||
    candidate.statusCode > 599 ||
    typeof candidate.receivedAt !== "string" ||
    candidate.receivedAt.length === 0 ||
    Number.isNaN(Date.parse(candidate.receivedAt)) ||
    typeof schemaVersion !== "number" ||
    schemaVersion !== CONTRACT_SCHEMA_VERSION ||
    (normalizedMethod !== "GET" && normalizedMethod !== "HEAD" && normalizedMethod !== "OPTIONS")
  ) {
    throw new ObservabilityError(ObservabilityErrorCode.SIGNAL_SCHEMA_INVALID, "Invalid delivery signal");
  }
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    artifactVersion,
    tilePath,
    cacheStatus: candidate.cacheStatus,
    originRead: candidate.originRead,
    responseBytes: candidate.responseBytes,
    latencyMs: candidate.latencyMs,
    statusCode: candidate.statusCode,
    normalizedMethod,
    receivedAt: candidate.receivedAt,
  };
}

function validatePolicy(policy: SLOThresholdPolicy): void {
  if (
    !isSLOWindowNumber(policy.cacheWarnThreshold) ||
    !isSLOWindowNumber(policy.cacheCriticalThreshold) ||
    !isSLOWindowNumber(policy.errorWarnThreshold) ||
    !isSLOWindowNumber(policy.errorCriticalThreshold) ||
    policy.cacheWarnThreshold < 0 ||
    policy.cacheWarnThreshold > 1 ||
    policy.cacheCriticalThreshold < 0 ||
    policy.cacheCriticalThreshold > 1 ||
    policy.errorWarnThreshold < 0 ||
    policy.errorWarnThreshold > 1 ||
    policy.errorCriticalThreshold < 0 ||
    policy.errorCriticalThreshold > 1 ||
    policy.cacheWarnThreshold <= policy.cacheCriticalThreshold ||
    policy.errorWarnThreshold >= policy.errorCriticalThreshold
  ) {
    throw new ObservabilityError(
      ObservabilityErrorCode.SLO_THRESHOLD_MISCONFIGURED,
      "Observability thresholds are invalid",
    );
  }
}

export function classifySLOBreach(
  window: Pick<TileTrafficWindow, "cacheHits" | "totalRequests" | "errors">,
  policy: SLOThresholdPolicy = defaultPolicy(),
): SLOStatus {
  if (window.totalRequests === 0) {
    return "ok";
  }
  const cacheHitRatio = window.cacheHits / window.totalRequests;
  const errorRate = window.errors / window.totalRequests;
  if (cacheHitRatio < policy.cacheCriticalThreshold || errorRate > policy.errorCriticalThreshold) {
    return "critical";
  }
  if (cacheHitRatio < policy.cacheWarnThreshold || errorRate > policy.errorWarnThreshold) {
    return "warn";
  }
  return "ok";
}

export function evaluateTileSLOs(signal: DeliverySignal): CacheHealthSignal {
  const validated = validateSignal(signal);
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch {
    throw new ObservabilityError(
      ObservabilityErrorCode.SLO_THRESHOLD_MISCONFIGURED,
      "Observability configuration is invalid",
    );
  }
  validatePolicy(config.observability);
  const endpointGroup = buildEndpointGroup(validated.tilePath);
  const now = Date.now();
  const windowStart = bucketWindowStart(validated, now);
  purgeExpiredWindows(now);
  const key = computeKey(validated, endpointGroup, windowStart);
  const existing = windows.get(key);
  const previous = existing ?? {
    artifactVersion: validated.artifactVersion,
    endpointGroup,
    windowStart,
    totalRequests: 0,
    cacheHits: 0,
    originReads: 0,
    errors: 0,
    windowAgeMs: 0,
  };

  const next: TileTrafficWindow = {
    ...previous,
    totalRequests: previous.totalRequests + 1,
    cacheHits: previous.cacheHits + (validated.cacheStatus === "hit" ? 1 : 0),
    originReads: previous.originReads + (validated.originRead ? 1 : 0),
    errors: previous.errors + (validated.statusCode >= 400 ? 1 : 0),
    windowAgeMs: now - previous.windowStart,
  };

  windows.set(key, next);
  const cacheHitRatio = next.cacheHits / next.totalRequests;
  const errorRate = next.errors / next.totalRequests;
  const status = classifySLOBreach(next, config.observability);
  const signalResult: CacheHealthSignal = {
    artifactVersion: validated.artifactVersion,
    endpointGroup: next.endpointGroup,
    status,
    cacheHitRatio,
    errorRate,
    window: {
      artifactVersion: next.artifactVersion,
      endpointGroup: next.endpointGroup,
      windowStart: next.windowStart,
      totalRequests: next.totalRequests,
      cacheHits: next.cacheHits,
      originReads: next.originReads,
      errors: next.errors,
    },
  };
  try {
    dispatchAlert(signalResult, config.observability.enabled);
  } catch {
    // Alert delivery is best-effort and must not fail SLO computation.
  }
  return signalResult;
}
