import { strict as assert } from "node:assert";
import { createStyleVersion, publishStyleVersion } from "../../styles/styles.service";
import { handleRasterTileRequest, handleStaticMapRequest } from "../raster-api.service";
import { promoteArtifact, registerArtifact } from "../../artifact/artifact.service";
import { createObjectStore } from "../../storage/storage.service";
import { loadConfig } from "../../../config/load-config";
import type { RasterRequest } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.ADMIN_TOKEN = "admin-token";
process.env.ALLOWED_ORIGINS = "https://example.com";
process.env.ALLOWED_TILES_TOKENS = "tile-token";
process.env.NODE_ENV = "development";
const originalHeadEnabled = process.env.HEAD_ENABLED;
const originalCacheTtl = process.env.CACHE_TTL_SECONDS;

test("raster and static routes resolve and enforce request semantics", async (): Promise<void> => {
  const config = loadConfig(process.env);
  const store = createObjectStore(config);
  await store.putObject("artifacts/raster-artifact/tiles.pmtiles", new TextEncoder().encode("artifact-bytes"));
  registerArtifact({
    id: "raster-artifact",
    key: "artifacts/raster-artifact/tiles.pmtiles",
    checksum: "raster-checksum",
    byteSize: 14,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  promoteArtifact("raster-artifact");

  const version = createStyleVersion("basic", {
    version: 8,
    sources: {
      osm: {
        type: "vector",
        url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
      },
    },
  });
  publishStyleVersion("basic", version.id);

  const raster = await handleRasterTileRequest({
    method: "GET",
    path: "/v1/raster/basic/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(raster.status, 200);
  assert.equal(typeof raster.headers["x-raster-cache-key"], "string");
  assert.equal(raster.headers["x-raster-cache-key"].startsWith("raster:basic"), true);
  assert.equal(raster.headers["cache-control"], "public, max-age=300");

  const rasterHead = await handleRasterTileRequest({
    method: "HEAD",
    path: "/v1/raster/basic/2/2/3.png",
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
    path: "/v1/raster/basic/2/2/3.png",
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
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp",
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
    path: "/v1/raster/basic/2/2/3.png",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterOptions.status, 204);

  const rasterOptionsWithoutAuth = await handleRasterTileRequest({
    method: "OPTIONS",
    path: "/v1/raster/basic/2/2/3.png",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(rasterOptionsWithoutAuth.status, 204);
  assert.equal(rasterOptionsWithoutAuth.headers["access-control-allow-origin"], "https://example.com");

  const staticOptionsWithoutAuth = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp",
    headers: {
      origin: "https://example.com",
    },
  });
  assert.equal(staticOptionsWithoutAuth.status, 204);
  assert.equal(staticOptionsWithoutAuth.headers["access-control-allow-origin"], "https://example.com");

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

  const staticMap = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticMap.status, 200);
  assert.equal(typeof staticMap.headers["x-raster-cache-key"], "string");
  assert.equal(staticMap.headers["x-raster-cache-key"].startsWith("raster:basic"), true);

  process.env.CACHE_TTL_SECONDS = "75";
  const staticMapCustomTtl = await handleStaticMapRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp",
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
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp",
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
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp",
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
    path: "/v1/static/basic/-122.4194,37.7749,12.5/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticMapDecimalZoom.status, 200);
  assert.equal(typeof staticMapDecimalZoom.headers["x-raster-cache-key"], "string");

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

  const staticHead = await handleStaticMapRequest({
    method: "HEAD",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp",
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(staticHead.status, 200);
  assert.equal(staticHead.body, undefined);

  const staticOptions = await handleStaticMapRequest({
    method: "OPTIONS",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp",
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
