import { createIngestCompletedEvent } from "../../../contracts/events/ingest-events";
import type { IngestRunReport } from "../types";

export function emitIngestCompletedEvent(report: IngestRunReport): ReturnType<typeof createIngestCompletedEvent> {
  return createIngestCompletedEvent({
    snapshotId: report.snapshotId,
    artifactVersion: report.artifactId,
    artifactKey: report.artifactKey,
    checksum: report.checksum,
    byteSize: report.byteSize,
    validated: report.validated,
  });
}
