import { loadConfig } from "../../config/load-config";
import { IngestRunReport } from "./types";
import type { PlanetSnapshot } from "./types";
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

export async function runIngestPipeline(snapshot: PlanetSnapshot): Promise<IngestRunReport> {
  const snapshotId = normalizeSnapshotId(snapshot.snapshotId);
  return withIngestLock(snapshotId, async () => {
    const cached = runCache.get(snapshotId);
    if (cached) {
      return cached;
    }

    const startedAt = new Date().toISOString();
    const raw = await fetchPlanet(snapshot);
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
    const version = {
      id: artifactVersion,
      key: published.key,
      checksum: checksumResult.checksum,
      byteSize: published.size,
      createdAt: new Date().toISOString(),
      validated: checksumResult.valid,
    };
    const completedAt = new Date().toISOString();
    const completed = new Date(completedAt).valueOf() - new Date(startedAt).valueOf();
    const report: IngestRunReport = {
      snapshotId,
      artifactId: artifactVersion,
      artifactKey: published.key,
      checksum: checksumResult.checksum,
      byteSize: published.size,
      validated: version.validated,
      startedAt,
      completedAt,
      durationMs: completed,
      validationSummary: `sourceBytes=${raw.byteLength}; convertedBytes=${converted.bytes.byteLength}`,
    };
    // Ingestion side effects (artifact registration) are handled by control-plane orchestration.
    runCache.set(snapshotId, report);
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
