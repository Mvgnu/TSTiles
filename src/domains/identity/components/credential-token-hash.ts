import { createHash, randomBytes } from "node:crypto";

/**
 * Mints a 32-byte cryptographic random, base64url-encoded token.
 */
export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Computes the SHA-256 hash of a plaintext token for secure rest persistence.
 */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
