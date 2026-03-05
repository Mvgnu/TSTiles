import { loadConfig } from "../../config/load-config";
import type { IngestRunReport, PlanetSnapshot } from "./types";
import { IngestError, IngestErrorCode } from "./types";
import { fetchPlanet } from "./pipeline/fetch-planet";
import { verifyChecksum } from "./pipeline/verify-checksum";
import { convertToPmTiles } from "./pipeline/convert-to-pmtiles";
import { publishArtifact } from "./pipeline/publish-artifact";
import { probeOutput } from "./pipeline/probe-output";
import { withIngestLock } from "./pipeline/lock";
import { emitIngestCompletedEvent } from "./pipeline/emit-events";

const runCache = new Map<string, IngestRunReport>();
const maxRunCacheEntries = 128;

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
  const normalizedSourceUrl = snapshot.sourceUrl.trim();
  const normalizedChecksum = snapshot.expectedChecksum?.trim().toLowerCase() ?? "";
  return `${snapshotId}|${normalizedSourceUrl}|${normalizedChecksum}`;
}

export async function runIngestPipeline(snapshot: PlanetSnapshot): Promise<IngestRunReport> {
  const snapshotId = normalizeSnapshotId(snapshot.snapshotId);
  const cacheKey = buildRunCacheKey(snapshotId, snapshot);
  return withIngestLock(snapshotId, async () => {
    const cached = runCache.get(cacheKey);
    if (cached) {
      return cached;
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
    runCache.set(cacheKey, report);
    while (runCache.size > maxRunCacheEntries) {
      const oldest = runCache.keys().next();
      if (oldest.done) {
        break;
      }
      runCache.delete(oldest.value);
    }
    emitIngestCompletedEvent(report);
    return report;
  });
}

export function emitIngestCompleted(report: IngestRunReport): ReturnType<typeof emitIngestCompletedEvent> {
  return emitIngestCompletedEvent(report);
}

export function buildDefaultSnapshot(): PlanetSnapshot {
  const config = loadConfig();
  return {
    snapshotId: config.ingestDefaults.snapshotId,
    sourceUrl: config.ingestDefaults.snapshotSourceUrl,
    expectedChecksum: config.ingestDefaults.expectedChecksum,
  };
}
