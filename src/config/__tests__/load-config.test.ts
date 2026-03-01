import { strict as assert } from "node:assert";
import { ConfigError, ConfigErrorCode } from "../types";
import { loadConfig, redactConfig } from "../load-config";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

const resetConfigEnv = (env: Readonly<Record<string, string | undefined>>): void => {
  const baseEnv: Record<string, string | undefined> = {
    NODE_ENV: "development",
    OBJECT_STORE_BUCKET: "test-bucket",
    ADMIN_TOKEN: "admin-token",
    ALLOWED_ORIGINS: "*",
    ALLOWED_TILES_TOKENS: "",
    OBJECT_STORE_MODE: "memory",
    CORS_ALLOW_CREDENTIALS: "false",
    CORS_MAX_AGE_SECONDS: "600",
    ENABLE_RATE_LIMIT: "true",
    RATE_LIMIT_MAX_REQUESTS_PER_MINUTE: "120",
    HEAD_ENABLED: "true",
    STORAGE_MAX_RANGE_BYTES: "5242880",
    CACHE_TTL_SECONDS: "300",
    METADATA_CACHE_TTL_SECONDS: "120",
    OBSERVABILITY_ENABLED: "true",
    CACHE_WARN_THRESHOLD: "0.85",
    CACHE_CRITICAL_THRESHOLD: "0.7",
    ERROR_WARN_THRESHOLD: "0.02",
    ERROR_CRITICAL_THRESHOLD: "0.05",
    INGEST_SNAPSHOT_ID: "snapshot-latest",
    INGEST_SNAPSHOT_URL: "https://example.com/planet-latest.osm.pbf",
    INGEST_EXPECTED_CHECKSUM: undefined,
  };
  const mergedEnv: Record<string, string | undefined> = {
    ...baseEnv,
    ...env,
  };
  for (const [key, value] of Object.entries(mergedEnv)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
      continue;
    }
    process.env[key as keyof typeof process.env] = value;
  }
};

