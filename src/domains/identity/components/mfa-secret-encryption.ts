import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getMfaEncryptionKey } from "../../../config/security-secrets";

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function decodeHexPart(value: string, expectedBytes?: number): Buffer {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error("Invalid encrypted MFA secret format");
  }
  const bytes = Buffer.from(value, "hex");
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) {
    throw new Error("Invalid encrypted MFA secret format");
  }
  return bytes;
}

export function encryptMfaSecret(secret: string): string {
  if (secret.length === 0) {
    throw new Error("MFA secret must be non-empty");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getMfaEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decryptMfaSecret(value: string): string {
  const parts = value.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted MFA secret format");
  }
  const [ivHex, encryptedHex, authTagHex] = parts;
  const iv = decodeHexPart(ivHex, IV_BYTES);
  const encrypted = decodeHexPart(encryptedHex);
  const authTag = decodeHexPart(authTagHex, AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", getMfaEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
