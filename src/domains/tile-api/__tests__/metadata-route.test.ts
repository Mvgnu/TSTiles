import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { handleMetadataRequest } from "../tile-api.service";
import { tileMetadataRoute } from "../routes/metadata-route";
import { promoteArtifact, registerArtifact } from "../../artifact/artifact.service";
import { createObjectStore } from "../../storage/storage.service";
import { loadConfig } from "../../../config/load-config";

process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.ADMIN_TOKEN = "admin-token";
process.env.ALLOWED_ORIGINS = "https://example.com";
process.env.ALLOWED_TILES_TOKENS = "tile-token";
process.env.NODE_ENV = "development";

const fixturePmtilesPath = resolve(process.cwd(), "src/domains/tile-resolver/__fixtures__/test_fixture_1.pmtiles");

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

const originalMetadataCacheTtl = process.env.METADATA_CACHE_TTL_SECONDS;
const originalHeadEnabled = process.env.HEAD_ENABLED;

test("metadata endpoint validates path, cache headers, and auth", async (): Promise<void> => {
  const config = loadConfig(process.env);
  const store = createObjectStore(config);
  const fixtureBytes = await readFile(fixturePmtilesPath);
  await store.putObject("artifacts/artifact-a/tiles.pmtiles", fixtureBytes);
  await registerArtifact({
    id: "tile-meta-artifact-a",
    key: "artifacts/artifact-a/tiles.pmtiles",
    checksum: "dummy",
    byteSize: fixtureBytes.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await promoteArtifact("tile-meta-artifact-a");

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
    const parsed = JSON.parse(metadata.body) as {
      activeVersionId?: string;
      archiveProfile?: { minZoom?: number; maxZoom?: number; bounds?: number[] };
    };
    assert.equal(parsed.activeVersionId, "tile-meta-artifact-a");
    assert.equal(typeof parsed.archiveProfile?.minZoom, "number");
    assert.equal(typeof parsed.archiveProfile?.maxZoom, "number");
    assert.equal(Array.isArray(parsed.archiveProfile?.bounds), true);
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
    const parsedWithPrefix = JSON.parse(metadataWithPrefix.body) as {
      activeVersionId?: string;
      archiveProfile?: { minZoom?: number; maxZoom?: number };
    };
    assert.equal(parsedWithPrefix.activeVersionId, "tile-meta-artifact-a");
    assert.equal(typeof parsedWithPrefix.archiveProfile?.maxZoom, "number");
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

  const optionsUppercaseOrigin = await handleMetadataRequest({
    method: "OPTIONS",
    path: "/tiles/metadata",
    headers: {
      ORIGIN: "https://example.com",
    } as Record<string, string>,
  });
  assert.equal(optionsUppercaseOrigin.status, 204);
  assert.equal(optionsUppercaseOrigin.headers["access-control-allow-origin"], "https://example.com");

  const metadataWithPathToken = await handleMetadataRequest({
    method: "GET",
    path: "/tiles/metadata?access_token=tile-token",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(metadataWithPathToken.status, 200);
  assert.equal(metadataWithPathToken.headers["access-control-allow-origin"], "https://example.com");

  const metadataWithPathTokenAndSparseQuery = await handleMetadataRequest({
    method: "GET",
    path: "/tiles/metadata?access_token=tile-token",
    query: {
      access_token: undefined,
    },
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(metadataWithPathTokenAndSparseQuery.status, 200);
  assert.equal(metadataWithPathTokenAndSparseQuery.headers["access-control-allow-origin"], "https://example.com");

  const optionsWithPathToken = await handleMetadataRequest({
    method: "OPTIONS",
    path: "/tiles/metadata?access_token=tile-token",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(optionsWithPathToken.status, 204);
  assert.equal(optionsWithPathToken.headers["access-control-allow-origin"], "https://example.com");

  const optionsWithPathTokenAndSparseQuery = await handleMetadataRequest({
    method: "OPTIONS",
    path: "/tiles/metadata?access_token=tile-token",
    query: {
      access_token: undefined,
    },
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(optionsWithPathTokenAndSparseQuery.status, 204);
  assert.equal(optionsWithPathTokenAndSparseQuery.headers["access-control-allow-origin"], "https://example.com");

  const metadataWithMalformedArrayToken = await handleMetadataRequest({
    method: "GET",
    path: "/tiles/metadata",
    query: {
      access_token: [42 as unknown as string, "tile-token"],
    },
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(metadataWithMalformedArrayToken.status, 200);
  assert.equal(metadataWithMalformedArrayToken.headers["access-control-allow-origin"], "https://example.com");

  const metadataWithBlankLeadingArrayToken = await handleMetadataRequest({
    method: "GET",
    path: "/tiles/metadata",
    query: {
      access_token: ["   ", "tile-token"],
    },
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(metadataWithBlankLeadingArrayToken.status, 200);
  assert.equal(metadataWithBlankLeadingArrayToken.headers["access-control-allow-origin"], "https://example.com");

  const metadataWithMalformedScalarQuery = await handleMetadataRequest({
    method: "GET",
    path: "/tiles/metadata",
    query: {
      access_token: { token: "tile-token" } as unknown as string,
    },
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(metadataWithMalformedScalarQuery.status, 400);

  const optionsWithMalformedArrayToken = await handleMetadataRequest({
    method: "OPTIONS",
    path: "/tiles/metadata",
    query: {
      access_token: [42 as unknown as string, "tile-token"],
    },
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(optionsWithMalformedArrayToken.status, 204);
  assert.equal(optionsWithMalformedArrayToken.headers["access-control-allow-origin"], "https://example.com");

  const metadataOptionsWithBlankLeadingArrayToken = await handleMetadataRequest({
    method: "OPTIONS",
    path: "/tiles/metadata",
    query: {
      access_token: ["   ", "tile-token"],
    },
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(metadataOptionsWithBlankLeadingArrayToken.status, 204);
  assert.equal(metadataOptionsWithBlankLeadingArrayToken.headers["access-control-allow-origin"], "https://example.com");

  const metadataOptionsWithMalformedScalarQuery = await handleMetadataRequest({
    method: "OPTIONS",
    path: "/tiles/metadata",
    query: {
      access_token: { token: "tile-token" } as unknown as string,
    },
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(metadataOptionsWithMalformedScalarQuery.status, 400);

  const malformedRouteRequest = await tileMetadataRoute(
    null as unknown as Parameters<typeof tileMetadataRoute>[0],
  );
  assert.equal(malformedRouteRequest.status, 400);
  assert.equal(
    malformedRouteRequest.body,
    JSON.stringify({ error: "TILE_BAD_REQUEST" }),
  );

  const malformedRouteHeaders = await tileMetadataRoute({
    method: "GET",
    path: "/tiles/metadata",
    headers: {
      authorization: 42 as unknown as string,
    },
  });
  assert.equal(malformedRouteHeaders.status, 400);

  const malformedRouteQuery = await tileMetadataRoute({
    method: "GET",
    path: "/tiles/metadata",
    query: {
      access_token: [42 as unknown as string],
    },
    headers: {},
  });
  assert.equal(malformedRouteQuery.status, 400);

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
  assert.equal(optionsBadPath.body, JSON.stringify({ error: "TILE_BAD_REQUEST" }));

  const badRuntimePath = await handleMetadataRequest({
    method: "GET",
    path: { pathname: "/tiles/metadata" } as unknown as string,
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(badRuntimePath.status, 400);
  assert.equal(badRuntimePath.body, JSON.stringify({ error: "TILE_BAD_REQUEST" }));

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
  assert.equal(headDisabled.body, undefined);
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
  assert.notEqual(denied.body, undefined);

  const deniedHead = await handleMetadataRequest({
    method: "HEAD",
    path: "/tiles/metadata",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(deniedHead.status, 401);
  assert.equal(deniedHead.headers["cache-control"], "no-store");
  assert.equal(deniedHead.body, undefined);

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

  const wrongResourceHead = await handleMetadataRequest({
    method: "HEAD",
    path: "/tiles/2/2/3.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(wrongResourceHead.status, 404);
  assert.equal(wrongResourceHead.headers["cache-control"], "no-store");
  assert.equal(wrongResourceHead.body, undefined);

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

  const badMethod = await handleMetadataRequest({
    method: "POST" as unknown as "GET",
    path: "/tiles/metadata",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(badMethod.status, 400);
  assert.equal(badMethod.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(badMethod.headers["cache-control"], "no-store");
  if (typeof badMethod.body === "string") {
    const payload = JSON.parse(badMethod.body) as { error?: string };
    assert.equal(payload.error, "TILE_BAD_REQUEST");
  }
});
