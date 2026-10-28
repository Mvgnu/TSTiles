import { scryptSync, timingSafeEqual } from "node:crypto";
import {
  Algorithm,
  hashSync as argon2HashSync,
  parseOptions,
  verifySync as argon2VerifySync,
  Version,
} from "@node-rs/argon2";

const PASSWORD_HASH_POLICY = {
  algorithm: Algorithm.Argon2id,
  version: Version.V0x13,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

const LEGACY_SCRYPT_AS_ARGON2 = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9+/]{22}==)\$([A-Za-z0-9+/]{86}==)$/;

export interface PasswordVerification {
  readonly valid: boolean;
  readonly needsRehash: boolean;
}

/** Hashes a password as an interoperable Argon2id PHC string. */
export function hashPassword(password: string): string {
  return argon2HashSync(password, PASSWORD_HASH_POLICY);
}

/**
 * Verifies both standard Argon2id credentials and the one legacy format this
 * service previously produced. The legacy rows contain a scrypt digest falsely
 * labelled as Argon2id; callers must replace them after a successful check.
 */
export function verifyPasswordForMigration(password: string, encodedHash: string): PasswordVerification {
  const legacyMatch = LEGACY_SCRYPT_AS_ARGON2.exec(encodedHash);
  if (legacyMatch) {
    return verifyLegacyScryptPassword(password, legacyMatch[1], legacyMatch[2]);
  }

  try {
    const valid = argon2VerifySync(encodedHash, password);
    return {
      valid,
      needsRehash: valid && !matchesPasswordHashPolicy(encodedHash),
    };
  } catch {
    return { valid: false, needsRehash: false };
  }
}

/** Verifies a password without exposing migration details. */
export function verifyPassword(password: string, encodedHash: string): boolean {
  return verifyPasswordForMigration(password, encodedHash).valid;
}

/** True only for a standard, parseable Argon2id PHC string. */
export function isArgon2idHash(encodedHash: string): boolean {
  try {
    return parseOptions(encodedHash).algorithm === Algorithm.Argon2id
      && !LEGACY_SCRYPT_AS_ARGON2.test(encodedHash);
  } catch {
    return false;
  }
}

function matchesPasswordHashPolicy(encodedHash: string): boolean {
  const parsed = parseOptions(encodedHash);
  return parsed.algorithm === PASSWORD_HASH_POLICY.algorithm
    && parsed.version === PASSWORD_HASH_POLICY.version
    && parsed.memoryCost === PASSWORD_HASH_POLICY.memoryCost
    && parsed.timeCost === PASSWORD_HASH_POLICY.timeCost
    && parsed.parallelism === PASSWORD_HASH_POLICY.parallelism
    && parsed.outputLen === PASSWORD_HASH_POLICY.outputLen
    && parsed.saltLen >= 16;
}

function verifyLegacyScryptPassword(
  password: string,
  salt: string,
  digest: string,
): PasswordVerification {
  try {
    const storedDigest = Buffer.from(digest, "base64");
    const candidateDigest = scryptSync(password, salt, storedDigest.length, {
      N: 16_384,
      r: 8,
      p: 1,
    });
    const valid = timingSafeEqual(storedDigest, candidateDigest);
    return { valid, needsRehash: valid };
  } catch {
    return { valid: false, needsRehash: false };
  }
}
