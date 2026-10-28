import { ContractError, ContractErrorCode } from "../../contracts/types";
import { loadConfig } from "../../config/load-config";
import type { ArtifactVersion } from "../artifact/types";
import { getActiveArtifact, listArtifacts } from "../artifact/artifact.service";
import { createObjectStore } from "../storage/storage.service";
import { ArtifactError } from "../artifact/types";
import { StorageError, StorageErrorCode } from "../storage/types";
import { validateTileCoordinates as validateTileCoordinatesInternal } from "./pmtiles/coordinates";
import { resolveArchiveProfile as resolveArchiveProfileFromSource, resolveArchiveTile } from "./pmtiles/archive-source";
import {
  type ResolvedArchiveProfile,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeArtifactId(value: unknown): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throwResolverError(ResolverErrorCode.ARTIFACT_UNAVAILABLE);
  }
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }
  if (normalized === "." || normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    throwResolverError(ResolverErrorCode.ARTIFACT_UNAVAILABLE);
  }
  return normalized;
}

async function resolveArtifactRecord(artifactId?: string): Promise<ArtifactVersion> {
  const artifacts = await listArtifacts();
  let targetId = normalizeArtifactId(artifactId);
  if (targetId === undefined) {
    try {
      targetId = (await getActiveArtifact()).versionId;
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

async function resolveActiveVersionId(fallbackArtifactId: string): Promise<string> {
  try {
    return (await getActiveArtifact()).versionId;
  } catch {
    return fallbackArtifactId;
  }
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

function toTileCoordinates(input: unknown): TileCoordinates {
  if (!isRecord(input)) {
    throwResolverError(ResolverErrorCode.BAD_COORDINATES);
  }
  const coordinates: TileCoordinates = {
    z: input.z as number,
    x: input.x as number,
    y: input.y as number,
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
    const artifact = await resolveArtifactRecord(isRecord(input) ? input.artifactId as string | undefined : undefined);
    const config = loadConfig();
    const store = createObjectStore(config);
    const tilePath = `/tiles/${coordinates.z}/${coordinates.x}/${coordinates.y}.mvt`;
    const result = await resolveArchiveTile(store, artifact, coordinates.z, coordinates.x, coordinates.y);
    return {
      artifactId: artifact.id,
      bytes: result.bytes,
      contentType: result.contentType,
      etagSeed: result.etagSeed,
      byteLength: result.bytes.byteLength,
      key: `${artifact.key}:${tilePath}`,
      coordinates,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "PMTILES_TILE_NOT_FOUND") {
      throwResolverError(ResolverErrorCode.TILE_NOT_FOUND);
    }
    mapResolverFailure(error);
  }
}

export async function resolveMetadata(input: ResolveMetadataInput = {}): Promise<ResolvedMetadata> {
  try {
    const artifact = await resolveArtifactRecord(isRecord(input) ? input.artifactId as string | undefined : undefined);
    const all = (await listArtifacts())
      .map((entry) => entry.id)
      .sort((left, right) => left.localeCompare(right));
    return {
      activeVersionId: await resolveActiveVersionId(artifact.id),
      artifact,
      availableVersions: all,
      etagSeed: artifact.checksum,
    };
  } catch (error: unknown) {
    mapResolverFailure(error);
  }
}

export async function resolveArchiveProfile(input: ResolveMetadataInput = {}): Promise<ResolvedArchiveProfile> {
  try {
    const artifact = await resolveArtifactRecord(isRecord(input) ? input.artifactId as string | undefined : undefined);
    const config = loadConfig();
    const store = createObjectStore(config);
    return await resolveArchiveProfileFromSource(store, artifact);
  } catch (error: unknown) {
    mapResolverFailure(error);
  }
}
