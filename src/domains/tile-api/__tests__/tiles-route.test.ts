import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { handleTileRequest } from "../tile-api.service";
import { tileRoute } from "../routes/tiles-route";
import { getActiveArtifact, promoteArtifact, registerArtifact } from "../../artifact/artifact.service";
import type { TileRequest } from "../types";
import { createObjectStore, setCreateObjectStore } from "../../storage/storage.service";
import { StorageError, StorageErrorCode, type ObjectStore } from "../../storage/types";
import { loadConfig } from "../../../config/load-config";
import { createProject, rotateApiKey } from "../../projects/projects.service";

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
const fixturePath = resolve(__dirname, "../../tile-resolver/__fixtures__/test_fixture_1.pmtiles");

test("tile route handles auth/cache and returns proper responses", async (): Promise<void> => {
  const config = loadConfig(process.env);
  const store = createObjectStore(config);
  const fixture = new Uint8Array(await readFile(fixturePath));
  await store.putObject("artifacts/artifact-a/tiles.pmtiles", fixture, "application/vnd.pmtiles");
  await store.putObject("artifacts/custom-artifact-a/tiles.pmtiles", fixture, "application/vnd.pmtiles");
  await registerArtifact({
    id: "tile-route-artifact-a",
    key: "artifacts/artifact-a/tiles.pmtiles",
    checksum: "dummy",
    byteSize: fixture.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await promoteArtifact("tile-route-artifact-a");
  await registerArtifact({
    id: "tile-route-artifact-custom",
    key: "artifacts/custom-artifact-a/tiles.pmtiles",
    checksum: "custom",
    byteSize: fixture.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  });

  const activeArtifact = (await getActiveArtifact()).versionId;

  const response = await handleTileRequest({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
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
    path: "/v1/tiles/0/0/0.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(responseWithPrefix.status, 200);
  assert.equal(responseWithPrefix.headers["x-tile-cache-key"], response.headers["x-tile-cache-key"]);

  const withQuery = await handleTileRequest({
    method: "GET",
    path: "/tiles/0/0/0.mvt?abc=1",
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
    path: "/tiles/0/0/0.mvt",
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
    path: "/tiles/0/0/0.mvt",
    headers: {
      Origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(mixedOrigin.status, 200);
  assert.equal(mixedOrigin.headers["access-control-allow-origin"], "https://example.com");

  await promoteArtifact("tile-route-artifact-custom");
  const customKeyResponse = await handleTileRequest({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(customKeyResponse.status, 200);

  const head = await handleTileRequest({
    method: "HEAD",
    path: "/tiles/0/0/0.mvt",
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
    path: "/tiles/0/0/0.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(headDisabled.status, 405);
  assert.equal(headDisabled.body, undefined);
  assert.equal(headDisabled.headers["cache-control"], "no-store");

  const options = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/0/0/0.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers["access-control-allow-origin"], "https://example.com");

  const optionsWithoutAuth = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/0/0/0.mvt",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(optionsWithoutAuth.status, 204);
  assert.equal(optionsWithoutAuth.headers["access-control-allow-origin"], "https://example.com");

  const optionsUppercaseOrigin = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/0/0/0.mvt",
    headers: {
      ORIGIN: "https://example.com",
    } as Record<string, string>,
  });
  assert.equal(optionsUppercaseOrigin.status, 204);
  assert.equal(optionsUppercaseOrigin.headers["access-control-allow-origin"], "https://example.com");

  const tenantPreflightProject = await createProject({
    name: "Tenant Preflight Tile Project",
    policy: {
      allowedOrigins: ["https://tenant.example"],
    },
  });
  const tenantPreflightKey = await rotateApiKey(tenantPreflightProject.id);
  const optionsWithTenantToken = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/0/0/0.mvt",
    query: {
      access_token: tenantPreflightKey.token,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(optionsWithTenantToken.status, 204);
  assert.equal(optionsWithTenantToken.headers["access-control-allow-origin"], "https://tenant.example");
  assert.equal(
    optionsWithTenantToken.headers.vary,
    "origin,access-control-request-method,access-control-request-headers",
  );

  const getWithPathToken = await handleTileRequest({
    method: "GET",
    path: `/tiles/0/0/0.mvt?access_token=${encodeURIComponent(tenantPreflightKey.token)}`,
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(getWithPathToken.status, 200);
  assert.equal(getWithPathToken.headers["access-control-allow-origin"], "https://tenant.example");

  const getWithPathTokenAndSparseQuery = await handleTileRequest({
    method: "GET",
    path: `/tiles/0/0/0.mvt?access_token=${encodeURIComponent(tenantPreflightKey.token)}`,
    query: {
      access_token: undefined,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(getWithPathTokenAndSparseQuery.status, 200);
  assert.equal(getWithPathTokenAndSparseQuery.headers["access-control-allow-origin"], "https://tenant.example");

  const optionsWithPathToken = await handleTileRequest({
    method: "OPTIONS",
    path: `/tiles/0/0/0.mvt?access_token=${encodeURIComponent(tenantPreflightKey.token)}`,
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(optionsWithPathToken.status, 204);
  assert.equal(optionsWithPathToken.headers["access-control-allow-origin"], "https://tenant.example");

  const optionsWithPathTokenAndSparseQuery = await handleTileRequest({
    method: "OPTIONS",
    path: `/tiles/0/0/0.mvt?access_token=${encodeURIComponent(tenantPreflightKey.token)}`,
    query: {
      access_token: undefined,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(optionsWithPathTokenAndSparseQuery.status, 204);
  assert.equal(optionsWithPathTokenAndSparseQuery.headers["access-control-allow-origin"], "https://tenant.example");

  const getWithMalformedArrayToken = await handleTileRequest({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
    query: {
      access_token: [42 as unknown as string, tenantPreflightKey.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(getWithMalformedArrayToken.status, 200);
  assert.equal(getWithMalformedArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const getWithBlankLeadingArrayToken = await handleTileRequest({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
    query: {
      access_token: ["   ", tenantPreflightKey.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(getWithBlankLeadingArrayToken.status, 200);
  assert.equal(getWithBlankLeadingArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const getWithMalformedScalarQuery = await handleTileRequest({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
    query: {
      access_token: { token: tenantPreflightKey.token } as unknown as string,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(getWithMalformedScalarQuery.status, 400);

  const optionsWithMalformedArrayToken = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/0/0/0.mvt",
    query: {
      access_token: [42 as unknown as string, tenantPreflightKey.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(optionsWithMalformedArrayToken.status, 204);
  assert.equal(optionsWithMalformedArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const optionsWithBlankLeadingArrayToken = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/0/0/0.mvt",
    query: {
      access_token: ["   ", tenantPreflightKey.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(optionsWithBlankLeadingArrayToken.status, 204);
  assert.equal(optionsWithBlankLeadingArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const optionsWithMalformedScalarQuery = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/0/0/0.mvt",
    query: {
      access_token: { token: tenantPreflightKey.token } as unknown as string,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(optionsWithMalformedScalarQuery.status, 400);

  const malformedRouteRequest = await tileRoute(
    null as unknown as Parameters<typeof tileRoute>[0],
  );
  assert.equal(malformedRouteRequest.status, 400);
  assert.equal(
    new TextDecoder().decode(malformedRouteRequest.body ?? new Uint8Array()),
    JSON.stringify({ error: "TILE_BAD_REQUEST" }),
  );

  const malformedRouteHeaders = await tileRoute({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
    headers: {
      authorization: 42 as unknown as string,
    },
  });
  assert.equal(malformedRouteHeaders.status, 400);

  const malformedRouteQuery = await tileRoute({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
    query: {
      access_token: [42 as unknown as string],
    },
    headers: {},
  });
  assert.equal(malformedRouteQuery.status, 400);

  const optionsBadPath = await handleTileRequest({
    method: "OPTIONS",
    path: "/tiles/bad",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(optionsBadPath.status, 400);
  assert.equal(optionsBadPath.headers["access-control-allow-origin"], "https://example.com");

  const badRuntimePath = await handleTileRequest({
    method: "GET",
    path: 123 as unknown as string,
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(badRuntimePath.status, 400);
  assert.equal(new TextDecoder().decode(badRuntimePath.body ?? new Uint8Array()), JSON.stringify({ error: "TILE_BAD_REQUEST" }));
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
    path: "/tiles/0/0/0.mvt",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers["cache-control"], "no-store");
  assert.notEqual(denied.body, undefined);

  process.env.HEAD_ENABLED = "true";
  const deniedHead = await handleTileRequest({
    method: "HEAD",
    path: "/tiles/0/0/0.mvt",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(deniedHead.status, 401);
  assert.equal(deniedHead.headers["cache-control"], "no-store");
  assert.equal(deniedHead.body, undefined);

  const originDenied = await handleTileRequest({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
    headers: {
      origin: "https://other.example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(originDenied.status, 403);
  assert.equal(originDenied.headers["cache-control"], "no-store");

  const badMethod = await handleTileRequest({
    method: "POST",
    path: "/tiles/0/0/0.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  } as unknown as TileRequest);
  assert.equal(badMethod.status, 400);
  assert.equal(badMethod.headers["cache-control"], "no-store");

  const originalActiveArtifact = activeArtifact;
  await registerArtifact({
    id: "missing-artifact-key",
    key: "artifacts/missing-artifact-key/tiles.pmtiles",
    checksum: "missing-checksum",
    byteSize: 999,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await promoteArtifact("missing-artifact-key");
  const missingArtifact = await handleTileRequest({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(missingArtifact.status, 404);
  assert.equal(missingArtifact.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(missingArtifact.headers["cache-control"], "no-store");

  const tenantProject = await createProject({
    name: "Tenant Tile Project",
    policy: {
      allowedOrigins: ["https://tenant.example"],
    },
  });
  const tenantKey = await rotateApiKey(tenantProject.id);
  await registerArtifact({
    id: "tenant-missing-artifact-key",
    key: "artifacts/tenant-missing-artifact-key/tiles.pmtiles",
    checksum: "tenant-missing-checksum",
    byteSize: 1000,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await promoteArtifact("tenant-missing-artifact-key");
  const tenantScopedFailure = await handleTileRequest({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
    headers: {
      origin: "https://tenant.example",
      authorization: tenantKey.token,
    },
  });
  assert.equal(tenantScopedFailure.status, 404);
  assert.equal(tenantScopedFailure.headers["cache-control"], "no-store");
  assert.equal(tenantScopedFailure.headers["access-control-allow-origin"], "https://tenant.example");

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
  await registerArtifact({
    id: "precondition-artifact",
    key: "artifacts/precondition/tiles.pmtiles",
    checksum: "precondition-checksum",
    byteSize: fixture.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await promoteArtifact("precondition-artifact");
  const preconditionFailure = await handleTileRequest({
    method: "GET",
    path: "/tiles/0/0/0.mvt",
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
    await promoteArtifact(originalActiveArtifact);
  }
  if (originalHeadEnabled === undefined) {
    delete process.env.HEAD_ENABLED;
  } else {
    process.env.HEAD_ENABLED = originalHeadEnabled;
  }
});
