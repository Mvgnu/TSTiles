export function isTokenAllowed(rawAuthorization: string | undefined, allowedTokens: readonly string[]): boolean {
  if (!allowedTokens.length) {
    return true;
  }
  if (!rawAuthorization) {
    return false;
  }
  const normalized = rawAuthorization.trim();
  if (normalized.toLowerCase().startsWith("bearer ")) {
    const token = normalized.slice(7).trim();
    return allowedTokens.includes(token);
  }
  return allowedTokens.includes(normalized);
}
