import { strict as assert } from "node:assert";
import { loadConfig } from "../../../config/load-config";
import { registerArtifact, promoteArtifact } from "../../artifact/artifact.service";
import { createObjectStore, setCreateObjectStore } from "../../storage/storage.service";
import { StorageError, StorageErrorCode, type ObjectStore } from "../../storage/types";
import {
  resolveMetadata,
  resolveVectorTile,
  validateTileCoordinates,
} from "../tile-resolver.service";
import { ContractErrorCode } from "../../../contracts/types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.NODE_ENV = "development";

const config = loadConfig();

async function registerArtifactWithData(artifactId: string): Promise<{ id: string; key: string; checksum: string }> {
  const key = `${artifactId}/tiles.pmtiles`;
  const payload = new TextEncoder().encode(`payload-${artifactId}-${Date.now()}`);

  const store = createObjectStore(config);
  await store.putObject(key, payload, "application/octet-stream");

  const artifact = {
    id: artifactId,
    key,
    checksum: `checksum-${artifactId}`,
    byteSize: payload.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
    metadata: {
      format: "pmtiles",
    },
  };
  registerArtifact(artifact);
  return artifact;
}

test("resolveMetadata returns active artifact and available versions", async () => {
  const artifact = await registerArtifactWithData(`artifact-${Math.random().toString(16).slice(2)}`);
  const active = promoteArtifact(artifact.id);

  const metadata = resolveMetadata();

  assert.equal(metadata.artifact.id, active.versionId);
  assert.equal(metadata.availableVersions.includes(artifact.id), true);
  assert.equal(metadata.etagSeed, artifact.checksum);
  const sortedVersions = [...metadata.availableVersions].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(metadata.availableVersions, sortedVersions);

  const metadataTrimmed = resolveMetadata({ artifactId: ` ${artifact.id} ` });
  assert.equal(metadataTrimmed.artifact.id, artifact.id);

  const metadataBlank = resolveMetadata({ artifactId: "   " });
  assert.equal(metadataBlank.artifact.id, active.versionId);

  assert.throws(() => {
    resolveMetadata({ artifactId: "missing-artifact" });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);
});

test("resolveVectorTile resolves bytes for valid coordinates", async () => {
  const artifact = await registerArtifactWithData(`artifact-${Math.random().toString(16).slice(2)}`);
  promoteArtifact(artifact.id);

  const tile = await resolveVectorTile({ z: 2, x: 2, y: 3, artifactId: artifact.id });

  assert.equal(tile.artifactId, artifact.id);
  assert.equal(tile.key, `${artifact.key}:/tiles/2/2/3.mvt`);
  assert.equal(tile.bytes.byteLength > 0, true);
  assert.equal(tile.contentType, "application/octet-stream");
  assert.equal(tile.etagSeed.length > 0, true);

  const trimmedIdTile = await resolveVectorTile({ z: 2, x: 2, y: 3, artifactId: ` ${artifact.id} ` });
  assert.equal(trimmedIdTile.artifactId, artifact.id);
});

test("validateTileCoordinates forwards schema contracts", () => {
  const error = validateTileCoordinates({ z: "1", x: 2, y: 3 });
  assert.equal(error?.code, ContractErrorCode.SCHEMA_INVALID);

  const noError = validateTileCoordinates({ z: 2, x: 2, y: 3 });
  assert.equal(noError, null);

  const outOfRange = validateTileCoordinates({ z: 31, x: 0, y: 0 });
  assert.equal(outOfRange?.code, ContractErrorCode.SCHEMA_INVALID);
});

test("resolveVectorTile rejects invalid coordinates", async () => {
  const artifact = await registerArtifactWithData(`artifact-${Math.random().toString(16).slice(2)}`);
  promoteArtifact(artifact.id);
  try {
    await resolveVectorTile({ z: -1, x: 0, y: 0, artifactId: artifact.id });
    assert.fail("expected bad coordinates");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message, "RESOLVER_BAD_COORDINATES");
  }

  try {
    await resolveVectorTile({ z: 31, x: 0, y: 0, artifactId: artifact.id });
    assert.fail("expected out-of-range zoom");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message, "RESOLVER_BAD_COORDINATES");
  }

  try {
    await resolveVectorTile({ z: 1, x: 2, y: 0, artifactId: artifact.id });
    assert.fail("expected out-of-range x");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message, "RESOLVER_BAD_COORDINATES");
  }

  try {
    await resolveVectorTile({ z: 1, x: 0, y: 2, artifactId: artifact.id });
    assert.fail("expected out-of-range y");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message, "RESOLVER_BAD_COORDINATES");
  }
});

