import { IngestError, IngestErrorCode } from "../types";

export interface PMTilesArtifact {
  readonly key: string;
  readonly bytes: Uint8Array;
}

export async function convertToPmTiles(snapshotId: string, source: Uint8Array): Promise<PMTilesArtifact> {
  if (source.byteLength <= 0) {
    throw new IngestError(IngestErrorCode.CONVERSION_FAILED, "empty source input");
  }
  const key = `artifacts/${snapshotId}/tiles.pmtiles`;
  return {
    key,
    bytes: source,
  };
}
