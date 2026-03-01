import type { ActiveArtifactPointer } from "../types";
import { ArtifactError, ArtifactErrorCode } from "../types";

export function rollback(history: ActiveArtifactPointer[], activeRef: { value: ActiveArtifactPointer | null }): ActiveArtifactPointer {
  const previous = history.pop() ?? null;
  if (!previous) {
    throw new ArtifactError(ArtifactErrorCode.ROLLBACK_UNAVAILABLE, "No prior artifact in history");
  }
  activeRef.value = previous;
  return previous;
}
