import type { ArtifactVersion } from "../types";

export function listArtifactVersions(catalog: Map<string, ArtifactVersion>): ArtifactVersion[] {
  return Array.from(catalog.values()).sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    return rightTime - leftTime;
  });
}
