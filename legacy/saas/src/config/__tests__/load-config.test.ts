import { strict as assert } from "node:assert";
import { ConfigError, ConfigErrorCode } from "../types";
import { loadConfig as loadRuntimeConfig, redactConfig } from "../load-config";
import { DEVELOPMENT_ONLY_SECURITY_DEFAULTS } from "../security-secrets";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

let testEnv: Record<string, string | undefined> = {};

const loadConfig = () => loadRuntimeConfig(testEnv);

const validAdminToken = "0U0EkjpQDrwm6YDVV4IKHrOBUk-OoDFtX16CH1CWN6A";
const validCsrfKey = "0040eb7fc425136c97c36f23e6134959141821d5a74cb8f83eead0b6c862a0d3";
const validIpHashKey = "0b95b959cb5e5eb8135341cc64fb31cd9bca225f445806667a56e680bfb162c1";
const validMfaKey = "2c4b97e4c46f72900dd6eb20ed7cefb0d7f366ccf2275195fa2450c0072a334e";

const resetConfigEnv = (env: Readonly<Record<string, string | undefined>>): void => {
  const baseEnv: Record<string, string | undefined> = {
    NODE_ENV: "development",
    OBJECT_STORE_BUCKET: "test-bucket",
    ADMIN_TOKEN: validAdminToken,
    ADMIN_API_TOKEN: undefined,
    CSRF_SIGNING_KEY: validCsrfKey,
    IP_HASH_KEY: validIpHashKey,
    MFA_ENCRYPTION_KEY: validMfaKey,
    ALLOWED_ORIGINS: "*",
    ALLOWED_TILES_TOKENS: "",
    OBJECT_STORE_MODE: "memory",
    CORS_ALLOW_CREDENTIALS: "false",
    CORS_MAX_AGE_SECONDS: "600",
    ENABLE_RATE_LIMIT: "true",
    RATE_LIMIT_MAX_REQUESTS_PER_MINUTE: "120",
    HEAD_ENABLED: "true",
    STORAGE_MAX_RANGE_BYTES: "5242880",
    GLOBAL_REQUEST_BUDGET_PER_MINUTE: "0",
    CACHE_TTL_SECONDS: "300",
    METADATA_CACHE_TTL_SECONDS: "120",
    RENDER_TIMEOUT_MS: "15000",
    RENDER_MAX_CONCURRENT: "8",
    RENDER_BACKEND: "local",
    OBSERVABILITY_ENABLED: "true",
    CACHE_WARN_THRESHOLD: "0.85",
    CACHE_CRITICAL_THRESHOLD: "0.7",
    ERROR_WARN_THRESHOLD: "0.02",
    ERROR_CRITICAL_THRESHOLD: "0.05",
    INGEST_SNAPSHOT_ID: "snapshot-latest",
    INGEST_SNAPSHOT_URL: "https://example.com/planet-latest.osm.pbf",
    INGEST_EXPECTED_CHECKSUM: undefined,
    INGEST_MAX_SOURCE_BYTES: "10737418240",
  };
  testEnv = {
    ...baseEnv,
    ...env,
  };
};

