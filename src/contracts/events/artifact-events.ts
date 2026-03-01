import { CONTRACT_SCHEMA_VERSION } from "../types";
import { ContractError, ContractErrorCode, type ArtifactEvent } from "../types";

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ContractError(ContractErrorCode.SCHEMA_INVALID, `${field} is required`);
  }
}

function normalizeRequired(value: string, field: string): string {
  assertNonEmpty(value, field);
  return value.trim();
}

function normalizeOptional(value: string | null | undefined, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return normalizeRequired(value, field);
}

export function createArtifactRegisteredEvent(input: {
  versionId: string;
  key: string;
}): ArtifactEvent {
  const versionId = normalizeRequired(input.versionId, "versionId");
  const key = normalizeRequired(input.key, "key");
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    eventType: "artifact.registered",
    versionId,
    key,
    timestamp: new Date().toISOString(),
  };
}

export function createArtifactPromotedEvent(input: {
  versionId: string;
  key: string;
  activeVersionId?: string | null;
  actor?: string;
}): ArtifactEvent {
  const versionId = normalizeRequired(input.versionId, "versionId");
  const key = normalizeRequired(input.key, "key");
  const activeVersionId = normalizeOptional(input.activeVersionId, "activeVersionId");
  const actor = normalizeOptional(input.actor, "actor");
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    eventType: "artifact.promoted",
    versionId,
    key,
    activeVersionId: activeVersionId ?? null,
    actor,
    timestamp: new Date().toISOString(),
  };
}

export function createArtifactRollbackEvent(input: {
  versionId: string;
  key: string;
  activeVersionId?: string | null;
  actor?: string;
}): ArtifactEvent {
  const versionId = normalizeRequired(input.versionId, "versionId");
  const key = normalizeRequired(input.key, "key");
  const activeVersionId = normalizeOptional(input.activeVersionId, "activeVersionId");
  const actor = normalizeOptional(input.actor, "actor");
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    eventType: "artifact.rolled_back",
    versionId,
    key,
    activeVersionId: activeVersionId ?? null,
    actor,
    timestamp: new Date().toISOString(),
  };
}
