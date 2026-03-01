import type { ArtifactVersion } from "../artifact/types";
import type { ContractError } from "../../contracts/types";

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
