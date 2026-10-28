import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getCsrfSigningKey } from "./secrets";

export function generateCsrfSid(): string {
  return randomBytes(16).toString("hex");
}

export function generateCsrfToken(sid: string): string {
  const secret = getCsrfSigningKey();
  return createHmac("sha256", secret).update(sid).digest("hex");
}

export function verifyCsrfToken(
  token: string | undefined,
  sid: string | undefined,
): boolean {
  if (!token || !sid) {
    return false;
  }
  const expectedToken = generateCsrfToken(sid);
  const expected = Buffer.from(expectedToken, "hex");
  const candidate = Buffer.from(token, "hex");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}
