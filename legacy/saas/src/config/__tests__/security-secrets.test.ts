import { strict as assert } from "node:assert";
import { loadRuntimeSecuritySecrets } from "../security-secrets";
import { ConfigError, ConfigErrorCode } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

const VALID_ADMIN_TOKEN = "0U0EkjpQDrwm6YDVV4IKHrOBUk-OoDFtX16CH1CWN6A";
const VALID_KEYS = {
  CSRF_SIGNING_KEY: "0040eb7fc425136c97c36f23e6134959141821d5a74cb8f83eead0b6c862a0d3",
  IP_HASH_KEY: "0b95b959cb5e5eb8135341cc64fb31cd9bca225f445806667a56e680bfb162c1",
  MFA_ENCRYPTION_KEY: "2c4b97e4c46f72900dd6eb20ed7cefb0d7f366ccf2275195fa2450c0072a334e",
} as const;
const RAW_ADMIN_TOKEN = "K7mQ2vR9xP4sD8wN3cH6zB1fT5yG0jLA";
const RAW_ADMIN_TOKEN_HEX = Buffer.from(RAW_ADMIN_TOKEN, "utf8").toString("hex");

type SecretEnv = Record<string, string | undefined>;

function productionSecrets(overrides: SecretEnv = {}): SecretEnv {
  return {
    ADMIN_API_TOKEN: VALID_ADMIN_TOKEN,
    ...VALID_KEYS,
    ...overrides,
  };
}

function assertRejected(env: SecretEnv, expectedName: string, expectedReason: string): void {
  assert.throws(
    () => loadRuntimeSecuritySecrets(env, "production"),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.code === ConfigErrorCode.INVALID_VALUE &&
      error.message.includes(expectedName) &&
      error.message.includes(expectedReason),
  );
}

const secretCollisions = [
  {
    label: "CSRF signing and IP hash keys",
    overrides: { IP_HASH_KEY: VALID_KEYS.CSRF_SIGNING_KEY.toUpperCase() },
    expectedNames: ["CSRF_SIGNING_KEY", "IP_HASH_KEY"],
    expectedPurposes: ["CSRF token signing", "audit IP hashing"],
  },
  {
    label: "CSRF signing and MFA encryption keys",
    overrides: { MFA_ENCRYPTION_KEY: VALID_KEYS.CSRF_SIGNING_KEY.toUpperCase() },
    expectedNames: ["CSRF_SIGNING_KEY", "MFA_ENCRYPTION_KEY"],
    expectedPurposes: ["CSRF token signing", "MFA secret encryption"],
  },
  {
    label: "IP hash and MFA encryption keys",
    overrides: { MFA_ENCRYPTION_KEY: VALID_KEYS.IP_HASH_KEY.toUpperCase() },
    expectedNames: ["IP_HASH_KEY", "MFA_ENCRYPTION_KEY"],
    expectedPurposes: ["audit IP hashing", "MFA secret encryption"],
  },
] as const;

const encodedAdminSecretCollisions = [
  {
    label: "admin token and CSRF signing key",
    overrides: { ADMIN_API_TOKEN: `  ${RAW_ADMIN_TOKEN}  `, CSRF_SIGNING_KEY: RAW_ADMIN_TOKEN_HEX },
    expectedName: "CSRF_SIGNING_KEY",
    expectedPurpose: "CSRF token signing",
  },
  {
    label: "admin token and IP hash key",
    overrides: { ADMIN_API_TOKEN: `  ${RAW_ADMIN_TOKEN}  `, IP_HASH_KEY: RAW_ADMIN_TOKEN_HEX.toUpperCase() },
    expectedName: "IP_HASH_KEY",
    expectedPurpose: "audit IP hashing",
  },
  {
    label: "admin token and MFA encryption key",
    overrides: { ADMIN_API_TOKEN: `  ${RAW_ADMIN_TOKEN}  `, MFA_ENCRYPTION_KEY: RAW_ADMIN_TOKEN_HEX },
    expectedName: "MFA_ENCRYPTION_KEY",
    expectedPurpose: "MFA secret encryption",
  },
] as const;

for (const environment of ["production", "staging"] as const) {
  for (const collision of secretCollisions) {
    test(`${environment} rejects a shared secret for ${collision.label}`, () => {
      assert.throws(
        () => loadRuntimeSecuritySecrets(productionSecrets(collision.overrides), environment),
        (error: unknown) =>
          error instanceof ConfigError &&
          error.code === ConfigErrorCode.INVALID_VALUE &&
          collision.expectedNames.every((name) => error.message.includes(name)) &&
          collision.expectedPurposes.every((purpose) => error.message.includes(purpose)) &&
          error.message.includes("distinct secrets"),
      );
    });
  }

  for (const collision of encodedAdminSecretCollisions) {
    test(`${environment} rejects encoded secret reuse for ${collision.label}`, () => {
      assert.throws(
        () => loadRuntimeSecuritySecrets(productionSecrets(collision.overrides), environment),
        (error: unknown) =>
          error instanceof ConfigError &&
          error.code === ConfigErrorCode.INVALID_VALUE &&
          error.message.includes("ADMIN_API_TOKEN") &&
          error.message.includes(collision.expectedName) &&
          error.message.includes("admin API authentication") &&
          error.message.includes(collision.expectedPurpose) &&
          error.message.includes("distinct secrets"),
      );
    });
  }
}

