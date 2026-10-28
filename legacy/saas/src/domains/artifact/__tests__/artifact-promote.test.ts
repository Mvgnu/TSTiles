import { strict as assert } from "node:assert";
import { prisma } from "../../../config/db";
import { ArtifactError, ArtifactErrorCode } from "../types";
import {
  getActiveArtifact,
  listArtifacts,
  promoteArtifact,
  registerArtifact,
  rollbackArtifact,
  garbageCollectArtifacts,
} from "../artifact.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

async function resetArtifactTables(): Promise<void> {
  await prisma.artifactPromotionHistory.deleteMany({});
  await prisma.activeArtifact.deleteMany({});
  await prisma.artifactVersion.deleteMany({});
}

test("artifact registration, promotion, rollback, and retention", async (): Promise<void> => {
  await resetArtifactTables();
  const beforeRollbackIso = new Date().toISOString();

  async function seed(versionId: string, checksum: string): Promise<void> {
    await registerArtifact({
      id: versionId,
      key: `artifacts/${versionId}/tiles.pmtiles`,
      checksum,
      byteSize: 12,
      createdAt: new Date().toISOString(),
      validated: true,
    });
  }

  await seed("artifact-a", "abc");
  await seed("artifact-a", "abc");
  await seed("artifact-b", "def");
  await registerArtifact({
    id: " artifact-trimmed ",
    key: "artifacts/artifact-trimmed/tiles.pmtiles",
    checksum: "trim",
    byteSize: 12,
    createdAt: new Date().toISOString(),
    validated: true,
  });

  await promoteArtifact("artifact-a");
  const promoted = await promoteArtifact("artifact-b");
  assert.equal(promoted.versionId, "artifact-b");
  const trimmedPromoted = await promoteArtifact(" artifact-trimmed ");
  assert.equal(trimmedPromoted.versionId, "artifact-trimmed");
  Reflect.set(trimmedPromoted, "versionId", "mutated-pointer");
  const activeAfterPromoteMutation = await getActiveArtifact();
  assert.equal(activeAfterPromoteMutation.versionId, "artifact-trimmed");

  const active = await getActiveArtifact();
  assert.equal(active.versionId, "artifact-trimmed");
  Reflect.set(active, "versionId", "mutated-active");
  const activeAfterExternalMutation = await getActiveArtifact();
  assert.equal(activeAfterExternalMutation.versionId, "artifact-trimmed");

  await assert.rejects(
    () => promoteArtifact("artifact-trimmed"),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.PROMOTION_CONFLICT,
  );

  const rollback = await rollbackArtifact();
  assert.equal(rollback.versionId, "artifact-b");
  assert.equal(Date.parse(rollback.activeSince) >= Date.parse(beforeRollbackIso), true);

  const all = await listArtifacts();
  assert.equal(all.length >= 2, true);
  if (all[0]) {
    Reflect.set(all[0], "id", "mutated-id");
  }
  const allReloaded = await listArtifacts();
  assert.equal(allReloaded.some((entry) => entry.id === "artifact-trimmed"), true);

  await assert.rejects(
    () => promoteArtifact("missing-artifact"),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_FOUND,
  );

  await assert.rejects(
    () => promoteArtifact("artifact\\secret"),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_FOUND,
  );

  await assert.rejects(
    () => promoteArtifact("."),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_FOUND,
  );

  await assert.rejects(
    () => promoteArtifact(42 as unknown as string),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_FOUND,
  );

  const invalidId = "invalid-blob";
  await assert.rejects(
    () => registerArtifact({
      id: invalidId,
      key: "artifacts/invalid.pmtiles",
      checksum: "xyz",
      byteSize: 0,
      createdAt: new Date().toISOString(),
      validated: false,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  // rollback once consumes the previous pointer; second rollback must fail.
  await rollbackArtifact();
  await assert.rejects(
    () => rollbackArtifact(),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.ROLLBACK_UNAVAILABLE,
  );

  await assert.rejects(
    () => registerArtifact({
      id: "artifact-a",
      key: "artifacts/artifact-a/other.pmtiles",
      checksum: "different",
      byteSize: 12,
      createdAt: new Date().toISOString(),
      validated: true,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.PROMOTION_CONFLICT,
  );

  await registerArtifact({
    id: "artifact-meta-order",
    key: "artifacts/artifact-meta-order/tiles.pmtiles",
    checksum: "meta-order",
    byteSize: 12,
    createdAt: new Date().toISOString(),
    validated: true,
    metadata: {
      alpha: "1",
      beta: "2",
    },
  });
  await registerArtifact({
    id: "artifact-meta-order",
    key: "artifacts/artifact-meta-order/tiles.pmtiles",
    checksum: "meta-order",
    byteSize: 12,
    createdAt: new Date().toISOString(),
    validated: true,
    metadata: {
      beta: "2",
      alpha: "1",
    },
  });

  await assert.rejects(
    () => registerArtifact({
      id: "artifact-meta-order",
      key: "artifacts/artifact-meta-order/tiles.pmtiles",
      checksum: "meta-order",
      byteSize: 12,
      createdAt: new Date().toISOString(),
      validated: true,
      metadata: {
        alpha: "1",
        beta: "changed",
      },
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.PROMOTION_CONFLICT,
  );

  await assert.rejects(
    () => registerArtifact({
      id: " ",
      key: "artifacts/bad-id/tiles.pmtiles",
      checksum: "bad-id",
      byteSize: 12,
      createdAt: new Date().toISOString(),
      validated: true,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  await assert.rejects(
    () => registerArtifact({
      id: "artifact/../secret",
      key: "artifacts/bad-id/tiles.pmtiles",
      checksum: "bad-path-id",
      byteSize: 12,
      createdAt: new Date().toISOString(),
      validated: true,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  await assert.rejects(
    () => registerArtifact({
      id: ".",
      key: "artifacts/dot-id/tiles.pmtiles",
      checksum: "dot-id",
      byteSize: 12,
      createdAt: new Date().toISOString(),
      validated: true,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  await assert.rejects(
    () => registerArtifact({
      id: "invalid-created-at",
      key: "artifacts/invalid-created-at/tiles.pmtiles",
      checksum: "bad-created-at",
      byteSize: 12,
      createdAt: "not-a-date",
      validated: true,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  await assert.rejects(
    () => registerArtifact(null as unknown as Parameters<typeof registerArtifact>[0]),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  await assert.rejects(
    () => registerArtifact({
      id: 42 as unknown as string,
      key: "artifacts/non-string-id/tiles.pmtiles",
      checksum: "bad-id-type",
      byteSize: 12,
      createdAt: new Date().toISOString(),
      validated: true,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  await assert.rejects(
    () => registerArtifact({
      id: "non-string-key",
      key: 42 as unknown as string,
      checksum: "bad-key-type",
      byteSize: 12,
      createdAt: new Date().toISOString(),
      validated: true,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  await assert.rejects(
    () => registerArtifact({
      id: "non-string-checksum",
      key: "artifacts/non-string-checksum/tiles.pmtiles",
      checksum: 42 as unknown as string,
      byteSize: 12,
      createdAt: new Date().toISOString(),
      validated: true,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  await assert.rejects(
    () => registerArtifact({
      id: "invalid-byte-size",
      key: "artifacts/invalid-byte-size/tiles.pmtiles",
      checksum: "bad-byte-size",
      byteSize: 12.5,
      createdAt: new Date().toISOString(),
      validated: true,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  await assert.rejects(
    () => registerArtifact({
      id: "invalid-validated",
      key: "artifacts/invalid-validated/tiles.pmtiles",
      checksum: "bad-validated",
      byteSize: 12,
      createdAt: new Date().toISOString(),
      validated: "true" as unknown as boolean,
    }),
    (error: unknown) => error instanceof ArtifactError && (error as ArtifactError).code === ArtifactErrorCode.NOT_VALIDATED,
  );

  // Reset for the GC scenario so the keep-latest math is deterministic against
  // a clean catalog state.
  await resetArtifactTables();
  const timestampBase = Date.parse("2026-01-01T00:00:00.000Z");
  for (let index = 0; index < 22; index += 1) {
    const versionId = `artifact-gc-${String(index).padStart(2, "0")}`;
    await registerArtifact({
      id: versionId,
      key: `artifacts/${versionId}/tiles.pmtiles`,
      checksum: `checksum-${index}`,
      byteSize: 12,
      createdAt: new Date(timestampBase - (22 - index) * 1000).toISOString(),
      validated: true,
    });
  }
  await promoteArtifact("artifact-gc-00");
  await promoteArtifact("artifact-gc-21");
  const deleted = await garbageCollectArtifacts();
  const remainingArtifacts = (await listArtifacts()).map((item) => item.id);
  assert.equal(remainingArtifacts.length <= 20 + 2, true);
  assert.equal(remainingArtifacts.includes("artifact-gc-00"), true);
  assert.equal(remainingArtifacts.includes("artifact-gc-21"), true);
  assert.equal(deleted.includes("artifact-gc-00"), false);
  assert.equal(deleted.includes("artifact-gc-21"), false);
  const rollbackAfterGc = await rollbackArtifact();
  assert.equal(rollbackAfterGc.versionId, "artifact-gc-00");
});
