import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../../../config/load-config";
import { registerArtifact, promoteArtifact } from "../../artifact/artifact.service";
import { createObjectStore, setCreateObjectStore } from "../../storage/storage.service";
import { StorageError, StorageErrorCode, type ObjectStore } from "../../storage/types";
import {
  resolveArchiveProfile,
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
const fixturePath = resolve(__dirname, "../__fixtures__/test_fixture_1.pmtiles");

async function registerArtifactWithData(artifactId: string): Promise<{ id: string; key: string; checksum: string }> {
  const key = `${artifactId}/tiles.pmtiles`;
  const payload = new Uint8Array(await readFile(fixturePath));

  const store = createObjectStore(config);
  await store.putObject(key, payload, "application/vnd.pmtiles");

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
  await registerArtifact(artifact);
  return artifact;
}

test("resolveMetadata returns active artifact and available versions", async () => {
  const artifact = await registerArtifactWithData(`artifact-${Math.random().toString(16).slice(2)}`);
  const active = await promoteArtifact(artifact.id);

  const metadata = await resolveMetadata();

  assert.equal(metadata.artifact.id, active.versionId);
  assert.equal(metadata.availableVersions.includes(artifact.id), true);
  assert.equal(metadata.etagSeed, artifact.checksum);
  const sortedVersions = [...metadata.availableVersions].sort((left, right) => left.localeCompare(right));
  assert.deepEqual(metadata.availableVersions, sortedVersions);

  const metadataTrimmed = await resolveMetadata({ artifactId: ` ${artifact.id} ` });
  assert.equal(metadataTrimmed.artifact.id, artifact.id);
  assert.equal(metadataTrimmed.activeVersionId, active.versionId);

  const metadataBlank = await resolveMetadata({ artifactId: "   " });
  assert.equal(metadataBlank.artifact.id, active.versionId);

  await assert.rejects(async () => {
    await resolveMetadata({ artifactId: "artifact/../secret" });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);

  await assert.rejects(async () => {
    await resolveMetadata({ artifactId: "." });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);

  await assert.rejects(async () => {
    await resolveMetadata({ artifactId: 42 as unknown as string });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);

  const metadataFromNull = await resolveMetadata(null as unknown as Parameters<typeof resolveMetadata>[0]);
  assert.equal(metadataFromNull.artifact.id, active.versionId);

  const metadataFromPrimitive = await resolveMetadata(42 as unknown as Parameters<typeof resolveMetadata>[0]);
  assert.equal(metadataFromPrimitive.artifact.id, active.versionId);

  const inactiveArtifact = await registerArtifactWithData(`artifact-${Math.random().toString(16).slice(2)}`);
  const metadataForInactiveArtifact = await resolveMetadata({ artifactId: inactiveArtifact.id });
  assert.equal(metadataForInactiveArtifact.artifact.id, inactiveArtifact.id);
  assert.equal(metadataForInactiveArtifact.activeVersionId, active.versionId);

  await assert.rejects(async () => {
    await resolveMetadata({ artifactId: "missing-artifact" });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);
});

test("resolveArchiveProfile returns PMTiles zoom bounds for the active artifact", async () => {
  const artifact = await registerArtifactWithData(`artifact-${Math.random().toString(16).slice(2)}`);
  await promoteArtifact(artifact.id);

  const profile = await resolveArchiveProfile({ artifactId: artifact.id });

  assert.equal(typeof profile.minZoom, "number");
  assert.equal(typeof profile.maxZoom, "number");
  assert.equal(profile.maxZoom >= profile.minZoom, true);
  assert.equal(Array.isArray(profile.bounds), true);
  assert.equal(Array.isArray(profile.center), true);

  await assert.rejects(async () => {
    await resolveArchiveProfile({ artifactId: "../secret" });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);

  await assert.rejects(async () => {
    await resolveArchiveProfile({ artifactId: "." });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);

  await assert.rejects(async () => {
    await resolveArchiveProfile({ artifactId: 42 as unknown as string });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);

  const profileFromNull = await resolveArchiveProfile(null as unknown as Parameters<typeof resolveArchiveProfile>[0]);
  assert.equal(typeof profileFromNull.minZoom, "number");
  assert.equal(typeof profileFromNull.maxZoom, "number");

  const profileFromPrimitive = await resolveArchiveProfile(42 as unknown as Parameters<typeof resolveArchiveProfile>[0]);
  assert.equal(typeof profileFromPrimitive.minZoom, "number");
  assert.equal(typeof profileFromPrimitive.maxZoom, "number");
});

test("resolveVectorTile resolves bytes for valid coordinates", async () => {
  const artifact = await registerArtifactWithData(`artifact-${Math.random().toString(16).slice(2)}`);
  await promoteArtifact(artifact.id);

  const tile = await resolveVectorTile({ z: 0, x: 0, y: 0, artifactId: artifact.id });

  assert.equal(tile.artifactId, artifact.id);
  assert.equal(tile.key, `${artifact.key}:/tiles/0/0/0.mvt`);
  assert.equal(tile.bytes.byteLength > 0, true);
  assert.equal(tile.contentType, "application/vnd.mapbox-vector-tile");
  assert.equal(tile.etagSeed.length > 0, true);

  const trimmedIdTile = await resolveVectorTile({ z: 0, x: 0, y: 0, artifactId: ` ${artifact.id} ` });
  assert.equal(trimmedIdTile.artifactId, artifact.id);

  await assert.rejects(async () => {
    await resolveVectorTile({ z: 0, x: 0, y: 0, artifactId: "artifact\\secret" });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);

  await assert.rejects(async () => {
    await resolveVectorTile({ z: 0, x: 0, y: 0, artifactId: "." });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);

  await assert.rejects(async () => {
    await resolveVectorTile({ z: 0, x: 0, y: 0, artifactId: 42 as unknown as string });
  }, /RESOLVER_ARTIFACT_UNAVAILABLE/);
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
  await promoteArtifact(artifact.id);
  try {
    await resolveVectorTile(null as unknown as { z: number; x: number; y: number; artifactId?: string });
    assert.fail("expected malformed input");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message, "RESOLVER_BAD_COORDINATES");
  }

  try {
    await resolveVectorTile(42 as unknown as { z: number; x: number; y: number; artifactId?: string });
    assert.fail("expected malformed primitive input");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message, "RESOLVER_BAD_COORDINATES");
  }

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
  await promoteArtifact(active.id);

  try {
    await resolveVectorTile({ z: 0, x: 0, y: 0, artifactId: "missing-artifact" });
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
  await registerArtifact(artifact);
  await promoteArtifact(artifact.id);
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
  await promoteArtifact(artifact.id);

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
    await resolveVectorTile({ z: 0, x: 0, y: 0, artifactId: artifact.id });
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
  const fixture = new Uint8Array(await readFile(fixturePath));
  await registerArtifact({
    id: artifactId,
    key: artifactKey,
    checksum: `checksum-${artifactId}`,
    byteSize: fixture.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await promoteArtifact(artifactId);

  let headCalls = 0;
  let rangeCalls = 0;
  setCreateObjectStore((): ObjectStore => ({
    head: async () => {
      headCalls += 1;
      return {
        key: artifactKey,
        size: fixture.byteLength,
        etag: "etag-budget",
        contentType: "application/vnd.pmtiles",
        lastModified: new Date().toISOString(),
      };
    },
    getRange: async ({ start, end }) => {
      rangeCalls += 1;
      const safeStart = start ?? 0;
      const safeEnd = end ?? fixture.byteLength - 1;
      return {
        key: artifactKey,
        bytes: fixture.slice(safeStart, safeEnd + 1),
        start: safeStart,
        end: safeEnd,
        totalBytes: fixture.byteLength,
        contentType: "application/vnd.pmtiles",
        etag: "etag-budget",
      };
    },
    putObject: async () => {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "read-only");
    },
  }));
  try {
    const resolved = await resolveVectorTile({
      z: 0,
      x: 0,
      y: 0,
      artifactId,
    });
    assert.equal(resolved.bytes.byteLength > 0, true);
    assert.equal(headCalls, 0);
    assert.equal(rangeCalls >= 2, true);
  } finally {
    setCreateObjectStore(undefined);
  }
});

test("resolveVectorTile cache stays scoped to the current object store instance", async () => {
  const artifactId = `artifact-store-scope-${Math.random().toString(16).slice(2)}`;
  const artifactKey = `${artifactId}/tiles.pmtiles`;
  const fixture = new Uint8Array(await readFile(fixturePath));
  await registerArtifact({
    id: artifactId,
    key: artifactKey,
    checksum: `checksum-${artifactId}`,
    byteSize: fixture.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await promoteArtifact(artifactId);

  let firstStoreRangeCalls = 0;
  let secondStoreRangeCalls = 0;
  let useSecondStore = false;

  setCreateObjectStore((): ObjectStore => ({
    head: async () => ({
      key: artifactKey,
      size: fixture.byteLength,
      etag: useSecondStore ? "etag-second" : "etag-first",
      contentType: "application/vnd.pmtiles",
      lastModified: new Date().toISOString(),
    }),
    getRange: async ({ start, end }) => {
      if (useSecondStore) {
        secondStoreRangeCalls += 1;
      } else {
        firstStoreRangeCalls += 1;
      }
      const safeStart = start ?? 0;
      const safeEnd = end ?? fixture.byteLength - 1;
      return {
        key: artifactKey,
        bytes: fixture.slice(safeStart, safeEnd + 1),
        start: safeStart,
        end: safeEnd,
        totalBytes: fixture.byteLength,
        contentType: "application/vnd.pmtiles",
        etag: useSecondStore ? "etag-second" : "etag-first",
      };
    },
    putObject: async () => {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "read-only");
    },
  }));
  try {
    await resolveVectorTile({
      z: 0,
      x: 0,
      y: 0,
      artifactId,
    });
    assert.equal(firstStoreRangeCalls > 0, true);

    useSecondStore = true;
    await resolveVectorTile({
      z: 0,
      x: 0,
      y: 0,
      artifactId,
    });
    assert.equal(secondStoreRangeCalls > 0, true);
  } finally {
    setCreateObjectStore(undefined);
  }
});