const textualMatchControls = [
  {
    environmentName: "CSRF_SIGNING_KEY",
    configKey: "csrfSigningKey",
    value: VALID_KEYS.CSRF_SIGNING_KEY,
  },
  {
    environmentName: "IP_HASH_KEY",
    configKey: "ipHashKey",
    value: VALID_KEYS.IP_HASH_KEY,
  },
  {
    environmentName: "MFA_ENCRYPTION_KEY",
    configKey: "mfaEncryptionKey",
    value: VALID_KEYS.MFA_ENCRYPTION_KEY,
  },
] as const;

for (const control of textualMatchControls) {
  test(`production accepts ${control.environmentName} hex text as the admin token because the underlying bytes differ`, () => {
    const loaded = loadRuntimeSecuritySecrets(
      productionSecrets({ ADMIN_API_TOKEN: `  ${control.value}  ` }),
      "production",
    );
    assert.equal(loaded.adminToken, control.value);
    assert.equal(loaded[control.configKey], control.value);
  });
}

test("development preserves admin-token reuse behavior", () => {
  const loaded = loadRuntimeSecuritySecrets(
    productionSecrets({ ADMIN_API_TOKEN: RAW_ADMIN_TOKEN, CSRF_SIGNING_KEY: RAW_ADMIN_TOKEN_HEX }),
    "development",
  );
  assert.deepEqual(Buffer.from(loaded.adminToken, "utf8"), Buffer.from(loaded.csrfSigningKey, "hex"));
});

test("development preserves scoped-key distinctness", () => {
  assert.throws(
    () => loadRuntimeSecuritySecrets(productionSecrets({ IP_HASH_KEY: VALID_KEYS.CSRF_SIGNING_KEY }), "development"),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.code === ConfigErrorCode.INVALID_VALUE &&
      error.message.includes("CSRF_SIGNING_KEY") &&
      error.message.includes("IP_HASH_KEY") &&
      error.message.includes("distinct secrets"),
  );
});

const weakAdminTokens = [
  {
    label: "uniform token",
    value: "a".repeat(32),
    reason: "repeated pattern",
  },
  {
    label: "repeated block token",
    value: "Ab9_".repeat(8),
    reason: "repeated pattern",
  },
  {
    label: "low-variation token",
    value: "aaaaaaaaabbbbbbbbccccccccdddddddd",
    reason: "low character variation",
  },
  {
    label: "sequential token",
    value: "01234567-XxYyZz-generated-token-safe",
    reason: "simple sequence",
  },
  {
    label: "placeholder token",
    value: "replace-this-admin-token-before-production",
    reason: "common placeholder",
  },
] as const;

for (const weak of weakAdminTokens) {
  test(`production rejects ${weak.label}`, () => {
    assertRejected(productionSecrets({ ADMIN_API_TOKEN: weak.value }), "ADMIN_API_TOKEN", weak.reason);
  });
}

const weakHexKeys = [
  {
    label: "uniform repeated-byte key",
    value: "0".repeat(64),
    reason: "repeated pattern",
  },
  {
    label: "repeated multi-byte key",
    value: "0123456789abcdef".repeat(4),
    reason: "repeated pattern",
  },
  {
    label: "low-variation key",
    value: `${"0".repeat(10)}${"1".repeat(9)}${"2".repeat(9)}${"3".repeat(9)}${"4".repeat(9)}${"5".repeat(9)}${"6".repeat(9)}`,
    reason: "low character variation",
  },
  {
    label: "sequential key",
    value: `01234567${VALID_KEYS.CSRF_SIGNING_KEY.slice(8)}`,
    reason: "simple sequence",
  },
  {
    label: "hex-encoded placeholder key",
    value: "6368616e67652d6d652d6b65792d6265666f72652d70726f642d313233343536",
    reason: "common placeholder",
  },
] as const;

for (const name of ["CSRF_SIGNING_KEY", "IP_HASH_KEY", "MFA_ENCRYPTION_KEY"] as const) {
  for (const weak of weakHexKeys) {
    test(`production rejects ${weak.label} for ${name}`, () => {
      assertRejected(productionSecrets({ [name]: weak.value }), name, weak.reason);
    });
  }
}

const validGeneratedSecretSets = [
  {
    ADMIN_API_TOKEN: VALID_ADMIN_TOKEN,
    ...VALID_KEYS,
  },
  {
    ADMIN_API_TOKEN: "86KUV_h3FP5X3K0-OKpbiakSOkhGzMt0WCON2GaTPBY",
    CSRF_SIGNING_KEY: "af73dc162e0453c611b9de23e1130e8634fd9a0c90adc071234546a0adfd7a2b",
    IP_HASH_KEY: "9c2750853abe557465dcac2a5c93cd5a37a4f9bb30d380d152b6756e5692a6b4",
    MFA_ENCRYPTION_KEY: "c83c1a092c1ce84a570710824ffab812cd91b4bdea7b07a7aa24fb6de8dde476",
  },
] as const;

for (const [index, values] of validGeneratedSecretSets.entries()) {
  test(`production accepts generated secret set ${index + 1}`, () => {
    const loaded = loadRuntimeSecuritySecrets(values, "production");
    assert.equal(loaded.adminToken, values.ADMIN_API_TOKEN);
    assert.equal(loaded.csrfSigningKey, values.CSRF_SIGNING_KEY);
    assert.equal(loaded.ipHashKey, values.IP_HASH_KEY);
    assert.equal(loaded.mfaEncryptionKey, values.MFA_ENCRYPTION_KEY);
  });
}

test("staging applies the generated-secret policy", () => {
  assert.throws(
    () => loadRuntimeSecuritySecrets(productionSecrets({ IP_HASH_KEY: "1".repeat(64) }), "staging"),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.code === ConfigErrorCode.INVALID_VALUE &&
      error.message.includes("IP_HASH_KEY") &&
      error.message.includes("repeated pattern"),
  );
});
