import { ConfigError, ConfigErrorCode, type ObservabilityConfig, type RuntimeConfig, type SecurityConfig } from "./types";
import { parseSecurityConfig } from "./schema/security-schema";
import { parseObservabilityConfig } from "./schema/observability-schema";
import { normalizeRuntimeConfig } from "./schema/runtime-schema";

function parsePositiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, `Invalid number for ${label}`, `${label}=${value}`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, label: string): boolean {
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
  throw new ConfigError(ConfigErrorCode.INVALID_VALUE, `Invalid boolean for ${label}`, `${label}=${value}`);
}

function parseOptionalNonEmptyString(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, `${label} must be non-empty`, `${label}=${value}`);
  }
  return normalized;
}

function parseOptionalSha256(value: string | undefined, label: string): string | undefined {
  const normalized = parseOptionalNonEmptyString(value, label);
  if (normalized === undefined) {
    return undefined;
  }
  const lower = normalized.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(lower)) {
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, `${label} must be a 64-char sha256 hex digest`, `${label}=${value}`);
  }
  return lower;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const environment = (env.NODE_ENV?.trim() ?? "development") as RuntimeConfig["environment"];
  if (environment !== "development" && environment !== "staging" && environment !== "production") {
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, "Invalid NODE_ENV", environment);
  }
  const normalizedMode = env.OBJECT_STORE_MODE?.trim().toLowerCase();
  const mode = (normalizedMode as RuntimeConfig["storage"]["mode"] | undefined)
    ?? (environment === "development" ? "memory" : "s3-compatible");
  if (mode !== "memory" && mode !== "s3-compatible") {
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, "Invalid object store mode", mode);
  }

  const bucketName = env.OBJECT_STORE_BUCKET?.trim();
  if (!bucketName) {
    throw new ConfigError(ConfigErrorCode.MISSING_REQUIRED, "OBJECT_STORE_BUCKET is required");
  }
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.trim().length === 0) {
    throw new ConfigError(ConfigErrorCode.SECRET_UNAVAILABLE, "ADMIN_TOKEN is required");
  }
  if (mode === "s3-compatible") {
    if (!env.OBJECT_STORE_ACCESS_KEY_ID || env.OBJECT_STORE_ACCESS_KEY_ID.trim().length === 0) {
      throw new ConfigError(ConfigErrorCode.MISSING_REQUIRED, "OBJECT_STORE_ACCESS_KEY_ID is required");
    }
    if (!env.OBJECT_STORE_SECRET_ACCESS_KEY || env.OBJECT_STORE_SECRET_ACCESS_KEY.trim().length === 0) {
      throw new ConfigError(ConfigErrorCode.SECRET_UNAVAILABLE, "OBJECT_STORE_SECRET_ACCESS_KEY is required");
    }
  }

  let security: SecurityConfig;
  try {
    security = parseSecurityConfig(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid security config";
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, message);
  }
  let observability: ObservabilityConfig;
  try {
    observability = parseObservabilityConfig(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid observability config";
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, message);
  }

  const config: RuntimeConfig = {
    environment,
    storage: {
      mode,
      bucketName,
      region: env.OBJECT_STORE_REGION,
      endpoint: env.OBJECT_STORE_ENDPOINT,
      accessKeyId: env.OBJECT_STORE_ACCESS_KEY_ID,
      secretAccessKey: env.OBJECT_STORE_SECRET_ACCESS_KEY,
    },
    security,
    tileDeliveryPolicy: {
      maxRangeBytes: parsePositiveInteger(env.STORAGE_MAX_RANGE_BYTES, 5 * 1024 * 1024, "STORAGE_MAX_RANGE_BYTES"),
      cacheTtlSeconds: parsePositiveInteger(env.CACHE_TTL_SECONDS, 300, "CACHE_TTL_SECONDS"),
      metadataCacheTtlSeconds: parsePositiveInteger(env.METADATA_CACHE_TTL_SECONDS, 120, "METADATA_CACHE_TTL_SECONDS"),
      headEnabled: parseBoolean(env.HEAD_ENABLED, true, "HEAD_ENABLED"),
    },
    observability,
    ingestDefaults: {
      snapshotId: parseOptionalNonEmptyString(env.INGEST_SNAPSHOT_ID, "INGEST_SNAPSHOT_ID") ?? "snapshot-latest",
      snapshotSourceUrl: parseOptionalNonEmptyString(env.INGEST_SNAPSHOT_URL, "INGEST_SNAPSHOT_URL") ?? "https://example.com/planet-latest.osm.pbf",
      expectedChecksum: parseOptionalSha256(env.INGEST_EXPECTED_CHECKSUM, "INGEST_EXPECTED_CHECKSUM"),
    },
  };

  return normalizeRuntimeConfig({
    environment: config.environment,
    storage: config.storage,
    security,
    tileDeliveryPolicy: config.tileDeliveryPolicy,
    observability: config.observability,
    ingestDefaults: config.ingestDefaults,
  });
}

export function redactConfig(input: RuntimeConfig): Omit<RuntimeConfig, "security" | "storage"> & {
  readonly security: {
    readonly adminToken: string;
    readonly allowedOrigins: RuntimeConfig["security"]["allowedOrigins"];
    readonly allowedTokens: RuntimeConfig["security"]["allowedTokens"];
    readonly corsAllowCredentials: RuntimeConfig["security"]["corsAllowCredentials"];
    readonly corsMaxAgeSeconds: RuntimeConfig["security"]["corsMaxAgeSeconds"];
    readonly enableRateLimit: RuntimeConfig["security"]["enableRateLimit"];
    readonly rateLimitMaxRequestsPerMinute: RuntimeConfig["security"]["rateLimitMaxRequestsPerMinute"];
  };
  readonly storage: {
    readonly mode: RuntimeConfig["storage"]["mode"];
    readonly bucketName: RuntimeConfig["storage"]["bucketName"];
    readonly region?: RuntimeConfig["storage"]["region"];
    readonly endpoint?: RuntimeConfig["storage"]["endpoint"];
    readonly accessKeyId?: string;
    readonly secretAccessKey?: string;
  };
} {
  return {
    environment: input.environment,
    storage: {
      ...input.storage,
      accessKeyId: input.storage.accessKeyId ? "[redacted]" : undefined,
      secretAccessKey: input.storage.secretAccessKey ? "[redacted]" : undefined,
    },
    security: {
      ...input.security,
      adminToken: "[redacted]",
      allowedTokens: input.security.allowedTokens.map(() => "[redacted]"),
    },
    tileDeliveryPolicy: input.tileDeliveryPolicy,
    observability: input.observability,
    ingestDefaults: input.ingestDefaults,
  };
}
