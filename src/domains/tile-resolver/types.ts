import type { ArtifactVersion } from "../artifact/types";
import type { ContractError } from "../../contracts/types";

export const enum ResolverErrorCode {
  BAD_COORDINATES = "RESOLVER_BAD_COORDINATES",
  TILE_NOT_FOUND = "RESOLVER_TILE_NOT_FOUND",
  ARTIFACT_UNAVAILABLE = "RESOLVER_ARTIFACT_UNAVAILABLE",
  ORIGIN_READ_FAILED = "RESOLVER_ORIGIN_READ_FAILED",
}

export class ResolverError extends Error {
  public readonly code: ResolverErrorCode;
  public readonly details?: string;

  public constructor(code: ResolverErrorCode, details?: string) {
    super(details ? `${code}:${details}` : code);
    this.code = code;
    this.details = details;
    this.name = "ResolverError";
  }
}

export type TileCoordinates = {
  readonly z: number;
  readonly x: number;
  readonly y: number;
};

export interface ResolveVectorTileInput {
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly artifactId?: string;
}

export interface ResolveMetadataInput {
  readonly artifactId?: string;
}

export interface ResolvedTile {
  readonly artifactId: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly etagSeed: string;
  readonly byteLength: number;
  readonly key: string;
  readonly coordinates: TileCoordinates;
}

export interface ResolvedMetadata {
  readonly activeVersionId: string;
  readonly artifact: ArtifactVersion;
  readonly availableVersions: ReadonlyArray<string>;
  readonly etagSeed: string;
}

export type ValidateTileCoordinates = (value: unknown) => ContractError | null;

export interface ResolvedArtifactsInfo {
  readonly activeVersionId: string;
  readonly artifact: ArtifactVersion;
  readonly availableVersions: ReadonlyArray<string>;
}
