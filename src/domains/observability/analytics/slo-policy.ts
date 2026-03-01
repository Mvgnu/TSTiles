export interface SLOPolicy {
  readonly cacheWarnThreshold: number;
  readonly cacheCriticalThreshold: number;
  readonly errorWarnThreshold: number;
  readonly errorCriticalThreshold: number;
}

export function defaultPolicy(): SLOPolicy {
  return {
    cacheWarnThreshold: 0.85,
    cacheCriticalThreshold: 0.7,
    errorWarnThreshold: 0.02,
    errorCriticalThreshold: 0.05,
  };
}
