import type { ObjectMetadata } from "../storage/types";
import { type ArtifactEvent, type IngestEvent } from "../../contracts/types";

export const enum ArtifactErrorCode {
  NOT_FOUND = "ARTIFACT_NOT_FOUND",
  NOT_VALIDATED = "ARTIFACT_NOT_VALIDATED",
  PROMOTION_CONFLICT = "ARTIFACT_PROMOTION_CONFLICT",
  ROLLBACK_UNAVAILABLE = "ARTIFACT_ROLLBACK_UNAVAILABLE",
}

export class ArtifactError extends Error {
  public readonly code: ArtifactErrorCode;
  public readonly details: string;

  public constructor(code: ArtifactErrorCode, details: string) {
    super(details);
    this.code = code;
    this.details = details;
    this.name = "ArtifactError";
  }
}

export interface ArtifactVersion {
  readonly id: string;
  readonly key: string;
  readonly checksum: string;
  readonly byteSize: number;
  readonly createdAt: string;
  readonly validated: boolean;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ActiveArtifactPointer {
  readonly versionId: string;
  readonly activeSince: string;
}

export interface ArtifactValidationSummary {
  readonly isValid: boolean;
  readonly reason?: string;
}

export interface ArtifactCatalogRecord {
  readonly version: ArtifactVersion;
  readonly metadata?: ObjectMetadata;
}

export interface ArtifactEventEnvelope {
  readonly event: ArtifactEvent;
  readonly artifact: ArtifactVersion;
}

export interface IngestedArtifactEventEnvelope {
  readonly event: IngestEvent;
  readonly artifactId: string;
}
