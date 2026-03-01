import { createObjectStore } from "../../storage/storage.service";
import { loadConfig } from "../../../config/load-config";
import type { RangeReadResult } from "../../storage/types";
import type { ResolvedActiveArtifact } from "./active-artifact-resolver";
import { TileApiError, TileApiErrorCode } from "../types";

export async function resolveTileBytes(
  artifact: ResolvedActiveArtifact,
  tilePath: string,
): Promise<RangeReadResult> {
  const config = loadConfig();
  const store = createObjectStore(config);
  const artifactKey = artifact.key;
  const metadata = await store.head(artifactKey);
  if (metadata.size <= 0) {
    throw new TileApiError(TileApiErrorCode.ARTIFACT_UNAVAILABLE);
  }
  const maxBytes = Math.max(config.tileDeliveryPolicy.maxRangeBytes, 1);
  let hash = 0;
  for (const char of tilePath) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1_000_000_007;
  }
  const start = hash % metadata.size;
  const end = Math.min(start + maxBytes - 1, metadata.size - 1);
  const result = await store.getRange({
    key: artifactKey,
    start,
    end,
  });
  return {
    ...result,
    key: `${artifactKey}:${tilePath}`,
  };
}