test("resolveVectorTile fails when artifact is unknown", async () => {
  const active = await registerArtifactWithData(`artifact-${Math.random().toString(16).slice(2)}`);
  promoteArtifact(active.id);

  try {
    await resolveVectorTile({ z: 2, x: 2, y: 3, artifactId: "missing-artifact" });
    assert.fail("expected unknown artifact error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message, "RESOLVER_ARTIFACT_UNAVAILABLE");
  }
});

test("resolveVectorTile maps missing object storage to resolver failure", async () => {
  const artifact = {
    id: `artifact-missing-object-${Math.random().toString(16).slice(2)}`,
    key: `missing-object-${Math.random().toString(16).slice(2)}/tiles.pmtiles`,
    checksum: `checksum-missing-object-${Math.random().toString(16).slice(2)}`,
    byteSize: 8,
    createdAt: new Date().toISOString(),
    validated: true,
  };
  registerArtifact(artifact);
  promoteArtifact(artifact.id);
  try {
    await resolveVectorTile({
      z: 0,
      x: 0,
      y: 0,
      artifactId: artifact.id,
    });
    assert.fail("expected missing object error");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message === "RESOLVER_TILE_NOT_FOUND" || message === "RESOLVER_ORIGIN_READ_FAILED", true);
  }
});

test("resolveVectorTile maps storage precondition failures to artifact unavailable", async () => {
  const artifact = await registerArtifactWithData(`artifact-${Math.random().toString(16).slice(2)}`);
  promoteArtifact(artifact.id);

  setCreateObjectStore((): ObjectStore => ({
    head: async () => ({
      key: artifact.key,
      size: 1024,
      etag: "etag",
      contentType: "application/octet-stream",
      lastModified: new Date().toISOString(),
    }),
    getRange: async () => {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "etag mismatch");
    },
    putObject: async () => {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "read-only");
    },
  }));
  try {
    await resolveVectorTile({ z: 2, x: 2, y: 3, artifactId: artifact.id });
    assert.fail("expected artifact unavailable");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message, "RESOLVER_ARTIFACT_UNAVAILABLE");
  } finally {
    setCreateObjectStore(undefined);
  }
});

test("resolveVectorTile performs bounded origin operations per request", async () => {
  const artifactId = `artifact-op-budget-${Math.random().toString(16).slice(2)}`;
  const artifactKey = `${artifactId}/tiles.pmtiles`;
  registerArtifact({
    id: artifactId,
    key: artifactKey,
    checksum: `checksum-${artifactId}`,
    byteSize: 2048,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  promoteArtifact(artifactId);

  let headCalls = 0;
  let rangeCalls = 0;
  setCreateObjectStore((): ObjectStore => ({
    head: async () => {
      headCalls += 1;
      return {
        key: artifactKey,
        size: 4096,
        etag: "etag-budget",
        contentType: "application/octet-stream",
        lastModified: new Date().toISOString(),
      };
    },
    getRange: async ({ start, end }) => {
      rangeCalls += 1;
      return {
        key: artifactKey,
        bytes: new Uint8Array([1, 2, 3]),
        start: start ?? 0,
        end: end ?? 2,
        totalBytes: 4096,
        contentType: "application/octet-stream",
        etag: "etag-budget",
      };
    },
    putObject: async () => {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "read-only");
    },
  }));
  try {
    const resolved = await resolveVectorTile({
      z: 2,
      x: 2,
      y: 3,
      artifactId,
    });
    assert.equal(resolved.bytes.byteLength, 3);
    assert.equal(headCalls, 1);
    assert.equal(rangeCalls, 1);
  } finally {
    setCreateObjectStore(undefined);
  }
});
