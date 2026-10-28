export interface StorageConfig {
  readonly mode: "memory" | "filesystem" | "s3-compatible";
  readonly bucketName: string;
  readonly region?: string;
  readonly endpoint?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
}

export interface SecurityConfig {
  readonly adminToken: string;
  readonly csrfSigningKey: string;
  readonly ipHashKey: string;
  readonly mfaEncryptionKey: string;
  readonly allowedOrigins: readonly string[];
  readonly allowedTokens: readonly string[];
  readonly corsAllowCredentials: boolean;
  readonly corsMaxAgeSeconds: number;
  readonly enableRateLimit: boolean;
  readonly rateLimitMaxRequestsPerMinute: number;
}

export type RuntimeEnvironment = "development" | "staging" | "production";

export interface RuntimeSecuritySecrets {
  readonly adminToken: string;
  readonly csrfSigningKey: string;
  readonly ipHashKey: string;
  readonly mfaEncryptionKey: string;
}

export interface TileDeliveryPolicy {
  readonly maxRangeBytes: number;
  readonly cacheTtlSeconds: number;
  readonly metadataCacheTtlSeconds: number;
  readonly headEnabled: boolean;
  readonly globalRequestBudgetPerMinute: number;
  readonly renderTimeoutMs: number;
  readonly renderMaxConcurrent: number;
}

export type ObservabilityLogSink =
  | { readonly kind: "none" }
  | { readonly kind: "stdout" }
  | { readonly kind: "file"; readonly path: string };

export interface ObservabilityConfig {
  readonly cacheWarnThreshold: number;
  readonly cacheCriticalThreshold: number;
  readonly errorWarnThreshold: number;
  readonly errorCriticalThreshold: number;
  readonly enabled: boolean;
  readonly logSink: ObservabilityLogSink;
}

export interface IngestDefaults {
  readonly snapshotId: string;
  readonly snapshotSourceUrl: string;
  readonly expectedChecksum?: string;
  readonly maxSourceBytes: number;
}

export interface RuntimeConfig {
  readonly environment: RuntimeEnvironment;
  readonly storage: StorageConfig;
  readonly security: SecurityConfig;
  readonly tileDeliveryPolicy: TileDeliveryPolicy;
  readonly observability: ObservabilityConfig;
  readonly ingestDefaults: IngestDefaults;
}

export const enum ConfigErrorCode {
  MISSING_REQUIRED = "CONFIG_MISSING_REQUIRED",
  INVALID_VALUE = "CONFIG_INVALID_VALUE",
  SECRET_UNAVAILABLE = "CONFIG_SECRET_UNAVAILABLE",
}

export class ConfigError extends Error {
  public readonly code: ConfigErrorCode;
  public readonly details?: string;

  public constructor(code: ConfigErrorCode, message: string, details?: string) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "ConfigError";
  }
}
