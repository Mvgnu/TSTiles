export function buildTileCacheKey(artifactVersion: string, tilePath: string): string {
  const normalized = tilePath.toLowerCase().replace(/\/+/g, "/");
  return `${artifactVersion}:${normalized}`;
}