test("configuration loading and redaction", () => {
  resetConfigEnv({});
  const config = loadConfig();
  assert.equal(config.environment, "development");
  assert.equal(config.storage.bucketName, "test-bucket");
  assert.equal(config.storage.mode, "memory");
  assert.equal(config.security.adminToken, validAdminToken);
  assert.equal(config.security.csrfSigningKey.length, 64);
  assert.equal(config.security.ipHashKey.length, 64);
  assert.equal(config.security.mfaEncryptionKey.length, 64);
  assert.equal(config.tileDeliveryPolicy.headEnabled, true);
  assert.equal(config.tileDeliveryPolicy.globalRequestBudgetPerMinute, 0);
  assert.equal(config.tileDeliveryPolicy.renderTimeoutMs, 15000);
  assert.equal(config.tileDeliveryPolicy.renderMaxConcurrent, 8);
  assert.equal(config.observability.enabled, true);
  assert.equal(config.ingestDefaults.snapshotId, "snapshot-latest");
  assert.equal(config.ingestDefaults.maxSourceBytes, 10 * 1024 * 1024 * 1024);

  resetConfigEnv({
    INGEST_EXPECTED_CHECKSUM: "A".repeat(64),
    INGEST_SNAPSHOT_ID: "my-snapshot",
    STORAGE_MAX_RANGE_BYTES: "8192",
    INGEST_MAX_SOURCE_BYTES: "2048",
  });
  const withOverrides = loadConfig();
  assert.equal(withOverrides.ingestDefaults.expectedChecksum, "a".repeat(64));
  assert.equal(withOverrides.ingestDefaults.snapshotId, "my-snapshot");
  assert.equal(withOverrides.ingestDefaults.maxSourceBytes, 2048);
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
    INGEST_MAX_SOURCE_BYTES: "0",
  });
  try {
    loadConfig();
    assert.fail("expected non-positive INGEST_MAX_SOURCE_BYTES to fail");
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
  });
  const prodDefaultMode = loadConfig();
  assert.equal(prodDefaultMode.storage.mode, "filesystem");

  resetConfigEnv({
    NODE_ENV: "production",
    OBJECT_STORE_MODE: "filesystem",
  });
  const explicitFilesystemMode = loadConfig();
  assert.equal(explicitFilesystemMode.storage.mode, "filesystem");

  resetConfigEnv({
    NODE_ENV: "production",
    OBJECT_STORE_MODE: "memory",
  });
  try {
    loadConfig();
    assert.fail("expected memory mode in production to be rejected");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    NODE_ENV: "staging",
    OBJECT_STORE_MODE: "memory",
  });
  try {
    loadConfig();
    assert.fail("expected memory mode in staging to be rejected");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    NODE_ENV: "production",
    OBJECT_STORE_MODE: "s3-compatible",
    OBJECT_STORE_ACCESS_KEY_ID: "akid",
    OBJECT_STORE_SECRET_ACCESS_KEY: "secret",
  });
  const explicitS3Mode = loadConfig();
  assert.equal(explicitS3Mode.storage.mode, "s3-compatible");

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
    GLOBAL_REQUEST_BUDGET_PER_MINUTE: "-1",
  });
  try {
    loadConfig();
    assert.fail("expected negative GLOBAL_REQUEST_BUDGET_PER_MINUTE to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    GLOBAL_REQUEST_BUDGET_PER_MINUTE: "500",
  });
  const withGlobalBudget = loadConfig();
  assert.equal(withGlobalBudget.tileDeliveryPolicy.globalRequestBudgetPerMinute, 500);

  resetConfigEnv({
    RENDER_TIMEOUT_MS: "0",
  });
  try {
    loadConfig();
    assert.fail("expected non-positive RENDER_TIMEOUT_MS to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    RENDER_MAX_CONCURRENT: "-1",
  });
  try {
    loadConfig();
    assert.fail("expected negative RENDER_MAX_CONCURRENT to fail");
  } catch (error: unknown) {
    assert.ok(error instanceof ConfigError);
    assert.equal((error as ConfigError).code, ConfigErrorCode.INVALID_VALUE);
  }

  resetConfigEnv({
    RENDER_MAX_CONCURRENT: "0",
  });
  const withRenderKillSwitch = loadConfig();
  assert.equal(withRenderKillSwitch.tileDeliveryPolicy.renderMaxConcurrent, 0);

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
    NODE_ENV: "production",
    OBJECT_STORE_MODE: "filesystem",
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
    NODE_ENV: "development",
    ADMIN_TOKEN: undefined,
    CSRF_SIGNING_KEY: undefined,
    IP_HASH_KEY: undefined,
    MFA_ENCRYPTION_KEY: undefined,
  });
  const withDevelopmentOnlyDefaults = loadConfig();
  assert.deepEqual(
    {
      adminToken: withDevelopmentOnlyDefaults.security.adminToken,
      csrfSigningKey: withDevelopmentOnlyDefaults.security.csrfSigningKey,
      ipHashKey: withDevelopmentOnlyDefaults.security.ipHashKey,
      mfaEncryptionKey: withDevelopmentOnlyDefaults.security.mfaEncryptionKey,
    },
    DEVELOPMENT_ONLY_SECURITY_DEFAULTS,
  );

  for (const missingSecret of ["CSRF_SIGNING_KEY", "IP_HASH_KEY", "MFA_ENCRYPTION_KEY"] as const) {
    resetConfigEnv({
      NODE_ENV: "production",
      OBJECT_STORE_MODE: "filesystem",
      [missingSecret]: undefined,
    });
    assert.throws(
      () => loadConfig(),
      (error: unknown) =>
        error instanceof ConfigError &&
        error.code === ConfigErrorCode.SECRET_UNAVAILABLE &&
        error.message.includes(missingSecret),
    );
  }

  resetConfigEnv({
    NODE_ENV: "production",
    OBJECT_STORE_MODE: "filesystem",
    ADMIN_TOKEN: "demo-admin-token",
  });
  assert.throws(
    () => loadConfig(),
    (error: unknown) => error instanceof ConfigError && error.code === ConfigErrorCode.INVALID_VALUE,
  );

  resetConfigEnv({
    NODE_ENV: "production",
    OBJECT_STORE_MODE: "filesystem",
    ADMIN_TOKEN: undefined,
    ADMIN_API_TOKEN: validAdminToken,
  });
  assert.equal(loadConfig().security.adminToken, validAdminToken);

  resetConfigEnv({
    NODE_ENV: "production",
    OBJECT_STORE_MODE: "filesystem",
    IP_HASH_KEY: validCsrfKey,
  });
  assert.throws(
    () => loadConfig(),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.code === ConfigErrorCode.INVALID_VALUE &&
      error.message.includes("distinct"),
  );

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
  assert.equal(redacted.security.csrfSigningKey, "[redacted]");
  assert.equal(redacted.security.ipHashKey, "[redacted]");
  assert.equal(redacted.security.mfaEncryptionKey, "[redacted]");
  assert.equal(redacted.security.allowedTokens.length, 2);
  assert.equal(redacted.security.allowedTokens.every((value) => value === "[redacted]"), true);
  assert.equal(redacted.storage.accessKeyId, "[redacted]");
  assert.equal(redacted.storage.secretAccessKey, "[redacted]");
  assert.equal(redacted.storage.bucketName, withSecrets.storage.bucketName);
});
