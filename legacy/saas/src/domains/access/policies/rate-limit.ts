const counters = new Map<string, { windowStart: number; count: number }>();
const windowDurationMs = 60_000;
const retentionWindowCount = 10;
const cleanupIntervalRequests = 256;
let requestsSinceCleanup = 0;

function maybeCleanupCounters(now: number): void {
  requestsSinceCleanup += 1;
  if (requestsSinceCleanup < cleanupIntervalRequests) {
    return;
  }
  requestsSinceCleanup = 0;
  const maxAge = windowDurationMs * retentionWindowCount;
  for (const [clientKey, bucket] of counters.entries()) {
    if (now - bucket.windowStart > maxAge) {
      counters.delete(clientKey);
    }
  }
}

export function checkRateLimit(
  clientKey: string,
  maxRequestsPerMinute: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  maybeCleanupCounters(now);
  const bucket = counters.get(clientKey);
  if (!bucket || now - bucket.windowStart > windowDurationMs) {
    const refreshed = { windowStart: now, count: 1 };
    counters.set(clientKey, refreshed);
    return { allowed: true, remaining: Math.max(maxRequestsPerMinute - 1, 0) };
  }
  if (bucket.count >= maxRequestsPerMinute) {
    return { allowed: false, remaining: 0 };
  }
  bucket.count += 1;
  return { allowed: true, remaining: Math.max(maxRequestsPerMinute - bucket.count, 0) };
}
