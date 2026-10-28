import { IngestError, IngestErrorCode } from "../types";
import { createHash } from "node:crypto";

const toHex = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

export function verifyChecksum(data: Uint8Array, expected?: string): { checksum: string; valid: boolean } {
  const checksum = toHex(data);
  const normalizedExpected = expected?.trim().toLowerCase();
  if (!normalizedExpected) {
    return { checksum, valid: true };
  }
  if (checksum !== normalizedExpected) {
    throw new IngestError(IngestErrorCode.CHECKSUM_FAILED, "checksum mismatch");
  }
  return { checksum, valid: true };
}
