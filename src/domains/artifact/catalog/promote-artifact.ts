import type { ActiveArtifactPointer, ArtifactVersion } from "../types";
import { ArtifactError, ArtifactErrorCode } from "../types";

export function promote(
  request: { versionId: string },
  catalog: Map<string, ArtifactVersion>,
  activeRef: { value: ActiveArtifactPointer | null },
  history: ActiveArtifactPointer[],
): ActiveArtifactPointer {
  const normalizedVersionId = request.versionId.trim();
  if (normalizedVersionId.length === 0) {
    throw new ArtifactError(ArtifactErrorCode.NOT_FOUND, "Artifact not found");
  }
  const version = catalog.get(normalizedVersionId);
  if (!version) {
    throw new ArtifactError(ArtifactErrorCode.NOT_FOUND, "Artifact not found");
  }
  if (!version.validated) {
    throw new ArtifactError(ArtifactErrorCode.NOT_VALIDATED, "Artifact not validated");
  }
  if (activeRef.value?.versionId === normalizedVersionId) {
    throw new ArtifactError(ArtifactErrorCode.PROMOTION_CONFLICT, "Artifact already active");
  }
  if (activeRef.value) {
    history.push(activeRef.value);
  }
  const pointer: ActiveArtifactPointer = {
    versionId: normalizedVersionId,
    activeSince: new Date().toISOString(),
  };
  activeRef.value = pointer;
  return pointer;
}
