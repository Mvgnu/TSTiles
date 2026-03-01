import type { ArtifactVersion } from "../types";

export function gcCatalog(
  catalog: Map<string, ArtifactVersion>,
  activeId: string | null,
  keepLatest = 20,
): string[] {
  const ordered = Array.from(catalog.values()).sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    return rightTime - leftTime;
  });
  const toDelete: string[] = [];
  for (let index = keepLatest; index < ordered.length; index++) {
    const candidate = ordered[index];
    if (candidate.id === activeId) {
      continue;
    }
    catalog.delete(candidate.id);
    toDelete.push(candidate.id);
  }
  return toDelete;
}
