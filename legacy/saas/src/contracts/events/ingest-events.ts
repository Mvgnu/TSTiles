import { CONTRACT_SCHEMA_VERSION } from "../types";
import { ContractError, ContractErrorCode, type IngestEvent } from "../types";

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new ContractError(ContractErrorCode.SCHEMA_INVALID, `${field} is required`);
  }
}

function normalizeRequired(value: string, field: string): string {
  assertNonEmpty(value, field);
  return value.trim();
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ContractError(ContractErrorCode.SCHEMA_INVALID, `${field} must be a non-negative integer`);
  }
}

export function createIngestCompletedEvent(input: {
  snapshotId: string;
  artifactVersion: string;
  artifactKey: string;
  checksum: string;
  byteSize: number;
  validated: boolean;
}): IngestEvent {
  const snapshotId = normalizeRequired(input.snapshotId, "snapshotId");
  const artifactVersion = normalizeRequired(input.artifactVersion, "artifactVersion");
  const artifactKey = normalizeRequired(input.artifactKey, "artifactKey");
  const checksum = normalizeRequired(input.checksum, "checksum");
  assertNonNegativeInteger(input.byteSize, "byteSize");
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    eventType: "ingest.completed",
    snapshotId,
    artifactVersion,
    artifactKey,
    checksum,
    byteSize: input.byteSize,
    validated: input.validated,
    timestamp: new Date().toISOString(),
  };
}
