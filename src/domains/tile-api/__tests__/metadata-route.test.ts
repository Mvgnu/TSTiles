import { strict as assert } from "node:assert";
import { handleMetadataRequest } from "../tile-api.service";
import { promoteArtifact, registerArtifact } from "../../artifact/artifact.service";
import { createObjectStore } from "../../storage/storage.service";
import { loadConfig } from "../../../config/load-config";

process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.ADMIN_TOKEN = "admin-token";
process.env.ALLOWED_ORIGINS = "https://example.com";
process.env.ALLOWED_TILES_TOKENS = "tile-token";
process.env.NODE_ENV = "development";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

const originalMetadataCacheTtl = process.env.METADATA_CACHE_TTL_SECONDS;
const originalHeadEnabled = process.env.HEAD_ENABLED;

test("metadata endpoint validates path, cache headers, and auth", async (): Promise<void> => {
  const config = loadConfig(process.env);
  const store = createObjectStore(config);
  await store.putObject("artifacts/artifact-a/tiles.pmtiles", new TextEncoder().encode("artifact-bytes"));
  registerArtifact({
    id: "artifact-a",
    key: "artifacts/artifact-a/tiles.pmtiles",
    checksum: "dummy",
    byteSize: 13,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  promoteArtifact("artifact-a");

  const metadata = await handleMetadataRequest({
    method: "GET",
    path: "/tiles/metadata",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(metadata.status, 200);
  assert.equal(typeof metadata.body, "string");
  if (typeof metadata.body === "string") {
    const parsed = JSON.parse(metadata.body) as { activeVersionId?: string };
  assert.equal(parsed.activeVersionId, "artifact-a");
    const size = new TextEncoder().encode(metadata.body).byteLength;
    assert.equal(metadata.headers["content-length"], String(size));
  }
  assert.equal(metadata.headers["cache-control"], "public, max-age=120");
  assert.equal(metadata.headers["etag"], "dummy");

  const metadataWithPrefix = await handleMetadataRequest({
    method: "GET",
    path: "/v1/tiles/metadata",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(metadataWithPrefix.status, 200);
  assert.equal(typeof metadataWithPrefix.body, "string");
  if (typeof metadataWithPrefix.body === "string") {
    const parsedWithPrefix = JSON.parse(metadataWithPrefix.body) as { activeVersionId?: string };
    assert.equal(parsedWithPrefix.activeVersionId, "artifact-a");
  }

  const options = await handleMetadataRequest({
    method: "OPTIONS",
    path: "/tiles/metadata",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers["access-control-allow-origin"], "https://example.com");

  const optionsWithoutAuth = await handleMetadataRequest({
    method: "OPTIONS",
    path: "/tiles/metadata",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(optionsWithoutAuth.status, 204);
  assert.equal(optionsWithoutAuth.headers["access-control-allow-origin"], "https://example.com");

  const optionsBadPath = await handleMetadataRequest({
    method: "OPTIONS",
    path: "/tiles/metadata/bad",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(optionsBadPath.status, 400);
  assert.equal(optionsBadPath.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(optionsBadPath.headers["cache-control"], "no-store");

  const head = await handleMetadataRequest({
    method: "HEAD",
    path: "/tiles/metadata",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers["cache-control"], "public, max-age=120");
  assert.equal(head.headers["etag"], metadata.headers["etag"]);
  assert.equal(head.headers["content-length"], metadata.headers["content-length"]);

  process.env.HEAD_ENABLED = "false";
  const headDisabled = await handleMetadataRequest({
    method: "HEAD",
    path: "/tiles/metadata",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(headDisabled.status, 405);
  assert.equal(headDisabled.body !== undefined, true);
  assert.equal(headDisabled.headers["cache-control"], "no-store");

  process.env.METADATA_CACHE_TTL_SECONDS = "45";
  const metadataWithDifferentCache = await handleMetadataRequest({
    method: "GET",
    path: "/tiles/metadata",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(metadataWithDifferentCache.status, 200);
  assert.equal(metadataWithDifferentCache.headers["cache-control"], "public, max-age=45");
  if (originalMetadataCacheTtl === undefined) {
    delete process.env.METADATA_CACHE_TTL_SECONDS;
  } else {
    process.env.METADATA_CACHE_TTL_SECONDS = originalMetadataCacheTtl;
  }
  if (originalHeadEnabled === undefined) {
    delete process.env.HEAD_ENABLED;
  } else {
    process.env.HEAD_ENABLED = originalHeadEnabled;
  }

  const denied = await handleMetadataRequest({
    method: "GET",
    path: "/tiles/metadata",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers["cache-control"], "no-store");

  const wrongResource = await handleMetadataRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(wrongResource.status, 404);
  assert.equal(wrongResource.headers["cache-control"], "no-store");
  if (typeof wrongResource.body === "string") {
    const payload = JSON.parse(wrongResource.body) as { error?: string };
    assert.equal(payload.error, "TILE_NOT_FOUND");
  }

  const badPath = await handleMetadataRequest({
    method: "GET",
    path: "/tiles/metadata/bad",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(badPath.status, 400);
  assert.equal(badPath.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(badPath.headers["cache-control"], "no-store");
});
