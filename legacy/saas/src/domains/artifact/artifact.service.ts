import { prisma } from "../../config/db";
import {
  ArtifactError,
  ArtifactErrorCode,
  type ActiveArtifactPointer,
  type ArtifactVersion,
} from "./types";
import { validateVersion } from "./catalog/validate-artifact";

const ARTIFACT_DATASET_ID = "default";
const MAX_ROLLBACK_HISTORY = 128;

interface PersistedArtifactRow {
  readonly id: string;
  readonly storageKey: string;
  readonly checksum: string;
  readonly sizeBytes: bigint;
  readonly createdAt: string;
  readonly validated: boolean;
  readonly metadata: string;
}

function bigIntToSafeNumber(value: bigint): number {
  // Tile artifacts top out well below MAX_SAFE_INTEGER (~9 PB), so a clean
  // narrowing here is safe; we still clamp to the safe ceiling defensively.
  const ceiling = BigInt(Number.MAX_SAFE_INTEGER);
  const clamped = value > ceiling ? ceiling : value;
  return Number(clamped);
}

function decodeMetadata(serialized: string): Readonly<Record<string, string>> | undefined {
  if (!serialized) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return undefined;
  }
}

function encodeMetadata(metadata: Readonly<Record<string, string>> | undefined): string {
  if (!metadata) {
    return "";
  }
  const entries = Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return "";
  }
  const ordered: Record<string, string> = {};
  for (const [key, value] of entries) {
    ordered[key] = value;
  }
  return JSON.stringify(ordered);
}

function rowToVersion(row: PersistedArtifactRow): ArtifactVersion {
  const metadata = decodeMetadata(row.metadata);
  return {
    id: row.id,
    key: row.storageKey,
    checksum: row.checksum,
    byteSize: bigIntToSafeNumber(row.sizeBytes),
    createdAt: row.createdAt,
    validated: row.validated,
    metadata: metadata ? { ...metadata } : undefined,
  };
}

function clonePointer(pointer: ActiveArtifactPointer): ActiveArtifactPointer {
  return {
    versionId: pointer.versionId,
    activeSince: pointer.activeSince,
  };
}

function isPathLikeVersionId(value: string): boolean {
  return (
    value === "."
    || value.includes("/")
    || value.includes("\\")
    || value.includes("..")
  );
}

export async function registerArtifact(version: ArtifactVersion): Promise<void> {
  const validation = validateVersion(version);
  if (!validation.isValid) {
    throw new ArtifactError(ArtifactErrorCode.NOT_VALIDATED, validation.reason ?? "Invalid artifact");
  }
  const normalizedId = version.id.trim();
  const incomingMetadata = encodeMetadata(version.metadata);
  const existing = await prisma.artifactVersion.findUnique({ where: { id: normalizedId } });
  if (existing) {
    const sameVersion = existing.storageKey === version.key
      && existing.checksum === version.checksum
      && bigIntToSafeNumber(existing.sizeBytes) === version.byteSize
      && existing.validated === version.validated
      && existing.metadata === incomingMetadata;
    if (!sameVersion) {
      throw new ArtifactError(
        ArtifactErrorCode.PROMOTION_CONFLICT,
        "Artifact version already exists with different metadata",
      );
    }
    return;
  }
  await prisma.artifactVersion.create({
    data: {
      id: normalizedId,
      datasetId: ARTIFACT_DATASET_ID,
      storageKey: version.key,
      sizeBytes: BigInt(version.byteSize),
      format: "pmtiles",
      validatedAt: version.validated ? version.createdAt : null,
      createdAt: version.createdAt,
      checksum: version.checksum,
      validated: version.validated,
      metadata: incomingMetadata,
    },
  });
}

export async function getActiveArtifact(): Promise<ActiveArtifactPointer> {
  const active = await prisma.activeArtifact.findUnique({ where: { datasetId: ARTIFACT_DATASET_ID } });
  if (!active || active.versionId.length === 0) {
    throw new ArtifactError(ArtifactErrorCode.NOT_FOUND, "No active artifact pointer");
  }
  return clonePointer({
    versionId: active.versionId,
    activeSince: active.activeSince,
  });
}

