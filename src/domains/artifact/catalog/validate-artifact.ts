import type { ArtifactVersion, ArtifactValidationSummary } from "../types";

export function validateVersion(version: ArtifactVersion): ArtifactValidationSummary {
  if (version.id.trim().length === 0) {
    return { isValid: false, reason: "id is required" };
  }
  if (version.byteSize <= 0) {
    return { isValid: false, reason: "byte size must be positive" };
  }
  if (version.key.trim().length === 0) {
    return { isValid: false, reason: "key is required" };
  }
  if (!version.checksum || version.checksum.trim().length === 0) {
    return { isValid: false, reason: "checksum is required" };
  }
  if (Number.isNaN(Date.parse(version.createdAt))) {
    return { isValid: false, reason: "createdAt must be a valid ISO timestamp" };
  }
  return { isValid: true };
}
