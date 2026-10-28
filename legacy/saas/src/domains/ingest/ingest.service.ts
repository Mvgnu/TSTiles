import { loadConfig } from "../../config/load-config";
import { prisma } from "../../config/db";
import type { IngestRunReport, PlanetSnapshot } from "./types";
import { IngestError, IngestErrorCode } from "./types";
import { fetchPlanet } from "./pipeline/fetch-planet";
import { verifyChecksum } from "./pipeline/verify-checksum";
import { convertToPmTiles } from "./pipeline/convert-to-pmtiles";
import { publishArtifact } from "./pipeline/publish-artifact";
import { probeOutput } from "./pipeline/probe-output";
import { withIngestLock } from "./pipeline/lock";
import { emitIngestCompletedEvent } from "./pipeline/emit-events";

interface PersistedIngestRun {
  readonly cacheKey: string;
  readonly snapshotId: string;
  readonly artifactId: string;
  readonly artifactKey: string;
  readonly checksum: string;
  readonly byteSize: bigint;
  readonly validated: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly validationSummary: string;
}

function bigIntToSafeNumber(value: bigint): number {
  // Source PMTiles snapshots top out well below MAX_SAFE_INTEGER (~9 PB), so
  // the narrowing here is safe; clamp defensively to the safe ceiling.
  const ceiling = BigInt(Number.MAX_SAFE_INTEGER);
  const clamped = value > ceiling ? ceiling : value;
  return Number(clamped);
}

function rowToReport(row: PersistedIngestRun): IngestRunReport {
  return {
    snapshotId: row.snapshotId,
    artifactId: row.artifactId,
    artifactKey: row.artifactKey,
    checksum: row.checksum,
    byteSize: bigIntToSafeNumber(row.byteSize),
    validated: row.validated,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    validationSummary: row.validationSummary,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertStringField(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, `${field} invalid`);
  }
  return value;
}

function normalizeReportStringField(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, `${field} invalid`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, `${field} invalid`);
  }
  return normalized;
}

function validateRunReport(report: IngestRunReport): IngestRunReport {
  if (!isRecord(report)) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "report invalid");
  }
  const snapshotId = normalizeSnapshotId(normalizeReportStringField(report.snapshotId, "snapshotId"));
  const artifactId = normalizeReportStringField(report.artifactId, "artifactId");
  const artifactKey = normalizeReportStringField(report.artifactKey, "artifactKey");
  const checksum = normalizeReportStringField(report.checksum, "checksum");
  if (!Number.isFinite(report.byteSize) || !Number.isInteger(report.byteSize) || report.byteSize <= 0) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "byteSize invalid");
  }
  if (typeof report.validated !== "boolean") {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "validated invalid");
  }
  return {
    ...report,
    snapshotId,
    artifactId,
    artifactKey,
    checksum,
  };
}

function normalizeSnapshotId(snapshotId: string): string {
  const normalized = snapshotId.trim();
  if (normalized.length === 0) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "snapshotId missing");
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(normalized)) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "snapshotId invalid");
  }
  return normalized.toLowerCase();
}

function buildRunCacheKey(snapshotId: string, snapshot: PlanetSnapshot): string {
  const normalizedSourceUrl = assertStringField(snapshot.sourceUrl, "sourceUrl").trim();
  const normalizedChecksum = snapshot.expectedChecksum === undefined
    ? ""
    : assertStringField(snapshot.expectedChecksum, "expectedChecksum").trim().toLowerCase();
  return `${snapshotId}|${normalizedSourceUrl}|${normalizedChecksum}`;
}

export async function runIngestPipeline(snapshot: PlanetSnapshot): Promise<IngestRunReport> {
  if (!isRecord(snapshot)) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "snapshot invalid");
  }
  const snapshotId = normalizeSnapshotId(assertStringField(snapshot.snapshotId, "snapshotId"));
  const cacheKey = buildRunCacheKey(snapshotId, snapshot);
  return withIngestLock(cacheKey, async () => {
    const cached = await prisma.ingestRun.findUnique({ where: { cacheKey } });
    if (cached) {
      return rowToReport(cached);
    }

    const config = loadConfig();
    const startedAtMs = Date.now();
    const startedAt = new Date().toISOString();
    const raw = await fetchPlanet(snapshot, config.ingestDefaults.maxSourceBytes);
    const checksumResult = verifyChecksum(raw, snapshot.expectedChecksum);
    const converted = await convertToPmTiles(snapshotId, raw);
    const probe = probeOutput(converted.bytes);
    if (!probe.isLikelyPmTiles) {
      throw new IngestError(IngestErrorCode.CONVERSION_FAILED, "conversion output invalid");
    }
    const published = await publishArtifact(converted).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown";
      throw new IngestError(IngestErrorCode.PUBLISH_FAILED, `artifact publish failed: ${message}`);
    });
    const artifactVersion = `artifact-${snapshotId}-${published.etag.slice(0, 12)}`;
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;
    const report: IngestRunReport = {
      snapshotId,
      artifactId: artifactVersion,
      artifactKey: published.key,
      checksum: checksumResult.checksum,
      byteSize: published.size,
      validated: checksumResult.valid,
      startedAt,
      completedAt,
      durationMs,
      validationSummary: `sourceBytes=${raw.byteLength}; convertedBytes=${converted.bytes.byteLength}`,
    };
    // Ingestion side effects (artifact registration) are handled by control-plane orchestration.
    await prisma.ingestRun.upsert({
      where: { cacheKey },
      update: {
        snapshotId: report.snapshotId,
        artifactId: report.artifactId,
        artifactKey: report.artifactKey,
        checksum: report.checksum,
        byteSize: BigInt(report.byteSize),
        validated: report.validated,
        startedAt: report.startedAt,
        completedAt: report.completedAt,
        durationMs: report.durationMs,
        validationSummary: report.validationSummary,
        recordedAt: completedAt,
      },
      create: {
        cacheKey,
        snapshotId: report.snapshotId,
        artifactId: report.artifactId,
        artifactKey: report.artifactKey,
        checksum: report.checksum,
        byteSize: BigInt(report.byteSize),
        validated: report.validated,
        startedAt: report.startedAt,
        completedAt: report.completedAt,
        durationMs: report.durationMs,
        validationSummary: report.validationSummary,
        recordedAt: completedAt,
      },
    });
    emitIngestCompletedEvent(report);
    return report;
  });
}

export function emitIngestCompleted(report: IngestRunReport): ReturnType<typeof emitIngestCompletedEvent> {
  return emitIngestCompletedEvent(validateRunReport(report));
}

export function buildDefaultSnapshot(): PlanetSnapshot {
  const config = loadConfig();
  return {
    snapshotId: config.ingestDefaults.snapshotId,
    sourceUrl: config.ingestDefaults.snapshotSourceUrl,
    expectedChecksum: config.ingestDefaults.expectedChecksum,
  };
}
