const counters = new Map<string, { windowStart: number; count: number }>();

export function checkRateLimit(
  clientKey: string,
  maxRequestsPerMinute: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const bucket = counters.get(clientKey);
  if (!bucket || now - bucket.windowStart > 60_000) {
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