export async function promoteArtifact(versionId: string): Promise<ActiveArtifactPointer> {
  if (typeof versionId !== "string") {
    throw new ArtifactError(ArtifactErrorCode.NOT_FOUND, "Artifact not found");
  }
  const normalizedVersionId = versionId.trim();
  if (normalizedVersionId.length === 0 || isPathLikeVersionId(normalizedVersionId)) {
    throw new ArtifactError(ArtifactErrorCode.NOT_FOUND, "Artifact not found");
  }

  return await prisma.$transaction(async (tx) => {
    const version = await tx.artifactVersion.findUnique({ where: { id: normalizedVersionId } });
    if (!version) {
      throw new ArtifactError(ArtifactErrorCode.NOT_FOUND, "Artifact not found");
    }
    if (!version.validated) {
      throw new ArtifactError(ArtifactErrorCode.NOT_VALIDATED, "Artifact not validated");
    }
    const current = await tx.activeArtifact.findUnique({ where: { datasetId: ARTIFACT_DATASET_ID } });
    if (current && current.versionId === normalizedVersionId) {
      throw new ArtifactError(ArtifactErrorCode.PROMOTION_CONFLICT, "Artifact already active");
    }
    if (current && current.versionId.length > 0) {
      await tx.artifactPromotionHistory.create({
        data: {
          datasetId: ARTIFACT_DATASET_ID,
          versionId: current.versionId,
          activeSince: current.activeSince,
          recordedAt: new Date().toISOString(),
        },
      });
      const overflow = await tx.artifactPromotionHistory.findMany({
        where: { datasetId: ARTIFACT_DATASET_ID },
        orderBy: { id: "asc" },
      });
      if (overflow.length > MAX_ROLLBACK_HISTORY) {
        const surplus = overflow.slice(0, overflow.length - MAX_ROLLBACK_HISTORY);
        await tx.artifactPromotionHistory.deleteMany({
          where: { id: { in: surplus.map((entry) => entry.id) } },
        });
      }
    }
    const activeSince = new Date().toISOString();
    await tx.activeArtifact.upsert({
      where: { datasetId: ARTIFACT_DATASET_ID },
      update: { versionId: normalizedVersionId, activeSince },
      create: { datasetId: ARTIFACT_DATASET_ID, versionId: normalizedVersionId, activeSince },
    });
    return clonePointer({ versionId: normalizedVersionId, activeSince });
  });
}

export async function rollbackArtifact(): Promise<ActiveArtifactPointer> {
  return await prisma.$transaction(async (tx) => {
    const previous = await tx.artifactPromotionHistory.findFirst({
      where: { datasetId: ARTIFACT_DATASET_ID },
      orderBy: { id: "desc" },
    });
    if (!previous) {
      throw new ArtifactError(ArtifactErrorCode.ROLLBACK_UNAVAILABLE, "No prior artifact in history");
    }
    await tx.artifactPromotionHistory.delete({ where: { id: previous.id } });
    const activeSince = new Date().toISOString();
    await tx.activeArtifact.upsert({
      where: { datasetId: ARTIFACT_DATASET_ID },
      update: { versionId: previous.versionId, activeSince },
      create: { datasetId: ARTIFACT_DATASET_ID, versionId: previous.versionId, activeSince },
    });
    return clonePointer({ versionId: previous.versionId, activeSince });
  });
}

export async function listArtifacts(): Promise<ArtifactVersion[]> {
  const rows = await prisma.artifactVersion.findMany({
    where: { datasetId: ARTIFACT_DATASET_ID },
  });
  return rows
    .map((row) => rowToVersion(row))
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt);
      const rightTime = Date.parse(right.createdAt);
      return rightTime - leftTime;
    });
}

export async function garbageCollectArtifacts(keepLatest = 20): Promise<string[]> {
  const protectedVersionIds = new Set<string>();
  const active = await prisma.activeArtifact.findUnique({ where: { datasetId: ARTIFACT_DATASET_ID } });
  if (active && active.versionId.length > 0) {
    protectedVersionIds.add(active.versionId);
  }
  const history = await prisma.artifactPromotionHistory.findMany({
    where: { datasetId: ARTIFACT_DATASET_ID },
  });
  for (const entry of history) {
    protectedVersionIds.add(entry.versionId);
  }
  const ordered = await prisma.artifactVersion.findMany({
    where: { datasetId: ARTIFACT_DATASET_ID },
  });
  const sorted = ordered.slice().sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    return rightTime - leftTime;
  });
  const toDelete: string[] = [];
  for (let index = keepLatest; index < sorted.length; index += 1) {
    const candidate = sorted[index];
    if (protectedVersionIds.has(candidate.id)) {
      continue;
    }
    toDelete.push(candidate.id);
  }
  if (toDelete.length > 0) {
    await prisma.artifactVersion.deleteMany({ where: { id: { in: toDelete } } });
  }
  return toDelete;
}
