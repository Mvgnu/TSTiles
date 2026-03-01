export function isOriginAllowed(origin: string | undefined, allowlist: readonly string[]): boolean {
  if (!allowlist.length || allowlist.includes("*")) {
    return true;
  }
  if (!origin) {
    return false;
  }
  return allowlist.some((allowed) => {
    if (!allowed.includes("://")) {
      if (allowed.startsWith("*.")) {
        const suffix = allowed.slice(2);
        try {
          const candidate = new URL(origin);
          const candidateHost = candidate.hostname.toLowerCase();
          const normalizedSuffix = suffix.toLowerCase();
          return candidateHost === normalizedSuffix || candidateHost.endsWith(`.${normalizedSuffix}`);
        } catch {
          const normalizedOrigin = origin.toLowerCase();
          const normalizedSuffix = suffix.toLowerCase();
          return normalizedOrigin === normalizedSuffix || normalizedOrigin.endsWith(`.${normalizedSuffix}`);
        }
      }
      return allowed.toLowerCase() === origin.toLowerCase();
    }
    if (allowed.includes("://*.")) {
      const wildcardProtocolIndex = allowed.indexOf("://*.");
      const allowedProtocol = allowed.slice(0, wildcardProtocolIndex).toLowerCase();
      const wildcardSuffix = allowed.slice(wildcardProtocolIndex + 5).toLowerCase();
      try {
        const candidate = new URL(origin);
        if (candidate.protocol !== `${allowedProtocol}:`) {
          return false;
        }
        const candidateHost = candidate.hostname.toLowerCase();
        return candidateHost === wildcardSuffix || candidateHost.endsWith(`.${wildcardSuffix}`);
      } catch {
        return false;
      }
      }
    return allowed.toLowerCase() === origin.toLowerCase();
  });
}
