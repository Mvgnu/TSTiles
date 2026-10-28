import { ConfigError, ConfigErrorCode, type RuntimeEnvironment, type RuntimeSecuritySecrets } from "./types";

export const DEVELOPMENT_ONLY_SECURITY_DEFAULTS: RuntimeSecuritySecrets = {
  adminToken: "demo-admin-token",
  csrfSigningKey: "272090b0342e171af96cd210b03ff6f757fd7f54d059902f72df627346cbcb60",
  ipHashKey: "354a6473135797aa819645108bb0077f75cc99555af2f19329eb3fbbc96176cd",
  mfaEncryptionKey: "6d66612d64656661756c742d6b65792d33322d62797465732d6c6f6e67212121",
};

type HexSecretName = "CSRF_SIGNING_KEY" | "IP_HASH_KEY" | "MFA_ENCRYPTION_KEY";

interface RuntimeSecretUse {
  readonly configKey: keyof RuntimeSecuritySecrets;
  readonly environmentName: "ADMIN_API_TOKEN" | HexSecretName;
  readonly purpose: string;
}

const RUNTIME_SECRET_USES: readonly RuntimeSecretUse[] = [
  {
    configKey: "adminToken",
    environmentName: "ADMIN_API_TOKEN",
    purpose: "admin API authentication",
  },
  {
    configKey: "csrfSigningKey",
    environmentName: "CSRF_SIGNING_KEY",
    purpose: "CSRF token signing",
  },
  {
    configKey: "ipHashKey",
    environmentName: "IP_HASH_KEY",
    purpose: "audit IP hashing",
  },
  {
    configKey: "mfaEncryptionKey",
    environmentName: "MFA_ENCRYPTION_KEY",
    purpose: "MFA secret encryption",
  },
];

const DEVELOPMENT_HEX_DEFAULTS: Readonly<Record<HexSecretName, string>> = {
  CSRF_SIGNING_KEY: DEVELOPMENT_ONLY_SECURITY_DEFAULTS.csrfSigningKey,
  IP_HASH_KEY: DEVELOPMENT_ONLY_SECURITY_DEFAULTS.ipHashKey,
  MFA_ENCRYPTION_KEY: DEVELOPMENT_ONLY_SECURITY_DEFAULTS.mfaEncryptionKey,
};

type GeneratedSecretRejection = "common placeholder" | "repeated pattern" | "low character variation" | "simple sequence";
type SecretEncoding = "text" | "hex";

const COMMON_PLACEHOLDER_MARKERS = [
  "admintoken",
  "changeme",
  "default",
  "demoonly",
  "development",
  "example",
  "insecure",
  "notsecure",
  "password",
  "placeholder",
  "replace",
  "testtoken",
  "cafebabe",
  "deadbeef",
  "decafbad",
] as const;

const SIMPLE_SEQUENCE_ALPHABETS = [
  "0123456789",
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiopasdfghjklzxcvbnm",
] as const;

const MIN_DISTINCT_CHARACTERS = 8;
const SIMPLE_SEQUENCE_LENGTH = 8;

function isRepeatedPattern(value: string): boolean {
  for (let patternLength = 1; patternLength <= value.length / 2; patternLength += 1) {
    if (value.length % patternLength !== 0) {
      continue;
    }
    const pattern = value.slice(0, patternLength);
    if (pattern.repeat(value.length / patternLength) === value) {
      return true;
    }
  }
  return false;
}

function containsSimpleSequence(value: string): boolean {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SIMPLE_SEQUENCE_ALPHABETS.some((alphabet) => {
    const directions = [alphabet, [...alphabet].reverse().join("")];
    return directions.some((sequence) => {
      for (let offset = 0; offset <= sequence.length - SIMPLE_SEQUENCE_LENGTH; offset += 1) {
        if (compact.includes(sequence.slice(offset, offset + SIMPLE_SEQUENCE_LENGTH))) {
          return true;
        }
      }
      return false;
    });
  });
}

function compactAlphaNumeric(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function containsCommonPlaceholder(value: string, encoding: SecretEncoding): boolean {
  const candidates = [compactAlphaNumeric(value)];
  if (encoding === "hex") {
    candidates.push(compactAlphaNumeric(Buffer.from(value, "hex").toString("utf8")));
  }
  return COMMON_PLACEHOLDER_MARKERS.some((marker) => candidates.some((candidate) => candidate.includes(marker)));
}

function findGeneratedSecretRejection(value: string, encoding: SecretEncoding): GeneratedSecretRejection | undefined {
  if (containsCommonPlaceholder(value, encoding)) {
    return "common placeholder";
  }
  if (isRepeatedPattern(value.toLowerCase())) {
    return "repeated pattern";
  }
  if (new Set(value.toLowerCase()).size < MIN_DISTINCT_CHARACTERS) {
    return "low character variation";
  }
  if (containsSimpleSequence(value)) {
    return "simple sequence";
  }
  return undefined;
}

function assertGeneratedSecret(name: string, value: string, encoding: SecretEncoding): void {
  const rejection = findGeneratedSecretRejection(value, encoding);
  if (rejection !== undefined) {
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, `${name} must not use a ${rejection}`);
  }
}

function normalizedOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveEnvironment(env: Readonly<Record<string, string | undefined>>): RuntimeEnvironment {
  const configured = normalizedOptional(env.NODE_ENV) ?? "development";
  if (configured === "development" || configured === "staging" || configured === "production") {
    return configured;
  }
  throw new ConfigError(ConfigErrorCode.INVALID_VALUE, "Invalid NODE_ENV", configured);
}

function resolveHexSecret(
  name: HexSecretName,
  env: Readonly<Record<string, string | undefined>>,
  environment: RuntimeEnvironment,
): string {
  const configured = normalizedOptional(env[name]);
  if (configured === undefined) {
    if (environment === "development") {
      return DEVELOPMENT_HEX_DEFAULTS[name];
    }
    throw new ConfigError(ConfigErrorCode.SECRET_UNAVAILABLE, `${name} is required outside development`);
  }

  const normalized = configured.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, `${name} must be a 32-byte hexadecimal key`);
  }
  if (environment !== "development" && Object.values(DEVELOPMENT_HEX_DEFAULTS).includes(normalized)) {
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, `${name} must not use a development-only default`);
  }
  if (environment !== "development") {
    assertGeneratedSecret(name, normalized, "hex");
  }
  return normalized;
}

function resolveAdminToken(
  env: Readonly<Record<string, string | undefined>>,
  environment: RuntimeEnvironment,
): string {
  const canonical = normalizedOptional(env.ADMIN_API_TOKEN);
  const legacy = normalizedOptional(env.ADMIN_TOKEN);
  if (canonical !== undefined && legacy !== undefined && canonical !== legacy) {
    throw new ConfigError(
      ConfigErrorCode.INVALID_VALUE,
      "ADMIN_API_TOKEN and legacy ADMIN_TOKEN must match when both are configured",
    );
  }

  const token = canonical ?? legacy;
  if (token === undefined) {
    if (environment === "development") {
      return DEVELOPMENT_ONLY_SECURITY_DEFAULTS.adminToken;
    }
    throw new ConfigError(ConfigErrorCode.SECRET_UNAVAILABLE, "ADMIN_API_TOKEN is required outside development");
  }

  if (environment !== "development" && token === DEVELOPMENT_ONLY_SECURITY_DEFAULTS.adminToken) {
    throw new ConfigError(ConfigErrorCode.INVALID_VALUE, "ADMIN_API_TOKEN must not use a development-only default");
  }
  if (environment !== "development" && Buffer.byteLength(token, "utf8") < 32) {
    throw new ConfigError(
      ConfigErrorCode.INVALID_VALUE,
      "ADMIN_API_TOKEN must be at least 32 bytes",
    );
  }
  if (environment !== "development") {
    assertGeneratedSecret("ADMIN_API_TOKEN", token, "text");
  }
  return token;
}

function assertDistinctSecrets(
  secrets: RuntimeSecuritySecrets,
  secretUses: readonly RuntimeSecretUse[],
): void {
  const usesByBytes = new Map<string, RuntimeSecretUse>();
  for (const secretUse of secretUses) {
    const value = secrets[secretUse.configKey];
    const bytes = secretUse.configKey === "adminToken"
      ? Buffer.from(value, "utf8")
      : Buffer.from(value, "hex");
    const bytesKey = bytes.toString("hex");
    const existingUse = usesByBytes.get(bytesKey);
    if (existingUse !== undefined) {
      throw new ConfigError(
        ConfigErrorCode.INVALID_VALUE,
        `${existingUse.environmentName} (${existingUse.purpose}) and ${secretUse.environmentName} (${secretUse.purpose}) must use distinct secrets`,
      );
    }
    usesByBytes.set(bytesKey, secretUse);
  }
}

export function loadRuntimeSecuritySecrets(
  env: Readonly<Record<string, string | undefined>>,
  environment: RuntimeEnvironment,
): RuntimeSecuritySecrets {
  const secrets: RuntimeSecuritySecrets = {
    adminToken: resolveAdminToken(env, environment),
    csrfSigningKey: resolveHexSecret("CSRF_SIGNING_KEY", env, environment),
    ipHashKey: resolveHexSecret("IP_HASH_KEY", env, environment),
    mfaEncryptionKey: resolveHexSecret("MFA_ENCRYPTION_KEY", env, environment),
  };

  const secretUses = environment === "development" ? RUNTIME_SECRET_USES.slice(1) : RUNTIME_SECRET_USES;
  assertDistinctSecrets(secrets, secretUses);
  return secrets;
}

export function getCsrfSigningKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return resolveHexSecret("CSRF_SIGNING_KEY", env, resolveEnvironment(env));
}

export function getIpHashKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return resolveHexSecret("IP_HASH_KEY", env, resolveEnvironment(env));
}

export function getMfaEncryptionKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Buffer {
  return Buffer.from(resolveHexSecret("MFA_ENCRYPTION_KEY", env, resolveEnvironment(env)), "hex");
}
