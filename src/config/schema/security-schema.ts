import { loadRuntimeSecuritySecrets } from "../security-secrets";
import type { RuntimeEnvironment, SecurityConfig } from "../types";

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
  throw new Error("Invalid boolean value");
}

function parsePositiveInt(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
}

export function parseSecurityConfig(
  input: Record<string, string | undefined>,
  environment: RuntimeEnvironment,
): SecurityConfig {
  const secrets = loadRuntimeSecuritySecrets(input, environment);

  const allowedOrigins = (input.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const allowedTokens = (input.ALLOWED_TILES_TOKENS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    ...secrets,
    allowedOrigins: allowedOrigins.length ? allowedOrigins : ["*"],
    allowedTokens,
    corsAllowCredentials: parseBoolean(input.CORS_ALLOW_CREDENTIALS, false),
    corsMaxAgeSeconds: parsePositiveInt(input.CORS_MAX_AGE_SECONDS, 600, "CORS_MAX_AGE_SECONDS"),
    enableRateLimit: parseBoolean(input.ENABLE_RATE_LIMIT, true),
    rateLimitMaxRequestsPerMinute: parsePositiveInt(
      input.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE,
      120,
      "RATE_LIMIT_MAX_REQUESTS_PER_MINUTE",
    ),
  };
}
