export const enum ObservabilityErrorCode {
  SIGNAL_SCHEMA_INVALID = "OBS_SIGNAL_SCHEMA_INVALID",
  SLO_THRESHOLD_MISCONFIGURED = "OBS_SLO_THRESHOLD_MISCONFIGURED",
  ALERT_DISPATCH_FAILED = "OBS_ALERT_DISPATCH_FAILED",
}

export class ObservabilityError extends Error {
  public readonly code: ObservabilityErrorCode;
  public readonly details: string;

  public constructor(code: ObservabilityErrorCode, details: string) {
    super(details);
    this.code = code;
    this.details = details;
    this.name = "ObservabilityError";
  }
}

export interface TileTrafficWindow {
  readonly artifactVersion: string;
  readonly endpointGroup: string;
  readonly windowStart: number;
  readonly totalRequests: number;
  readonly cacheHits: number;
  readonly originReads: number;
  readonly errors: number;
  readonly windowAgeMs: number;
}

export type SLOStatus = "ok" | "warn" | "critical";

export interface CacheHealthSignal {
  readonly artifactVersion: string;
  readonly endpointGroup: string;
  readonly status: SLOStatus;
  readonly cacheHitRatio: number;
  readonly errorRate: number;
  readonly window: Omit<TileTrafficWindow, "windowAgeMs">;
}
