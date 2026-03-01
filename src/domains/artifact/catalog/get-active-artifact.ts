import type { ActiveArtifactPointer } from "../types";
import { ArtifactError, ArtifactErrorCode } from "../types";

export function getActivePointer(active: ActiveArtifactPointer | null): ActiveArtifactPointer {
  if (!active) {
    throw new ArtifactError(ArtifactErrorCode.NOT_FOUND, "No active artifact pointer");
  }
  return active;
}
