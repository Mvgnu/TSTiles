import { ContractError, ContractErrorCode } from "../../contracts/types";
import { loadConfig } from "../../config/load-config";
import type { ArtifactVersion } from "../artifact/types";
import { getActiveArtifact, listArtifacts } from "../artifact/artifact.service";
import { createObjectStore } from "../storage/storage.service";
import { ArtifactError } from "../artifact/types";
import { StorageError, StorageErrorCode } from "../storage/types";
import { validateTileCoordinates as validateTileCoordinatesInternal } from "./pmtiles/coordinates";
import { resolveTileByteRange } from "./pmtiles/directory-resolver";
import { readTileRange } from "./pmtiles/range-reader";
import {
  ResolverError,
  ResolverErrorCode,
  type ResolveMetadataInput,
  type ResolveVectorTileInput,
  type ResolvedMetadata,
  type ResolvedTile,
  type TileCoordinates,
} from "./types";

function throwResolverError(code: ResolverErrorCode, details?: string): never {
  throw new ResolverError(code, details);
}

function resolveArtifactRecord(artifactId?: string): ArtifactVersion {
  const artifacts = listArtifacts();
  const normalizedArtifactId = artifactId?.trim();
  let targetId = normalizedArtifactId && normalizedArtifactId.length > 0
    ? normalizedArtifactId
    : undefined;
  if (targetId === undefined) {
    try {
      targetId = getActiveArtifact().versionId;
    } catch {
      throwResolverError(ResolverErrorCode.ARTIFACT_UNAVAILABLE);
    }
  }
  const artifact = artifacts.find((entry) => entry.id === targetId);
  if (!artifact) {
    throwResolverError(ResolverErrorCode.ARTIFACT_UNAVAILABLE);
  }
  return artifact;
}

function mapResolverFailure(error: unknown): never {
  if (error instanceof ResolverError) {
    throw error;
  }
  if (error instanceof ArtifactError) {
    throwResolverError(ResolverErrorCode.ARTIFACT_UNAVAILABLE);
  }
  if (error instanceof ContractError && error.code === ContractErrorCode.SCHEMA_INVALID) {
    throwResolverError(ResolverErrorCode.BAD_COORDINATES);
  }
  if (error instanceof StorageError) {
    if (error.code === StorageErrorCode.NOT_FOUND) {
      throwResolverError(ResolverErrorCode.TILE_NOT_FOUND);
    }
    if (error.code === StorageErrorCode.RANGE_INVALID) {
      throwResolverError(ResolverErrorCode.BAD_COORDINATES);
    }
    if (error.code === StorageErrorCode.PRECONDITION_FAILED) {
      throwResolverError(ResolverErrorCode.ARTIFACT_UNAVAILABLE);
    }
    if (error.code === StorageErrorCode.TIMEOUT) {
      throwResolverError(ResolverErrorCode.ORIGIN_READ_FAILED);
    }
  }
  throwResolverError(ResolverErrorCode.ORIGIN_READ_FAILED);
}

function toTileCoordinates(input: ResolveVectorTileInput): TileCoordinates {
  const coordinates: TileCoordinates = {
    z: input.z,
    x: input.x,
    y: input.y,
  };
  const validation = validateTileCoordinatesInternal(coordinates);
  if (validation) {
    if (validation.code !== ContractErrorCode.SCHEMA_INVALID) {
      throwResolverError(ResolverErrorCode.BAD_COORDINATES);
    }
    throw validation;
  }
  return coordinates;
}

export function validateTileCoordinates(value: unknown): ContractError | null {
  return validateTileCoordinatesInternal(value);
}

export async function resolveVectorTile(input: ResolveVectorTileInput): Promise<ResolvedTile> {
  try {
    const coordinates = toTileCoordinates(input);
    const artifact = resolveArtifactRecord(input.artifactId);
    const config = loadConfig();
    const store = createObjectStore(config);
    const tilePath = `/tiles/${coordinates.z}/${coordinates.x}/${coordinates.y}.mvt`;
    const metadata = await store.head(artifact.key);
    const range = resolveTileByteRange(tilePath, metadata.size, config.tileDeliveryPolicy.maxRangeBytes);
    const result = await readTileRange(store, artifact.key, range.start, range.end);
    return {
      artifactId: artifact.id,
      bytes: result.bytes,
      contentType: result.contentType,
      etagSeed: result.etag,
      byteLength: result.bytes.byteLength,
      key: `${artifact.key}:${tilePath}`,
      coordinates,
    };
  } catch (error: unknown) {
    mapResolverFailure(error);
  }
}

export function resolveMetadata(input: ResolveMetadataInput = {}): ResolvedMetadata {
  try {
    const artifact = resolveArtifactRecord(input.artifactId);
    const all = listArtifacts()
      .map((entry) => entry.id)
      .sort((left, right) => left.localeCompare(right));
    return {
      activeVersionId: artifact.id,
      artifact,
      availableVersions: all,
      etagSeed: artifact.checksum,
    };
  } catch (error: unknown) {
    mapResolverFailure(error);
  }
}
