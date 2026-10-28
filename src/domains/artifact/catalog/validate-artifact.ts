import type { ArtifactVersion, ArtifactValidationSummary } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateVersion(version: ArtifactVersion): ArtifactValidationSummary {
  if (!isRecord(version)) {
    return { isValid: false, reason: "artifact version is required" };
  }
  if (typeof version.id !== "string" || version.id.trim().length === 0) {
    return { isValid: false, reason: "id is required" };
  }
  if (version.id.trim() === "." || version.id.includes("/") || version.id.includes("\\") || version.id.includes("..")) {
    return { isValid: false, reason: "id must not contain path separators or traversal markers" };
  }
  if (typeof version.byteSize !== "number") {
    return { isValid: false, reason: "byte size must be a positive integer" };
  }
  if (!Number.isFinite(version.byteSize) || !Number.isInteger(version.byteSize) || version.byteSize <= 0) {
    return { isValid: false, reason: "byte size must be a positive integer" };
  }
  if (typeof version.key !== "string" || version.key.trim().length === 0) {
    return { isValid: false, reason: "key is required" };
  }
  if (typeof version.checksum !== "string" || version.checksum.trim().length === 0) {
    return { isValid: false, reason: "checksum is required" };
  }
  if (typeof version.createdAt !== "string") {
    return { isValid: false, reason: "createdAt must be a valid ISO timestamp" };
  }
  if (Number.isNaN(Date.parse(version.createdAt))) {
    return { isValid: false, reason: "createdAt must be a valid ISO timestamp" };
  }
  if (typeof version.validated !== "boolean") {
    return { isValid: false, reason: "validated must be boolean" };
  }
  return { isValid: true };
}
