import type { ObservabilityConfig } from "../types";

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

export function parseObservabilityConfig(input: Record<string, string | undefined>): ObservabilityConfig {
  const enabled = parseBoolean(input.OBSERVABILITY_ENABLED, true);
  const config: ObservabilityConfig = {
    enabled,
    cacheWarnThreshold: parseNumberWithinRange(input.CACHE_WARN_THRESHOLD, 0.85, "CACHE_WARN_THRESHOLD"),
    cacheCriticalThreshold: parseNumberWithinRange(input.CACHE_CRITICAL_THRESHOLD, 0.7, "CACHE_CRITICAL_THRESHOLD"),
    errorWarnThreshold: parseNumberWithinRange(input.ERROR_WARN_THRESHOLD, 0.02, "ERROR_WARN_THRESHOLD"),
    errorCriticalThreshold: parseNumberWithinRange(input.ERROR_CRITICAL_THRESHOLD, 0.05, "ERROR_CRITICAL_THRESHOLD"),
  };
  if (config.cacheWarnThreshold <= config.cacheCriticalThreshold) {
    throw new Error("Invalid observability threshold ordering for cache hit ratio");
  }
  if (config.errorWarnThreshold >= config.errorCriticalThreshold) {
    throw new Error("Invalid observability threshold ordering for error rate");
  }
  return config;
}
