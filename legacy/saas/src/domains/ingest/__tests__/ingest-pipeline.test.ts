import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as storageService from "../../storage/storage.service";
import { IngestError, IngestErrorCode } from "../types";
import { emitIngestCompleted, runIngestPipeline } from "../ingest.service";

process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "ingest-pipeline-bucket";
process.env.NODE_ENV = "development";
process.env.INGEST_MAX_SOURCE_BYTES = "1048576";

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

  try {
    emitIngestCompleted(null as unknown as Parameters<typeof emitIngestCompleted>[0]);
    assert.fail("expected malformed ingest report to be rejected");
  } catch (error: unknown) {
    assert.ok(error instanceof IngestError);
    assert.equal((error as IngestError).code, IngestErrorCode.SOURCE_UNAVAILABLE);
  }

  try {
    emitIngestCompleted({
      ...report,
      artifactId: 42 as unknown as string,
    });
    assert.fail("expected non-string artifactId to be rejected");
  } catch (error: unknown) {
    assert.ok(error instanceof IngestError);
    assert.equal((error as IngestError).code, IngestErrorCode.SOURCE_UNAVAILABLE);
  }

  try {
    emitIngestCompleted({
      ...report,
      byteSize: 12.5,
    });
    assert.fail("expected non-integer byteSize to be rejected");
  } catch (error: unknown) {
    assert.ok(error instanceof IngestError);
    assert.equal((error as IngestError).code, IngestErrorCode.SOURCE_UNAVAILABLE);
  }

  try {
    emitIngestCompleted({
      ...report,
      validated: "true" as unknown as boolean,
    });
    assert.fail("expected non-boolean validated to be rejected");
  } catch (error: unknown) {
    assert.ok(error instanceof IngestError);
    assert.equal((error as IngestError).code, IngestErrorCode.SOURCE_UNAVAILABLE);
  }

  const cachedSnapshot = {
    snapshotId: "snapshot-idempotent",
    sourceUrl: "data:text/plain,cache-check",
    expectedChecksum: sha256("cache-check"),
  };
  const first = await runIngestPipeline(cachedSnapshot);
  const second = await runIngestPipeline(cachedSnapshot);
  assert.equal(first.artifactId, second.artifactId);
  assert.equal(first.startedAt, second.startedAt);
  const changedSource = await runIngestPipeline({
    snapshotId: cachedSnapshot.snapshotId,
    sourceUrl: "data:text/plain,cache-check-updated",
    expectedChecksum: sha256("cache-check-updated"),
  });
  assert.equal(changedSource.artifactId === first.artifactId, false);

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

  const previousMaxSourceBytes = process.env.INGEST_MAX_SOURCE_BYTES;
  process.env.INGEST_MAX_SOURCE_BYTES = "8";
  try {
    await assertIngestError(
      {
        snapshotId: "snapshot-too-large",
        sourceUrl: "data:text/plain,123456789",
        expectedChecksum: undefined,
      },
      IngestErrorCode.SOURCE_TOO_LARGE,
    );
  } finally {
    if (previousMaxSourceBytes === undefined) {
      Reflect.deleteProperty(process.env, "INGEST_MAX_SOURCE_BYTES");
    } else {
      process.env.INGEST_MAX_SOURCE_BYTES = previousMaxSourceBytes;
    }
  }

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

  await assertIngestError(
    {
      snapshotId: "snapshot-file-non-local",
      sourceUrl: "file://remote-host/tmp/planet.osm.pbf",
      expectedChecksum: undefined,
    },
    IngestErrorCode.SOURCE_UNAVAILABLE,
  );

  await assertIngestError(
    {
      snapshotId: "snapshot-file-credentials",
      sourceUrl: "file://user:secret@/tmp/planet.osm.pbf",
      expectedChecksum: undefined,
    },
    IngestErrorCode.SOURCE_UNAVAILABLE,
  );

  await assertIngestError(
    {
      snapshotId: "snapshot-file-query-fragment",
      sourceUrl: "file:///tmp/planet.osm.pbf?token=secret#preview",
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

  await assertIngestError(
    {
      snapshotId: 42 as unknown as string,
      sourceUrl: "data:text/plain,invalid-runtime-snapshot-id",
      expectedChecksum: undefined,
    },
    IngestErrorCode.SOURCE_UNAVAILABLE,
  );

  await assertIngestError(
    null as unknown as Parameters<typeof runIngestPipeline>[0],
    IngestErrorCode.SOURCE_UNAVAILABLE,
  );

  await assertIngestError(
    42 as unknown as Parameters<typeof runIngestPipeline>[0],
    IngestErrorCode.SOURCE_UNAVAILABLE,
  );

  await assertIngestError(
    {
      snapshotId: "snapshot-invalid-runtime-source",
      sourceUrl: 42 as unknown as string,
      expectedChecksum: undefined,
    },
    IngestErrorCode.SOURCE_UNAVAILABLE,
  );

  await assertIngestError(
    {
      snapshotId: "snapshot-invalid-runtime-checksum",
      sourceUrl: "data:text/plain,invalid-runtime-checksum",
      expectedChecksum: 42 as unknown as string,
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

  // Persistent idempotency: re-running an identical snapshot identity returns
  // the same cached IngestRun row without re-fetching/converting/publishing,
  // so multi-instance and restart-survival ingest deduplication holds.
  const idempotencySnapshotId = `snapshot-idempotent-${Math.random().toString(16).slice(2, 10)}`;
  const idempotentSeed = await runIngestPipeline({
    snapshotId: idempotencySnapshotId,
    sourceUrl: "data:text/plain,idempotent-seed",
    expectedChecksum: sha256("idempotent-seed"),
  });
  for (let index = 0; index < 5; index += 1) {
    const filler = `snapshot-idempotent-filler-${Math.random().toString(16).slice(2, 10)}`;
    const payload = `filler-${index}`;
    await runIngestPipeline({
      snapshotId: filler,
      sourceUrl: `data:text/plain,${payload}`,
      expectedChecksum: sha256(payload),
    });
  }
  const idempotentSeedRerun = await runIngestPipeline({
    snapshotId: idempotencySnapshotId,
    sourceUrl: "data:text/plain,idempotent-seed",
    expectedChecksum: sha256("idempotent-seed"),
  });
  assert.equal(idempotentSeedRerun.startedAt, idempotentSeed.startedAt);
  assert.equal(idempotentSeedRerun.artifactId, idempotentSeed.artifactId);
});

test("ingest only deduplicates concurrent runs for the same full snapshot identity", async (): Promise<void> => {
  const [first, second] = await Promise.all([
    runIngestPipeline({
      snapshotId: "snapshot-concurrent-identity",
      sourceUrl: "data:text/plain,concurrent-a",
      expectedChecksum: sha256("concurrent-a"),
    }),
    runIngestPipeline({
      snapshotId: "snapshot-concurrent-identity",
      sourceUrl: "data:text/plain,concurrent-b",
      expectedChecksum: sha256("concurrent-b"),
    }),
  ]);

  assert.equal(first.snapshotId, "snapshot-concurrent-identity");
  assert.equal(second.snapshotId, "snapshot-concurrent-identity");
  assert.equal(first.checksum, sha256("concurrent-a"));
  assert.equal(second.checksum, sha256("concurrent-b"));
  assert.equal(first.artifactId === second.artifactId, false);
});

test("ingest pipeline publishes PMTiles artifacts to the filesystem backend", async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "tileserver-ingest-root-"));
  const previousMode = process.env.OBJECT_STORE_MODE;
  const previousBucket = process.env.OBJECT_STORE_BUCKET;
  try {
    process.env.OBJECT_STORE_MODE = "filesystem";
    process.env.OBJECT_STORE_BUCKET = root;

    const filesystemSnapshotId = `snapshot-filesystem-publish-${Math.random().toString(16).slice(2, 10)}`;
    const report = await runIngestPipeline({
      snapshotId: filesystemSnapshotId,
      sourceUrl: "data:text/plain,filesystem-artifact",
      expectedChecksum: sha256("filesystem-artifact"),
    });

    const publishedBytes = await readFile(join(root, report.artifactKey));
    assert.equal(new TextDecoder().decode(publishedBytes), "filesystem-artifact");
  } finally {
    if (previousMode === undefined) {
      Reflect.deleteProperty(process.env, "OBJECT_STORE_MODE");
    } else {
      process.env.OBJECT_STORE_MODE = previousMode;
    }
    if (previousBucket === undefined) {
      Reflect.deleteProperty(process.env, "OBJECT_STORE_BUCKET");
    } else {
      process.env.OBJECT_STORE_BUCKET = previousBucket;
    }
    await rm(root, { recursive: true, force: true });
  }
});
