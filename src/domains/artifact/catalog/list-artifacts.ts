import type { ArtifactVersion } from "../types";

function cloneMetadata(metadata: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> | undefined {
  if (!metadata) {
    return undefined;
  }
  return { ...metadata };
}

export function listArtifactVersions(catalog: Map<string, ArtifactVersion>): ArtifactVersion[] {
  return Array.from(catalog.values()).sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    return rightTime - leftTime;
  }).map((entry) => ({
    ...entry,
    metadata: cloneMetadata(entry.metadata),
  }));
}
