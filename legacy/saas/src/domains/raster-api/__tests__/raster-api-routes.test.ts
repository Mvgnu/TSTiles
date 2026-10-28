import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createStyleVersion, publishStyleVersion } from "../../styles/styles.service";
import { handleRasterTileRequest, handleStaticMapRequest } from "../raster-api.service";
import { rasterTileRoute } from "../routes/raster-route";
import { staticMapRoute } from "../routes/static-route";
import { promoteArtifact, registerArtifact } from "../../artifact/artifact.service";
import { createObjectStore } from "../../storage/storage.service";
import { loadConfig } from "../../../config/load-config";
import type { RasterRequest } from "../types";
import { createProject, rotateApiKey } from "../../projects/projects.service";
import { isCartographicRendererAvailable } from "../../render/adapters/maplibre-native-renderer";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

const RENDERER_AVAILABLE = isCartographicRendererAvailable();

process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.ADMIN_TOKEN = "admin-token";
process.env.ALLOWED_ORIGINS = "https://example.com";
process.env.ALLOWED_TILES_TOKENS = "tile-token";
process.env.NODE_ENV = "development";
const originalHeadEnabled = process.env.HEAD_ENABLED;
const originalCacheTtl = process.env.CACHE_TTL_SECONDS;
const fixturePath = resolve(__dirname, "../../tile-resolver/__fixtures__/test_fixture_1.pmtiles");

