import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import * as storageService from "../../storage/storage.service";
import { IngestError, IngestErrorCode } from "../types";
import { emitIngestCompleted, runIngestPipeline } from "../ingest.service";

process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "ingest-pipeline-bucket";
process.env.NODE_ENV = "development";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const toBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

const assertIngestError = async (
  snapshot: Parameters<typeof runIngestPipeline>[0],
  expectedCode: string,
): Promise<void> => {
  try {
    await runIngestPipeline(snapshot);
    assert.fail("expected ingest failure");
  } catch (error: unknown) {
    assert.ok(error instanceof IngestError);
    assert.equal((error as IngestError).code, expectedCode);
  }
};

test("ingest pipeline runs and emits completion events", async (): Promise<void> => {
  const snapshot = {
    snapshotId: "snapshot-valid",
    sourceUrl: "data:text/plain,hello-ingest",
    expectedChecksum: sha256("hello-ingest"),
  };
  const report = await runIngestPipeline(snapshot);
  assert.equal(report.snapshotId, snapshot.snapshotId);
  assert.equal(report.artifactId.startsWith(`artifact-${snapshot.snapshotId}-`), true);
  assert.equal(report.artifactKey, `artifacts/${snapshot.snapshotId}/tiles.pmtiles`);
  assert.equal(report.checksum, snapshot.expectedChecksum);
  assert.equal(report.byteSize, toBytes("hello-ingest").byteLength);
  assert.equal(report.validationSummary.includes("sourceBytes="), true);

  const event = emitIngestCompleted(report);
  assert.equal(event.artifactVersion, report.artifactId);
  assert.equal(event.artifactKey, report.artifactKey);
  assert.equal(event.byteSize, report.byteSize);

  const cachedSnapshot = {
    snapshotId: "snapshot-idempotent",
    sourceUrl: "data:text/plain,cache-check",
    expectedChecksum: sha256("cache-check"),
  };
  const first = await runIngestPipeline(cachedSnapshot);
  const second = await runIngestPipeline(cachedSnapshot);
  assert.equal(first.artifactId, second.artifactId);
  assert.equal(first.startedAt, second.startedAt);

  const base64Snapshot = {
    snapshotId: "snapshot-base64",
    sourceUrl: `data:text/plain;base64,${Buffer.from("base64-ingest").toString("base64")}`,
    expectedChecksum: sha256("base64-ingest"),
  };
  const base64Report = await runIngestPipeline(base64Snapshot);
  assert.equal(base64Report.checksum, base64Snapshot.expectedChecksum);
  assert.equal(base64Report.byteSize, toBytes("base64-ingest").byteLength);

  const trimmedSourceSnapshot = {
    snapshotId: "snapshot-trimmed-source",
    sourceUrl: "   data:text/plain,trimmed-source   ",
    expectedChecksum: sha256("trimmed-source").toUpperCase(),
  };
  const trimmedSourceReport = await runIngestPipeline(trimmedSourceSnapshot);
  assert.equal(trimmedSourceReport.checksum, sha256("trimmed-source"));
  assert.equal(trimmedSourceReport.byteSize, toBytes("trimmed-source").byteLength);

  await assertIngestError(
    {
      snapshotId: "snapshot-checksum-mismatch",
      sourceUrl: "data:text/plain,checksum-check",
      expectedChecksum: "000000",
    },
    IngestErrorCode.CHECKSUM_FAILED,
  );

  await assertIngestError(
    {
      snapshotId: "snapshot-invalid-source",
      sourceUrl: "ftp://example.com/planet.osm.pbf",
      expectedChecksum: undefined,
    },
    IngestErrorCode.SOURCE_UNAVAILABLE,
  );

  const originalFetch = globalThis.fetch;
  (globalThis as { fetch?: typeof fetch }).fetch = async () => {
    throw new Error("network down");
  };
  try {
    await assertIngestError(
      {
        snapshotId: "snapshot-http-fetch-failed",
        sourceUrl: "https://example.com/planet.osm.pbf",
        expectedChecksum: undefined,
      },
      IngestErrorCode.SOURCE_UNAVAILABLE,
    );
  } finally {
    (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
  }

  await assertIngestError(
    {
      snapshotId: "snapshot-file-missing",
      sourceUrl: "file:///definitely-missing-ingest-source.osm.pbf",
      expectedChecksum: undefined,
    },
    IngestErrorCode.SOURCE_UNAVAILABLE,
  );

  const normalizedSnapshotReport = await runIngestPipeline({
    snapshotId: "SNAPSHOT-UPPER",
    sourceUrl: "data:text/plain,upper-case-snapshot",
    expectedChecksum: sha256("upper-case-snapshot"),
  });
  assert.equal(normalizedSnapshotReport.snapshotId, "snapshot-upper");
  assert.equal(normalizedSnapshotReport.artifactKey, "artifacts/snapshot-upper/tiles.pmtiles");

  await assertIngestError(
    {
      snapshotId: "   ",
      sourceUrl: "data:text/plain,invalid-snapshot-id",
      expectedChecksum: undefined,
    },
    IngestErrorCode.SOURCE_UNAVAILABLE,
  );

  await assertIngestError(
    {
      snapshotId: "../unsafe",
      sourceUrl: "data:text/plain,invalid-snapshot-id-shape",
      expectedChecksum: undefined,
    },
    IngestErrorCode.SOURCE_UNAVAILABLE,
  );

  storageService.setCreateObjectStore(() => {
    throw new Error("storage unavailable");
  });
  try {
    await assertIngestError(
      {
        snapshotId: "snapshot-publish-failed",
        sourceUrl: "data:text/plain,publish-fail",
        expectedChecksum: sha256("publish-fail"),
      },
      IngestErrorCode.PUBLISH_FAILED,
    );
  } finally {
    storageService.setCreateObjectStore(undefined);
  }

  const evictedSeed = await runIngestPipeline({
    snapshotId: "snapshot-evict-seed",
    sourceUrl: "data:text/plain,evict-seed",
    expectedChecksum: sha256("evict-seed"),
  });
  for (let index = 0; index < 140; index += 1) {
    const snapshotId = `snapshot-evict-${String(index).padStart(3, "0")}`;
    const payload = `evict-${index}`;
    await runIngestPipeline({
      snapshotId,
      sourceUrl: `data:text/plain,${payload}`,
      expectedChecksum: sha256(payload),
    });
  }
  const evictedSeedRerun = await runIngestPipeline({
    snapshotId: "snapshot-evict-seed",
    sourceUrl: "data:text/plain,evict-seed",
    expectedChecksum: sha256("evict-seed"),
  });
  assert.equal(evictedSeedRerun.startedAt === evictedSeed.startedAt, false);
});
