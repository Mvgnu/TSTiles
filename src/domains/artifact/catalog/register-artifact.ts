import type { ArtifactVersion } from "../types";
import { ArtifactError, ArtifactErrorCode } from "../types";

function cloneMetadata(metadata: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> | undefined {
  if (!metadata) {
    return undefined;
  }
  return { ...metadata };
}

function canonicalMetadataValue(metadata: Readonly<Record<string, string>> | undefined): string {
  if (!metadata) {
    return "";
  }
  const entries = Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right));
  return entries.map(([key, value]) => `${key}=${value}`).join("&");
}

export function registerArtifactVersion(catalog: Map<string, ArtifactVersion>, version: ArtifactVersion): ArtifactVersion {
  const normalizedId = version.id.trim();
  if (!normalizedId) {
    throw new ArtifactError(ArtifactErrorCode.NOT_VALIDATED, "Version id is required");
  }
  const existing = catalog.get(normalizedId);
  if (existing) {
    const existingMetadata = canonicalMetadataValue(existing.metadata);
    const incomingMetadata = canonicalMetadataValue(version.metadata);
    const sameVersion = existing.key === version.key
      && existing.checksum === version.checksum
      && existing.byteSize === version.byteSize
      && existing.validated === version.validated
      && existingMetadata === incomingMetadata;
    if (!sameVersion) {
      throw new ArtifactError(ArtifactErrorCode.PROMOTION_CONFLICT, "Artifact version already exists with different metadata");
    }
    return existing;
  }
  const normalizedVersion: ArtifactVersion = {
    ...version,
    id: normalizedId,
    metadata: cloneMetadata(version.metadata),
  };
  catalog.set(normalizedId, normalizedVersion);
  return normalizedVersion;
}
