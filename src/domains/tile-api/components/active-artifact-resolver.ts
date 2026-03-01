import { getActiveArtifact, listArtifacts } from "../../artifact/artifact.service";
import { ArtifactError, ArtifactErrorCode } from "../../artifact/types";

export interface ResolvedActiveArtifact {
  readonly versionId: string;
  readonly key: string;
}

export function resolveActiveArtifact(): ResolvedActiveArtifact {
  const active = getActiveArtifact();
  const artifact = listArtifacts().find((item) => item.id === active.versionId);
  if (!artifact) {
    throw new ArtifactError(ArtifactErrorCode.NOT_FOUND, "No artifact record for active pointer");
  }
  return {
    versionId: active.versionId,
    key: artifact.key,
  };
}
