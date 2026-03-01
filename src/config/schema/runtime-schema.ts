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
  return (
    !!input &&
    typeof input === "object" &&
    typeof (input as RuntimeConfig).storage === "object" &&
    typeof (input as RuntimeConfig).security === "object" &&
    typeof (input as RuntimeConfig).tileDeliveryPolicy === "object" &&
    typeof (input as RuntimeConfig).observability === "object" &&
    typeof (input as RuntimeConfig).environment === "string"
  );
}
