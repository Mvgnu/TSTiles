import { strict as assert } from "node:assert";
import { handleTileRequest } from "../tile-api.service";
import { getActiveArtifact, promoteArtifact, registerArtifact } from "../../artifact/artifact.service";
import type { TileRequest } from "../types";
import { createObjectStore, setCreateObjectStore } from "../../storage/storage.service";
import { StorageError, StorageErrorCode, type ObjectStore } from "../../storage/types";
import { loadConfig } from "../../../config/load-config";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.ADMIN_TOKEN = "admin-token";
process.env.ALLOWED_ORIGINS = "https://example.com";
process.env.ALLOWED_TILES_TOKENS = "tile-token";
process.env.NODE_ENV = "development";

const originalCacheTtl = process.env.CACHE_TTL_SECONDS;
const originalHeadEnabled = process.env.HEAD_ENABLED;

test("tile route handles auth/cache and returns proper responses", async (): Promise<void> => {
  const config = loadConfig(process.env);
  const store = createObjectStore(config);
  await store.putObject("artifacts/artifact-a/tiles.pmtiles", new TextEncoder().encode("artifact-bytes"));
  await store.putObject("artifacts/custom-artifact-a/tiles.pmtiles", new TextEncoder().encode("custom-key-bytes"));
  registerArtifact({
    id: "artifact-a",
    key: "artifacts/artifact-a/tiles.pmtiles",
    checksum: "dummy",
    byteSize: 13,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  promoteArtifact("artifact-a");
  registerArtifact({
    id: "artifact-custom",
    key: "artifacts/custom-artifact-a/tiles.pmtiles",
    checksum: "custom",
    byteSize: 16,
    createdAt: new Date().toISOString(),
    validated: true,
  });

  const activeArtifact = getActiveArtifact().versionId;

  const response = await handleTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(response.status, 200);
  assert.equal(Boolean(response.headers["x-tile-cache-key"]), true);
  assert.equal(response.headers["cache-control"], "public, max-age=300");

  const responseWithPrefix = await handleTileRequest({
    method: "GET",
    path: "/v1/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(responseWithPrefix.status, 200);
  assert.equal(responseWithPrefix.headers["x-tile-cache-key"], response.headers["x-tile-cache-key"]);

  const withQuery = await handleTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt?abc=1",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(withQuery.status, 200);
  assert.equal(withQuery.headers["x-tile-cache-key"], response.headers["x-tile-cache-key"]);

  process.env.CACHE_TTL_SECONDS = "42";
  const responseWithDifferentCache = await handleTileRequest({
    method: "GET",
    path: "/tiles/3/4/5.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(responseWithDifferentCache.status, 200);
  assert.equal(responseWithDifferentCache.headers["cache-control"], "public, max-age=42");
  if (originalCacheTtl === undefined) {
    delete process.env.CACHE_TTL_SECONDS;
  } else {
    process.env.CACHE_TTL_SECONDS = originalCacheTtl;
  }
  
  const mixedOrigin = await handleTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    headers: {
      Origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(mixedOrigin.status, 200);
  assert.equal(mixedOrigin.headers["access-control-allow-origin"], "https://example.com");

  promoteArtifact("artifact-custom");
  const customKeyResponse = await handleTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(customKeyResponse.status, 200);

  const head = await handleTileRequest({
    method: "HEAD",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers["etag"], customKeyResponse.headers["etag"]);
  if (customKeyResponse.body !== undefined) {
    assert.equal(head.headers["content-length"], String(customKeyResponse.body.byteLength));
  }

  process.env.HEAD_ENABLED = "false";
  const headDisabled = await handleTileRequest({
    method: "HEAD",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(headDisabled.status, 405);
  assert.equal(headDisabled.body !== undefined, true);
  assert.equal(headDisabled.headers["cache-control"], "no-store");

  const options = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers["access-control-allow-origin"], "https://example.com");

  const optionsWithoutAuth = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(optionsWithoutAuth.status, 204);
  assert.equal(optionsWithoutAuth.headers["access-control-allow-origin"], "https://example.com");

  const optionsBadPath = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/bad",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(optionsBadPath.status, 400);
  assert.equal(optionsBadPath.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(optionsBadPath.headers["cache-control"], "no-store");

  const bad = await handleTileRequest({
    method: "GET",
    path: "/tiles/bad",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(bad.headers["cache-control"], "no-store");

  const outOfRange = await handleTileRequest({
    method: "GET",
    path: "/tiles/1/2/0.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(outOfRange.status, 400);
  assert.equal(outOfRange.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(outOfRange.headers["cache-control"], "no-store");

  const denied = await handleTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers["cache-control"], "no-store");

  const originDenied = await handleTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://other.example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(originDenied.status, 403);
  assert.equal(originDenied.headers["cache-control"], "no-store");

  const badMethod = await handleTileRequest({
    method: "POST",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  } as unknown as TileRequest);
  assert.equal(badMethod.status, 400);
  assert.equal(badMethod.headers["cache-control"], "no-store");

  const originalActiveArtifact = activeArtifact;
  registerArtifact({
    id: "missing-artifact-key",
    key: "artifacts/missing-artifact-key/tiles.pmtiles",
    checksum: "missing-checksum",
    byteSize: 999,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  promoteArtifact("missing-artifact-key");
  const missingArtifact = await handleTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(missingArtifact.status, 404);
  assert.equal(missingArtifact.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(missingArtifact.headers["cache-control"], "no-store");

  setCreateObjectStore((): ObjectStore => ({
    head: async () => ({
      key: "artifacts/precondition/tiles.pmtiles",
      size: 1024,
      etag: "etag",
      contentType: "application/octet-stream",
      lastModified: new Date().toISOString(),
    }),
    getRange: async () => {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "etag changed");
    },
    putObject: async () => {
      throw new StorageError(StorageErrorCode.PRECONDITION_FAILED, "readonly");
    },
  }));
  const preconditionFailure = await handleTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(preconditionFailure.status, 409);
  assert.equal(preconditionFailure.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(preconditionFailure.headers["cache-control"], "no-store");
  setCreateObjectStore(undefined);

  if (originalActiveArtifact !== "missing-artifact-key") {
    promoteArtifact(originalActiveArtifact);
  }
  if (originalHeadEnabled === undefined) {
    delete process.env.HEAD_ENABLED;
  } else {
    process.env.HEAD_ENABLED = originalHeadEnabled;
  }
});
