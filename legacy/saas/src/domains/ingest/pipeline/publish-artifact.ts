import { createObjectStore } from "../../storage/storage.service";
import { loadConfig } from "../../../config/load-config";
import type { PMTilesArtifact } from "./convert-to-pmtiles";

export async function publishArtifact(
  artifact: PMTilesArtifact,
): Promise<{ key: string; etag: string; size: number }> {
  const config = loadConfig();
  const store = createObjectStore(config);
  const metadata = await store.putObject(artifact.key, artifact.bytes, "application/vnd.microsoft.portable");
  return {
    key: metadata.key,
    etag: metadata.etag,
    size: metadata.size,
  };
} 
