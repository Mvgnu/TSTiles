import type { ObservabilityConfig, ObservabilityLogSink } from "../types";

function parseNumberWithinRange(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error("Invalid OBSERVABILITY_ENABLED");
}

function parseLogSink(value: string | undefined): ObservabilityLogSink {
  if (value === undefined) {
    return { kind: "none" };
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.toLowerCase() === "none") {
    return { kind: "none" };
  }
  if (normalized.toLowerCase() === "stdout") {
    return { kind: "stdout" };
  }
  if (normalized.toLowerCase().startsWith("file:")) {
    const path = normalized.slice("file:".length).trim();
    if (path.length === 0) {
      throw new Error("Invalid OBSERVABILITY_LOG_SINK file path");
    }
    return { kind: "file", path };
  }
  throw new Error("Invalid OBSERVABILITY_LOG_SINK");
}

export function parseObservabilityConfig(input: Record<string, string | undefined>): ObservabilityConfig {
  const enabled = parseBoolean(input.OBSERVABILITY_ENABLED, true);
  const logSink = parseLogSink(input.OBSERVABILITY_LOG_SINK);
  const config: ObservabilityConfig = {
    enabled,
    cacheWarnThreshold: parseNumberWithinRange(input.CACHE_WARN_THRESHOLD, 0.85, "CACHE_WARN_THRESHOLD"),
    cacheCriticalThreshold: parseNumberWithinRange(input.CACHE_CRITICAL_THRESHOLD, 0.7, "CACHE_CRITICAL_THRESHOLD"),
    errorWarnThreshold: parseNumberWithinRange(input.ERROR_WARN_THRESHOLD, 0.02, "ERROR_WARN_THRESHOLD"),
    errorCriticalThreshold: parseNumberWithinRange(input.ERROR_CRITICAL_THRESHOLD, 0.05, "ERROR_CRITICAL_THRESHOLD"),
    logSink,
  };
  if (config.cacheWarnThreshold <= config.cacheCriticalThreshold) {
    throw new Error("Invalid observability threshold ordering for cache hit ratio");
  }
  if (config.errorWarnThreshold >= config.errorCriticalThreshold) {
    throw new Error("Invalid observability threshold ordering for error rate");
  }
  return config;
}
