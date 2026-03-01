import { strict as assert } from "node:assert";
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

test("artifact registration, promotion, rollback, and retention", () => {
const beforeRollbackIso = new Date().toISOString();
function seed(versionId: string, checksum: string): void {
  registerArtifact({
    id: versionId,
    key: `artifacts/${versionId}/tiles.pmtiles`,
    checksum,
    byteSize: 12,
    createdAt: new Date().toISOString(),
    validated: true,
  });
}

seed("artifact-a", "abc");
seed("artifact-a", "abc");
seed("artifact-b", "def");
registerArtifact({
  id: " artifact-trimmed ",
  key: "artifacts/artifact-trimmed/tiles.pmtiles",
  checksum: "trim",
  byteSize: 12,
  createdAt: new Date().toISOString(),
  validated: true,
});

promoteArtifact("artifact-a");
const promoted = promoteArtifact("artifact-b");
assert.equal(promoted.versionId, "artifact-b");
const trimmedPromoted = promoteArtifact(" artifact-trimmed ");
assert.equal(trimmedPromoted.versionId, "artifact-trimmed");

const active = getActiveArtifact();
assert.equal(active.versionId, "artifact-trimmed");

try {
  promoteArtifact("artifact-trimmed");
  assert.fail("expected duplicate promote to fail");
} catch (error: unknown) {
  assert.ok(error instanceof ArtifactError);
  assert.equal((error as ArtifactError).code, ArtifactErrorCode.PROMOTION_CONFLICT);
}

const rollback = rollbackArtifact();
assert.equal(rollback.versionId, "artifact-b");
assert.equal(Date.parse(rollback.activeSince) >= Date.parse(beforeRollbackIso), true);

const all = listArtifacts();
assert.equal(all.length >= 2, true);

try {
  promoteArtifact("missing-artifact");
  assert.fail("expected promote missing artifact to fail");
} catch (error: unknown) {
  assert.ok(error instanceof ArtifactError);
  assert.equal((error as ArtifactError).code, ArtifactErrorCode.NOT_FOUND);
}

const invalidId = "invalid-blob";
try {
  registerArtifact({
    id: invalidId,
    key: "artifacts/invalid.pmtiles",
    checksum: "xyz",
    byteSize: 0,
    createdAt: new Date().toISOString(),
    validated: false,
  });
  assert.fail("expected invalid artifact to be rejected");
} catch (error: unknown) {
  assert.ok(error instanceof ArtifactError);
  assert.equal((error as ArtifactError).code, ArtifactErrorCode.NOT_VALIDATED);
}

const rollbackFail: unknown[] = [];
try {
  rollbackArtifact();
  rollbackArtifact();
  assert.fail("expected rollback without history to fail");
} catch (error: unknown) {
  rollbackFail.push(error);
}
assert.equal(rollbackFail.length, 1);
const rollbackError = rollbackFail[0];
assert.ok(rollbackError instanceof ArtifactError);
assert.equal((rollbackError as ArtifactError).code, ArtifactErrorCode.ROLLBACK_UNAVAILABLE);

try {
  registerArtifact({
    id: "artifact-a",
    key: "artifacts/artifact-a/other.pmtiles",
    checksum: "different",
    byteSize: 12,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  assert.fail("expected conflicting artifact registration to fail");
} catch (error: unknown) {
  assert.ok(error instanceof ArtifactError);
  assert.equal((error as ArtifactError).code, ArtifactErrorCode.PROMOTION_CONFLICT);
}

registerArtifact({
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
registerArtifact({
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

try {
  registerArtifact({
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
  });
  assert.fail("expected conflicting metadata to fail");
} catch (error: unknown) {
  assert.ok(error instanceof ArtifactError);
  assert.equal((error as ArtifactError).code, ArtifactErrorCode.PROMOTION_CONFLICT);
}

try {
  registerArtifact({
    id: " ",
    key: "artifacts/bad-id/tiles.pmtiles",
    checksum: "bad-id",
    byteSize: 12,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  assert.fail("expected empty id to be rejected");
} catch (error: unknown) {
  assert.ok(error instanceof ArtifactError);
  assert.equal((error as ArtifactError).code, ArtifactErrorCode.NOT_VALIDATED);
}

try {
  registerArtifact({
    id: "invalid-created-at",
    key: "artifacts/invalid-created-at/tiles.pmtiles",
    checksum: "bad-created-at",
    byteSize: 12,
    createdAt: "not-a-date",
    validated: true,
  });
  assert.fail("expected invalid createdAt to be rejected");
} catch (error: unknown) {
  assert.ok(error instanceof ArtifactError);
  assert.equal((error as ArtifactError).code, ArtifactErrorCode.NOT_VALIDATED);
}

const timestampBase = Date.parse("2026-01-01T00:00:00.000Z");
for (let index = 0; index < 22; index += 1) {
  const versionId = `artifact-gc-${String(index).padStart(2, "0")}`;
  registerArtifact({
    id: versionId,
    key: `artifacts/${versionId}/tiles.pmtiles`,
    checksum: `checksum-${index}`,
    byteSize: 12,
    createdAt: new Date(timestampBase - (22 - index) * 1000).toISOString(),
    validated: true,
  });
}
promoteArtifact("artifact-gc-00");
const deleted = garbageCollectArtifacts();
const remainingArtifacts = listArtifacts().map((item) => item.id);
  assert.equal(remainingArtifacts.length <= 20 + 1, true);
  assert.equal(remainingArtifacts.includes("artifact-gc-00"), true);
  assert.equal(deleted.includes("artifact-gc-00"), false);
});
