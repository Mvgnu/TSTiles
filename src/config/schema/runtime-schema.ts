import type {
  RuntimeConfig,
  StorageConfig,
  SecurityConfig,
  TileDeliveryPolicy,
  ObservabilityConfig,
  IngestDefaults,
} from "../types";

export interface RuntimeSchemaInput {
  readonly environment: RuntimeConfig["environment"];
  readonly storage: StorageConfig;
  readonly security: SecurityConfig;
  readonly tileDeliveryPolicy: TileDeliveryPolicy;
  readonly observability: ObservabilityConfig;
  readonly ingestDefaults: IngestDefaults;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeRuntimeConfig(input: RuntimeSchemaInput): RuntimeSchemaInput {
  return {
    environment: input.environment,
    storage: input.storage,
    security: input.security,
    tileDeliveryPolicy: input.tileDeliveryPolicy,
    observability: input.observability,
    ingestDefaults: input.ingestDefaults,
  };
}

export function isRuntimeConfig(input: unknown): input is RuntimeConfig {
  if (!isRecord(input)) {
    return false;
  }
  return (
    isRecord(input.storage) &&
    isRecord(input.security) &&
    isRecord(input.tileDeliveryPolicy) &&
    isRecord(input.observability) &&
    typeof input.environment === "string"
  );
}
