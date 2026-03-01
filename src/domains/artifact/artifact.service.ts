import { ArtifactError, ArtifactErrorCode, type ActiveArtifactPointer, type ArtifactVersion } from "./types";
import { registerArtifactVersion } from "./catalog/register-artifact";
import { getActivePointer } from "./catalog/get-active-artifact";
import { promote } from "./catalog/promote-artifact";
import { rollback } from "./catalog/rollback-artifact";
import { listArtifactVersions } from "./catalog/list-artifacts";
import { validateVersion } from "./catalog/validate-artifact";
import { gcCatalog } from "./catalog/garbage-collect";

const catalog = new Map<string, ArtifactVersion>();
const activeRef: { value: ActiveArtifactPointer | null } = { value: null };
const activeHistory: ActiveArtifactPointer[] = [];

function cloneActivePointer(pointer: ActiveArtifactPointer): ActiveArtifactPointer {
  return {
    versionId: pointer.versionId,
    activeSince: pointer.activeSince,
  };
}

export function registerArtifact(version: ArtifactVersion): void {
  const validation = validateVersion(version);
  if (!validation.isValid) {
    throw new ArtifactError(ArtifactErrorCode.NOT_VALIDATED, validation.reason ?? "Invalid artifact");
  }
  registerArtifactVersion(catalog, version);
}

export function getActiveArtifact(): ActiveArtifactPointer {
  return cloneActivePointer(getActivePointer(activeRef.value));
}

export function promoteArtifact(versionId: string): ActiveArtifactPointer {
  return cloneActivePointer(promote({ versionId }, catalog, activeRef, activeHistory));
}

export function rollbackArtifact(): ActiveArtifactPointer {
  return cloneActivePointer(rollback(activeHistory, activeRef));
}

export function listArtifacts(): ArtifactVersion[] {
  return listArtifactVersions(catalog);
}

export function garbageCollectArtifacts(): string[] {
  const active = activeRef.value?.versionId ?? null;
  return gcCatalog(catalog, active);
}