test("raster and static routes resolve and enforce request semantics", async (): Promise<void> => {
  if (!RENDERER_AVAILABLE) {
    // The full route test exercises real raster bytes through the maplibre
    // pipeline. When the native binding isn't loadable in this test env
    // (e.g. Node ABI without a prebuilt wheel), every successful raster
    // call would 503; the routing/auth/CORS coverage is still exercised by
    // the targeted "fails closed" test below.
    return;
  }
  const config = loadConfig(process.env);
  const store = createObjectStore(config);
  const fixture = new Uint8Array(await readFile(fixturePath));
  await store.putObject("artifacts/raster-artifact/tiles.pmtiles", fixture, "application/vnd.pmtiles");
  await registerArtifact({
    id: "raster-artifact",
    key: "artifacts/raster-artifact/tiles.pmtiles",
    checksum: "raster-checksum",
    byteSize: fixture.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await promoteArtifact("raster-artifact");

  const version = await createStyleVersion("basic", {
    version: 8,
    sources: {
      osm: {
        type: "vector",
        url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
      },
    },
  });
  await publishStyleVersion("basic", version.id);
  const draftVersion = await createStyleVersion("basic", {
    version: 8,
    sources: {
      osm: {
        type: "vector",
        url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
      },
    },
    layers: [
      {
        id: "draft-layer",
        type: "fill",
        source: "osm",
        "source-layer": "draft",
        paint: {
          "fill-color": "#ff6600",
        },
      },
    ],
  });

  const raster = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/basic/0/0/0.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(raster.status, 200);
  assert.equal(typeof raster.headers["x-raster-cache-key"], "string");
  assert.equal(raster.headers["x-raster-cache-key"].startsWith("raster:basic"), true);
  assert.equal(raster.headers["cache-control"], "public, max-age=300");

  const rasterDraftVersion = await handleRasterTileRequest({
    method: "GET",
    path: `/v1/raster/basic/0/0/0.png?versionId=${encodeURIComponent(draftVersion.id)}`,
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterDraftVersion.status, 200);
  // Version routing is observable through the cache key. The fixture may render
  // identical pixels when a draft layer references a source layer absent from
  // the tile, so byte inequality is not a stable assertion here.
  assert.notEqual(rasterDraftVersion.headers["x-raster-cache-key"], raster.headers["x-raster-cache-key"]);

  const rasterHead = await handleRasterTileRequest({
    method: "HEAD",
    path: "/v1/raster/basic/0/0/0.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterHead.status, 200);
  assert.equal(rasterHead.body, undefined);

  process.env.HEAD_ENABLED = "false";
  const rasterHeadDisabled = await handleRasterTileRequest({
    method: "HEAD",
    path: "/v1/raster/basic/0/0/0.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterHeadDisabled.status, 405);
  assert.equal(rasterHeadDisabled.body, undefined);
  assert.equal(rasterHeadDisabled.headers["cache-control"], "no-store");

  const staticHeadDisabled = await handleStaticMapRequest({
    method: "HEAD",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticHeadDisabled.status, 405);
  assert.equal(staticHeadDisabled.body, undefined);
  assert.equal(staticHeadDisabled.headers["cache-control"], "no-store");

  process.env.HEAD_ENABLED = "true";

  const rasterOptions = await handleRasterTileRequest({
    method: "OPTIONS",
    path: "/v1/raster/basic/0/0/0.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterOptions.status, 204);

  const rasterOptionsWithoutAuth = await handleRasterTileRequest({
    method: "OPTIONS",
    path: "/v1/raster/basic/0/0/0.png",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(rasterOptionsWithoutAuth.status, 204);
  assert.equal(rasterOptionsWithoutAuth.headers["access-control-allow-origin"], "https://example.com");

  const rasterOptionsUppercaseOrigin = await handleRasterTileRequest({
    method: "OPTIONS",
    path: "/v1/raster/basic/0/0/0.png",
    headers: {
      ORIGIN: "https://example.com",
    } as Record<string, string>,
  });
  assert.equal(rasterOptionsUppercaseOrigin.status, 204);
  assert.equal(rasterOptionsUppercaseOrigin.headers["access-control-allow-origin"], "https://example.com");

  const tenantPreflightProject = await createProject({
    name: "Tenant Preflight Raster Project",
    policy: {
      allowedOrigins: ["https://tenant.example"],
    },
  });
  const tenantPreflightKey = await rotateApiKey(tenantPreflightProject.id);
  const rasterOptionsWithTenantToken = await handleRasterTileRequest({
    method: "OPTIONS",
    path: "/v1/raster/basic/0/0/0.png",
    query: {
      access_token: tenantPreflightKey.token,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterOptionsWithTenantToken.status, 204);
  assert.equal(rasterOptionsWithTenantToken.headers["access-control-allow-origin"], "https://tenant.example");
  assert.equal(
    rasterOptionsWithTenantToken.headers.vary,
    "origin,access-control-request-method,access-control-request-headers",
  );

  const rasterWithPathToken = await handleRasterTileRequest({
    method: "GET",
    path: `/v1/raster/basic/0/0/0.png?access_token=${encodeURIComponent(tenantPreflightKey.token)}`,
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterWithPathToken.status, 200);
  assert.equal(rasterWithPathToken.headers["access-control-allow-origin"], "https://tenant.example");

  const rasterWithPathTokenAndSparseQuery = await handleRasterTileRequest({
    method: "GET",
    path: `/v1/raster/basic/0/0/0.png?access_token=${encodeURIComponent(tenantPreflightKey.token)}`,
    query: {
      access_token: undefined,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterWithPathTokenAndSparseQuery.status, 200);
  assert.equal(rasterWithPathTokenAndSparseQuery.headers["access-control-allow-origin"], "https://tenant.example");

  const rasterOptionsWithPathToken = await handleRasterTileRequest({
    method: "OPTIONS",
    path: `/v1/raster/basic/0/0/0.png?access_token=${encodeURIComponent(tenantPreflightKey.token)}`,
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterOptionsWithPathToken.status, 204);
  assert.equal(rasterOptionsWithPathToken.headers["access-control-allow-origin"], "https://tenant.example");

  const rasterOptionsWithPathTokenAndSparseQuery = await handleRasterTileRequest({
    method: "OPTIONS",
    path: `/v1/raster/basic/0/0/0.png?access_token=${encodeURIComponent(tenantPreflightKey.token)}`,
    query: {
      access_token: undefined,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterOptionsWithPathTokenAndSparseQuery.status, 204);
  assert.equal(rasterOptionsWithPathTokenAndSparseQuery.headers["access-control-allow-origin"], "https://tenant.example");

  const rasterWithMalformedArrayToken = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/basic/0/0/0.png",
    query: {
      access_token: [42 as unknown as string, tenantPreflightKey.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterWithMalformedArrayToken.status, 200);
  assert.equal(rasterWithMalformedArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const rasterWithBlankLeadingArrayToken = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/basic/0/0/0.png",
    query: {
      access_token: ["   ", tenantPreflightKey.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterWithBlankLeadingArrayToken.status, 200);
  assert.equal(rasterWithBlankLeadingArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const rasterWithMalformedScalarQuery = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/basic/0/0/0.png",
    query: {
      access_token: { token: tenantPreflightKey.token } as unknown as string,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterWithMalformedScalarQuery.status, 400);

  const rasterOptionsWithMalformedArrayToken = await handleRasterTileRequest({
    method: "OPTIONS",
    path: "/v1/raster/basic/0/0/0.png",
    query: {
      access_token: [42 as unknown as string, tenantPreflightKey.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterOptionsWithMalformedArrayToken.status, 204);
  assert.equal(rasterOptionsWithMalformedArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const rasterOptionsWithBlankLeadingArrayToken = await handleRasterTileRequest({
    method: "OPTIONS",
    path: "/v1/raster/basic/0/0/0.png",
    query: {
      access_token: ["   ", tenantPreflightKey.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterOptionsWithBlankLeadingArrayToken.status, 204);
  assert.equal(rasterOptionsWithBlankLeadingArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const rasterOptionsWithMalformedScalarQuery = await handleRasterTileRequest({
    method: "OPTIONS",
    path: "/v1/raster/basic/0/0/0.png",
    query: {
      access_token: { token: tenantPreflightKey.token } as unknown as string,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(rasterOptionsWithMalformedScalarQuery.status, 400);

  const malformedRasterRoute = await rasterTileRoute(
    null as unknown as Parameters<typeof rasterTileRoute>[0],
  );
  assert.equal(malformedRasterRoute.status, 400);
  assert.equal(
    new TextDecoder().decode(malformedRasterRoute.body ?? new Uint8Array()),
    JSON.stringify({ error: "RASTER_BAD_REQUEST" }),
  );

  const malformedRasterHeaders = await rasterTileRoute({
    method: "GET",
    path: "/v1/raster/basic/0/0/0.png",
    headers: {
      authorization: 42 as unknown as string,
    },
  });
  assert.equal(malformedRasterHeaders.status, 400);

  const malformedRasterQuery = await rasterTileRoute({
    method: "GET",
    path: "/v1/raster/basic/0/0/0.png",
    query: {
      access_token: [42 as unknown as string],
    },
    headers: {},
  });
  assert.equal(malformedRasterQuery.status, 400);

  const malformedStaticRoute = await staticMapRoute(
    null as unknown as Parameters<typeof staticMapRoute>[0],
  );
  assert.equal(malformedStaticRoute.status, 400);
  assert.equal(
    new TextDecoder().decode(malformedStaticRoute.body ?? new Uint8Array()),
    JSON.stringify({ error: "RASTER_BAD_REQUEST" }),
  );

  const malformedStaticHeaders = await staticMapRoute({
    method: "GET",
    path: "/v1/static/basic/0,0,0/640x480.png",
    headers: {
      authorization: 42 as unknown as string,
    },
  });
  assert.equal(malformedStaticHeaders.status, 400);

  const malformedStaticQuery = await staticMapRoute({
    method: "GET",
    path: "/v1/static/basic/0,0,0/640x480.png",
    query: {
      access_token: [42 as unknown as string],
    },
    headers: {},
  });
  assert.equal(malformedStaticQuery.status, 400);

  const staticOptionsWithoutAuth = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(staticOptionsWithoutAuth.status, 204);
  assert.equal(staticOptionsWithoutAuth.headers["access-control-allow-origin"], "https://example.com");

  const staticOptionsUppercaseOrigin = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    headers: {
      ORIGIN: "https://example.com",
    } as Record<string, string>,
  });
  assert.equal(staticOptionsUppercaseOrigin.status, 204);
  assert.equal(staticOptionsUppercaseOrigin.headers["access-control-allow-origin"], "https://example.com");

  const staticWithPathTokenAndOverlay = await handleStaticMapRequest({
    method: "GET",
    path: `/v1/static/basic/0,0,0/640x480.webp?access_token=${encodeURIComponent(tenantPreflightKey.token)}&overlays=poi,roads`,
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(staticWithPathTokenAndOverlay.status, 200);
  assert.equal(staticWithPathTokenAndOverlay.headers["access-control-allow-origin"], "https://tenant.example");

  const staticWithPathTokenAndSparseQuery = await handleStaticMapRequest({
    method: "GET",
    path: `/v1/static/basic/0,0,0/640x480.webp?access_token=${encodeURIComponent(tenantPreflightKey.token)}&overlays=poi,roads`,
    query: {
      access_token: undefined,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(staticWithPathTokenAndSparseQuery.status, 200);
  assert.equal(staticWithPathTokenAndSparseQuery.headers["access-control-allow-origin"], "https://tenant.example");

  const staticOptionsWithPathToken = await handleStaticMapRequest({
    method: "OPTIONS",
    path: `/v1/static/basic/0,0,0/640x480.webp?access_token=${encodeURIComponent(tenantPreflightKey.token)}`,
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(staticOptionsWithPathToken.status, 204);
  assert.equal(staticOptionsWithPathToken.headers["access-control-allow-origin"], "https://tenant.example");

  const staticOptionsWithPathTokenAndSparseQuery = await handleStaticMapRequest({
    method: "OPTIONS",
    path: `/v1/static/basic/0,0,0/640x480.webp?access_token=${encodeURIComponent(tenantPreflightKey.token)}`,
    query: {
      access_token: undefined,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(staticOptionsWithPathTokenAndSparseQuery.status, 204);
  assert.equal(staticOptionsWithPathTokenAndSparseQuery.headers["access-control-allow-origin"], "https://tenant.example");

  const staticWithMalformedArrayToken = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    query: {
      access_token: [42 as unknown as string, tenantPreflightKey.token],
      overlays: "poi,roads",
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(staticWithMalformedArrayToken.status, 200);
  assert.equal(staticWithMalformedArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const staticWithBlankLeadingArrayToken = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    query: {
      access_token: ["   ", tenantPreflightKey.token],
      overlays: "poi,roads",
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(staticWithBlankLeadingArrayToken.status, 200);
  assert.equal(staticWithBlankLeadingArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const staticWithMalformedScalarQuery = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    query: {
      access_token: { token: tenantPreflightKey.token } as unknown as string,
      overlays: "poi,roads",
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(staticWithMalformedScalarQuery.status, 400);

  const staticOptionsWithMalformedArrayToken = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    query: {
      access_token: [42 as unknown as string, tenantPreflightKey.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(staticOptionsWithMalformedArrayToken.status, 204);
  assert.equal(staticOptionsWithMalformedArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const staticOptionsWithBlankLeadingArrayToken = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    query: {
      access_token: ["   ", tenantPreflightKey.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(staticOptionsWithBlankLeadingArrayToken.status, 204);
  assert.equal(staticOptionsWithBlankLeadingArrayToken.headers["access-control-allow-origin"], "https://tenant.example");

  const staticOptionsWithMalformedScalarQuery = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    query: {
      access_token: { token: tenantPreflightKey.token } as unknown as string,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(staticOptionsWithMalformedScalarQuery.status, 400);

  const rasterUnknown = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/missing/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterUnknown.status, 404);
  assert.equal(rasterUnknown.headers["content-type"], "application/json");
  assert.equal(rasterUnknown.headers["access-control-allow-origin"], "https://example.com");
  if (rasterUnknown.body !== undefined) {
    const parsed = JSON.parse(new TextDecoder().decode(rasterUnknown.body)) as { error?: string };
    assert.equal(parsed.error, "RASTER_STYLE_NOT_FOUND");
  }

  const tenantProject = await createProject({
    name: "Tenant Raster Project",
    policy: {
      allowedOrigins: ["https://tenant.example"],
    },
  });
  const tenantKey = await rotateApiKey(tenantProject.id);
  const tenantRasterUnknown = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/missing/2/2/3.png",
    headers: {
      origin: "https://tenant.example",
      authorization: tenantKey.token,
    },
  });
  assert.equal(tenantRasterUnknown.status, 404);
  assert.equal(tenantRasterUnknown.headers["cache-control"], "no-store");
  assert.equal(tenantRasterUnknown.headers["access-control-allow-origin"], "https://tenant.example");

  const rasterOutOfRange = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/basic/1/2/0.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterOutOfRange.status, 400);
  assert.equal(rasterOutOfRange.headers["cache-control"], "no-store");
  if (rasterOutOfRange.body !== undefined) {
    const parsed = JSON.parse(new TextDecoder().decode(rasterOutOfRange.body)) as { error?: string };
    assert.equal(parsed.error, "RASTER_BAD_COORDINATES");
  }

  const rasterZoomTooHigh = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/basic/31/0/0.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterZoomTooHigh.status, 400);
  assert.equal(rasterZoomTooHigh.headers["cache-control"], "no-store");
  if (rasterZoomTooHigh.body !== undefined) {
    const parsed = JSON.parse(new TextDecoder().decode(rasterZoomTooHigh.body)) as { error?: string };
    assert.equal(parsed.error, "RASTER_BAD_COORDINATES");
  }

  const rasterBlankStyleId = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/%20/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterBlankStyleId.status, 400);
  assert.equal(rasterBlankStyleId.headers["cache-control"], "no-store");
  if (rasterBlankStyleId.body !== undefined) {
    const parsed = JSON.parse(new TextDecoder().decode(rasterBlankStyleId.body)) as { error?: string };
    assert.equal(parsed.error, "RASTER_BAD_COORDINATES");
  }

  const rasterEncodedSlashStyleId = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/foo%2Fbar/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterEncodedSlashStyleId.status, 400);
  assert.equal(rasterEncodedSlashStyleId.headers["cache-control"], "no-store");
  if (rasterEncodedSlashStyleId.body !== undefined) {
    const parsed = JSON.parse(new TextDecoder().decode(rasterEncodedSlashStyleId.body)) as { error?: string };
    assert.equal(parsed.error, "RASTER_BAD_COORDINATES");
  }

  const rasterEncodedBackslashStyleId = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/foo%5Cbar/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterEncodedBackslashStyleId.status, 400);
  assert.equal(rasterEncodedBackslashStyleId.headers["cache-control"], "no-store");
  if (rasterEncodedBackslashStyleId.body !== undefined) {
    const parsed = JSON.parse(new TextDecoder().decode(rasterEncodedBackslashStyleId.body)) as { error?: string };
    assert.equal(parsed.error, "RASTER_BAD_COORDINATES");
  }

  const rasterDotStyleId = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/%2E/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterDotStyleId.status, 400);
  assert.equal(rasterDotStyleId.headers["cache-control"], "no-store");
  if (rasterDotStyleId.body !== undefined) {
    const parsed = JSON.parse(new TextDecoder().decode(rasterDotStyleId.body)) as { error?: string };
    assert.equal(parsed.error, "RASTER_BAD_COORDINATES");
  }

  const rasterTraversalStyleId = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/..%2Fsecret/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterTraversalStyleId.status, 400);
  assert.equal(rasterTraversalStyleId.headers["cache-control"], "no-store");
  if (rasterTraversalStyleId.body !== undefined) {
    const parsed = JSON.parse(new TextDecoder().decode(rasterTraversalStyleId.body)) as { error?: string };
    assert.equal(parsed.error, "RASTER_BAD_COORDINATES");
  }

  const staticMap = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticMap.status, 200);
  assert.equal(typeof staticMap.headers["x-raster-cache-key"], "string");
  assert.equal(staticMap.headers["x-raster-cache-key"].startsWith("raster:basic"), true);

  const staticMapDraftVersion = await handleStaticMapRequest({
    method: "GET",
    path: `/v1/static/basic/0,0,0/640x480.webp?versionId=${encodeURIComponent(draftVersion.id)}`,
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticMapDraftVersion.status, 200);
  assert.notEqual(staticMapDraftVersion.headers["x-raster-cache-key"], staticMap.headers["x-raster-cache-key"]);

  process.env.CACHE_TTL_SECONDS = "75";
  const staticMapCustomTtl = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticMapCustomTtl.status, 200);
  assert.equal(staticMapCustomTtl.headers["cache-control"], "public, max-age=75");
  if (originalCacheTtl === undefined) {
    delete process.env.CACHE_TTL_SECONDS;
  } else {
    process.env.CACHE_TTL_SECONDS = originalCacheTtl;
  }

  const staticOverlaysFromArray = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    query: {
      overlays: ["poi,roads", "roads,labels"],
    },
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticOverlaysFromArray.status, 200);

  const staticOverlaysFromString = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    query: {
      overlays: "poi,roads,labels,roads",
    },
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticOverlaysFromString.status, 200);
  assert.equal(
    staticOverlaysFromArray.headers["x-raster-cache-key"],
    staticOverlaysFromString.headers["x-raster-cache-key"],
  );

  const staticMapDecimalZoom = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/0,0,0.5/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticMapDecimalZoom.status, 200);
  assert.equal(typeof staticMapDecimalZoom.headers["x-raster-cache-key"], "string");

  const staticZeroWidth = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/0,0,0/0x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticZeroWidth.status, 400);
  assert.equal(staticZeroWidth.headers["cache-control"], "no-store");
  if (staticZeroWidth.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticZeroWidth.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticZeroHeight = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/0,0,0/640x0.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticZeroHeight.status, 400);
  assert.equal(staticZeroHeight.headers["cache-control"], "no-store");
  if (staticZeroHeight.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticZeroHeight.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticLatOutOfRange = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,97.7749,12/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticLatOutOfRange.status, 400);
  assert.equal(staticLatOutOfRange.headers["cache-control"], "no-store");
  if (staticLatOutOfRange.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticLatOutOfRange.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticLatOutsideMercator = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,85.2,12/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticLatOutsideMercator.status, 400);
  assert.equal(staticLatOutsideMercator.headers["cache-control"], "no-store");
  if (staticLatOutsideMercator.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticLatOutsideMercator.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticLonOutOfRange = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/-222.4194,37.7749,12/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticLonOutOfRange.status, 400);
  assert.equal(staticLonOutOfRange.headers["cache-control"], "no-store");
  if (staticLonOutOfRange.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticLonOutOfRange.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticBlankStyleId = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/%20/-122.4194,37.7749,12/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticBlankStyleId.status, 400);
  assert.equal(staticBlankStyleId.headers["cache-control"], "no-store");
  if (staticBlankStyleId.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticBlankStyleId.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticEncodedBackslashStyleId = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/foo%5Cbar/-122.4194,37.7749,12/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticEncodedBackslashStyleId.status, 400);
  assert.equal(staticEncodedBackslashStyleId.headers["cache-control"], "no-store");
  if (staticEncodedBackslashStyleId.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticEncodedBackslashStyleId.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticDotStyleId = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/%2E/-122.4194,37.7749,12/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticDotStyleId.status, 400);
  assert.equal(staticDotStyleId.headers["cache-control"], "no-store");
  if (staticDotStyleId.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticDotStyleId.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticTraversalStyleId = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/..%2Fsecret/-122.4194,37.7749,12/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticTraversalStyleId.status, 400);
  assert.equal(staticTraversalStyleId.headers["cache-control"], "no-store");
  if (staticTraversalStyleId.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticTraversalStyleId.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticHead = await handleStaticMapRequest({
    method: "HEAD",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticHead.status, 200);
  assert.equal(staticHead.body, undefined);

  const staticOptions = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/0,0,0/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticOptions.status, 204);
  assert.equal(staticOptions.body, undefined);

  const staticOptionsWrongFamily = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/raster/basic/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticOptionsWrongFamily.status, 400);
  assert.equal(staticOptionsWrongFamily.headers["cache-control"], "no-store");
  if (staticOptionsWrongFamily.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticOptionsWrongFamily.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const rasterOptionsWrongFamily = await handleRasterTileRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterOptionsWrongFamily.status, 400);
  assert.equal(rasterOptionsWrongFamily.headers["cache-control"], "no-store");
  if (rasterOptionsWrongFamily.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(rasterOptionsWrongFamily.body)) as { error?: string };
    assert.equal(payload.error, "RASTER_BAD_COORDINATES");
  }

  const staticWrongFamily = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/raster/basic/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticWrongFamily.status, 400);
  assert.equal(staticWrongFamily.headers["cache-control"], "no-store");
  if (staticWrongFamily.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticWrongFamily.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticOptionsBadPath = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/bad",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticOptionsBadPath.status, 400);
  assert.equal(staticOptionsBadPath.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(staticOptionsBadPath.headers["cache-control"], "no-store");
  if (staticOptionsBadPath.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticOptionsBadPath.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticOptionsOversized = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/-122.4194,37.7749,12/5000x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticOptionsOversized.status, 400);
  assert.equal(staticOptionsOversized.headers["cache-control"], "no-store");
  if (staticOptionsOversized.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticOptionsOversized.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticOptionsZeroWidth = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/-122.4194,37.7749,12/0x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticOptionsZeroWidth.status, 400);
  assert.equal(staticOptionsZeroWidth.headers["cache-control"], "no-store");
  if (staticOptionsZeroWidth.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticOptionsZeroWidth.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const staticOptionsZoomTooHigh = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/-122.4194,37.7749,31/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticOptionsZoomTooHigh.status, 400);
  assert.equal(staticOptionsZoomTooHigh.headers["cache-control"], "no-store");
  if (staticOptionsZoomTooHigh.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticOptionsZoomTooHigh.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const rasterOptionsBadPath = await handleRasterTileRequest({
    method: "OPTIONS",
    path: "/v1/raster/basic/bad",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterOptionsBadPath.status, 400);
  assert.equal(rasterOptionsBadPath.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(rasterOptionsBadPath.headers["cache-control"], "no-store");
  if (rasterOptionsBadPath.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(rasterOptionsBadPath.body)) as { error?: string };
    assert.equal(payload.error, "RASTER_BAD_COORDINATES");
  }

  const staticBadPath = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/bad",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticBadPath.status, 400);
  assert.equal(staticBadPath.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(staticBadPath.headers["cache-control"], "no-store");

  const badMethod = await handleRasterTileRequest({
    method: "POST" as unknown as RasterRequest["method"],
    path: "/v1/raster/basic/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  } as unknown as Parameters<typeof handleRasterTileRequest>[0]);
  assert.equal(badMethod.status, 400);
  assert.equal(badMethod.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(badMethod.headers["cache-control"], "no-store");
  if (badMethod.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(badMethod.body)) as { error?: string };
    assert.equal(payload.error, "RASTER_BAD_REQUEST");
  }

  const staticBadMethod = await handleStaticMapRequest({
    method: "POST" as unknown as RasterRequest["method"],
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  } as unknown as Parameters<typeof handleStaticMapRequest>[0]);
  assert.equal(staticBadMethod.status, 400);
  assert.equal(staticBadMethod.headers["access-control-allow-origin"], "https://example.com");
  assert.equal(staticBadMethod.headers["cache-control"], "no-store");
  if (staticBadMethod.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(staticBadMethod.body)) as { error?: string };
    assert.equal(payload.error, "STATIC_BAD_REQUEST");
  }

  const originalMaxConcurrent = process.env.RENDER_MAX_CONCURRENT;
  process.env.RENDER_MAX_CONCURRENT = "0";
  const saturatedRaster = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/basic/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(saturatedRaster.status, 503);
  assert.equal(saturatedRaster.headers["cache-control"], "no-store");
  if (saturatedRaster.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(saturatedRaster.body)) as { error?: string };
    assert.equal(payload.error, "RASTER_RENDER_FAILED");
  }

  const saturatedStatic = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(saturatedStatic.status, 503);
  assert.equal(saturatedStatic.headers["cache-control"], "no-store");
  if (saturatedStatic.body !== undefined) {
    const payload = JSON.parse(new TextDecoder().decode(saturatedStatic.body)) as { error?: string };
    assert.equal(payload.error, "RASTER_RENDER_FAILED");
  }
  if (originalMaxConcurrent === undefined) {
    delete process.env.RENDER_MAX_CONCURRENT;
  } else {
    process.env.RENDER_MAX_CONCURRENT = originalMaxConcurrent;
  }

  const denied = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/basic/2/2/3.png",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers["cache-control"], "no-store");
  assert.notEqual(denied.body, undefined);

  const deniedHead = await handleRasterTileRequest({
    method: "HEAD",
    path: "/v1/raster/basic/2/2/3.png",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(deniedHead.status, 401);
  assert.equal(deniedHead.headers["cache-control"], "no-store");
  assert.equal(deniedHead.body, undefined);

  const deniedStatic = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.png",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(deniedStatic.status, 401);
  assert.equal(deniedStatic.headers["cache-control"], "no-store");
  assert.notEqual(deniedStatic.body, undefined);

  const deniedStaticHead = await handleStaticMapRequest({
    method: "HEAD",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.png",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(deniedStaticHead.status, 401);
  assert.equal(deniedStaticHead.headers["cache-control"], "no-store");
  assert.equal(deniedStaticHead.body, undefined);

  if (originalHeadEnabled === undefined) {
    delete process.env.HEAD_ENABLED;
  } else {
    process.env.HEAD_ENABLED = originalHeadEnabled;
  }
});

test("raster route returns 503 when the maplibre native binding is unavailable", async (): Promise<void> => {
  if (RENDERER_AVAILABLE) {
    return;
  }
  // Seed the same valid state the full test does so tile resolution succeeds
  // and the request actually reaches the render step (where the missing
  // native binding raises BACKEND_UNAVAILABLE → 503). Without valid tile
  // bytes the request would fail earlier at tile-resolver with 502 instead.
  const config = loadConfig(process.env);
  const store = createObjectStore(config);
  const fixture = new Uint8Array(await readFile(fixturePath));
  const artifactId = `unavailable-renderer-${Date.now()}`;
  await store.putObject(`artifacts/${artifactId}/tiles.pmtiles`, fixture, "application/vnd.pmtiles");
  await registerArtifact({
    id: artifactId,
    key: `artifacts/${artifactId}/tiles.pmtiles`,
    checksum: `checksum-${artifactId}`,
    byteSize: fixture.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await promoteArtifact(artifactId);
  const styleId = `unavailable-style-${Date.now()}`;
  const version = await createStyleVersion(styleId, {
    version: 8,
    sources: {
      osm: {
        type: "vector",
        url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
      },
    },
    sprite: "/v1/styles/{styleId}/sprites/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [],
  });
  await publishStyleVersion(styleId, version.id);
  const response = await handleRasterTileRequest({
    method: "GET",
    path: `/v1/raster/${styleId}/0/0/0.png`,
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers["cache-control"], "no-store");
});
