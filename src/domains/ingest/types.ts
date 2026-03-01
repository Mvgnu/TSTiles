import type { TileCoordinates } from "../../contracts/types";

export const enum IngestErrorCode {
  SOURCE_UNAVAILABLE = "INGEST_SOURCE_UNAVAILABLE",
  CHECKSUM_FAILED = "INGEST_CHECKSUM_FAILED",
  CONVERSION_FAILED = "INGEST_CONVERSION_FAILED",
  PUBLISH_FAILED = "INGEST_PUBLISH_FAILED",
}

export class IngestError extends Error {
  public readonly code: IngestErrorCode;
  public readonly details: string;

  public constructor(code: IngestErrorCode, details: string) {
    super(details);
    this.code = code;
    this.details = details;
    this.name = "IngestError";
  }
}

export interface PlanetSnapshot {
  readonly snapshotId: string;
  readonly sourceUrl: string;
  readonly expectedChecksum?: string;
}

export interface IngestRunReport {
  readonly snapshotId: string;
  readonly artifactId: string;
  readonly artifactKey: string;
  readonly checksum: string;
  readonly byteSize: number;
  readonly validated: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly validationSummary: string;
  readonly region?: TileCoordinates;
}