test("configuration loading and redaction", () => {
  resetConfigEnv({});
  const config = loadConfig();
  assert.equal(config.environment, "development");
  assert.equal(config.storage.bucketName, "test-bucket");
  assert.equal(config.storage.mode, "memory");
  assert.equal(config.security.adminToken, "admin-token");
  assert.equal(config.tileDeliveryPolicy.headEnabled, true);
  assert.equal(config.observability.enabled, true);
  assert.equal(config.ingestDefaults.snapshotId, "snapshot-latest");

  resetConfigEnv({
    INGEST_EXPECTED_CHECKSUM: "A".repeat(64),
    INGEST_SNAPSHOT_ID: "my-snapshot",
    STORAGE_MAX_RANGE_BYTES: "8192",
  });
  const withOverrides = loadConfig();
  assert.equal(withOverrides.ingestDefaults.expectedChecksum, "a".repeat(64));
  assert.equal(withOverrides.ingestDefaults.snapshotId, "my-snapshot");
  assert.equal(withOverrides.tileDeliveryPolicy.maxRangeBytes, 8192);

  resetConfigEnv({
    INGEST_SNAPSHOT_URL: "   ",
  });
  try {
    loadConfig();
    assert.fail("expected blank INGEST_SNAPSHOT_URL to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    INGEST_EXPECTED_CHECKSUM: "xyz",
  });
  try {
    loadConfig();
    assert.fail("expected invalid checksum shape to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    OBJECT_STORE_BUCKET: undefined,
  });
  try {
    loadConfig();
    assert.fail("expected missing bucket to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.MISSING_REQUIRED);
  }

  resetConfigEnv({
    OBJECT_STORE_BUCKET: "   ",
  });
  try {
    loadConfig();
    assert.fail("expected blank bucket to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.MISSING_REQUIRED);
  }

  resetConfigEnv({
    OBJECT_STORE_MODE: "  memory  ",
  });
  const withTrimmedMode = loadConfig();
  assert.equal(withTrimmedMode.storage.mode, "memory");

  resetConfigEnv({
    NODE_ENV: "development",
    OBJECT_STORE_MODE: undefined,
  });
  const devDefaultMode = loadConfig();
  assert.equal(devDefaultMode.storage.mode, "memory");

  resetConfigEnv({
    NODE_ENV: "production",
    OBJECT_STORE_MODE: undefined,
    OBJECT_STORE_ACCESS_KEY_ID: "akid",
    OBJECT_STORE_SECRET_ACCESS_KEY: "secret",
  });
  const prodDefaultMode = loadConfig();
  assert.equal(prodDefaultMode.storage.mode, "s3-compatible");

  resetConfigEnv({
    OBJECT_STORE_MODE: "invalid-mode",
  });
  try {
    loadConfig();
    assert.fail("expected invalid mode to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    NODE_ENV: "staging",
    CACHE_WARN_THRESHOLD: "1.5",
  });
  try {
    loadConfig();
    assert.fail("expected invalid observability threshold to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    ENABLE_RATE_LIMIT: "sometimes",
  });
  try {
    loadConfig();
    assert.fail("expected invalid boolean security flag to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    HEAD_ENABLED: "nope",
  });
  try {
    loadConfig();
    assert.fail("expected invalid HEAD_ENABLED flag to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    OBSERVABILITY_ENABLED: "enabled",
  });
  try {
    loadConfig();
    assert.fail("expected invalid observability enabled flag to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    CACHE_TTL_SECONDS: "60.5",
  });
  try {
    loadConfig();
    assert.fail("expected fractional CACHE_TTL_SECONDS to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    RATE_LIMIT_MAX_REQUESTS_PER_MINUTE: "120.5",
  });
  try {
    loadConfig();
    assert.fail("expected fractional RATE_LIMIT_MAX_REQUESTS_PER_MINUTE to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    CACHE_WARN_THRESHOLD: "0.7",
    CACHE_CRITICAL_THRESHOLD: "0.7",
  });
  try {
    loadConfig();
    assert.fail("expected invalid cache threshold ordering to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    CACHE_WARN_THRESHOLD: "0.85",
    CACHE_CRITICAL_THRESHOLD: "0.7",
    ERROR_WARN_THRESHOLD: "0.05",
    ERROR_CRITICAL_THRESHOLD: "0.05",
  });
  try {
    loadConfig();
    assert.fail("expected invalid error threshold ordering to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    OBJECT_STORE_MODE: "s3-compatible",
    OBJECT_STORE_ACCESS_KEY_ID: undefined,
    OBJECT_STORE_SECRET_ACCESS_KEY: undefined,
  });
  try {
    loadConfig();
    assert.fail("expected missing s3 credentials to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.MISSING_REQUIRED);
  }

  resetConfigEnv({
    ADMIN_TOKEN: undefined,
  });
  try {
    loadConfig();
    assert.fail("expected invalid security config to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.SECRET_UNAVAILABLE);
  }

  resetConfigEnv({
    NODE_ENV: "invalid-env",
  });
  try {
    loadConfig();
    assert.fail("expected invalid NODE_ENV to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    ADMIN_TOKEN: "very-secret-admin-token",
    ALLOWED_TILES_TOKENS: "token-a,token-b",
    OBJECT_STORE_ACCESS_KEY_ID: "ak-id",
    OBJECT_STORE_SECRET_ACCESS_KEY: "ak-secret",
  });
  const withSecrets = loadConfig();
  const redacted = redactConfig(withSecrets);
  assert.equal(redacted.security.adminToken, "[redacted]");
  assert.equal(redacted.security.allowedTokens.length, 2);
  assert.equal(redacted.security.allowedTokens.every((value) => value === "[redacted]"), true);
  assert.equal(redacted.storage.accessKeyId, "[redacted]");
  assert.equal(redacted.storage.secretAccessKey, "[redacted]");
  assert.equal(redacted.storage.bucketName, withSecrets.storage.bucketName);
});
