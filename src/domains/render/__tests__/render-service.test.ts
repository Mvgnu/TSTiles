import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { createStyleVersion, publishStyleVersion } from "../../styles/styles.service";
import { loadConfig } from "../../../config/load-config";
import { promoteArtifact, registerArtifact } from "../../artifact/artifact.service";
import { renderRasterTile, renderStaticMap } from "../render.service";
import { createObjectStore as createObjectStoreDirect } from "../../storage/storage.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
let testChain = Promise.resolve();
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  testChain = testChain.then(() => Promise.resolve(fn()));
}));

process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.NODE_ENV = "development";

loadConfig();

async function prepareActiveArtifact(): Promise<{ id: string; key: string }> {
  const id = `artifact-${randomUUID().slice(0, 8)}`;
  const key = `${id}/tiles.pmtiles`;
  const payload = new TextEncoder().encode(`pmtiles-${id}`);

  const store = createObjectStoreDirect(loadConfig());
  await store.putObject(key, payload, "application/octet-stream");

  const artifact = {
    id,
    key,
    checksum: createHash("sha256").update(payload).digest("hex"),
    byteSize: payload.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  } as const;

  registerArtifact(artifact);
  promoteArtifact(id);
  return artifact;
}

function publishStyle(styleId: string): void {
  const version = createStyleVersion(styleId, {
    version: 8,
    sources: {
      map: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    sprites: "/v1/styles/{styleId}/sprites/sprite",
    layers: [],
  });
  publishStyleVersion(styleId, version.id);
}

test("render raster tile returns a local marker payload", async () => {
  const artifact = await prepareActiveArtifact();
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  publishStyle(styleId);

  const image = await renderRasterTile({
    styleId,
    z: 2,
    x: 2,
    y: 3,
    format: "png",
  });

  assert.equal(image.contentType, "image/png");
  assert.equal(image.cacheKey.startsWith(`raster:${styleId}`), true);
  const text = new TextDecoder().decode(image.bytes);
  assert.equal(text.includes("local-render"), true);
  assert.equal(text.includes(artifact.id), true);
});

test("render static map validates geometry and returns marker payload", async () => {
  await prepareActiveArtifact();
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  publishStyle(styleId);

  const image = await renderStaticMap({
    styleId,
    lon: -122.4194,
    lat: 37.7749,
    zoom: 12,
    width: 512,
    height: 256,
    format: "webp",
    overlays: ["route-1", "poi"],
  });

  assert.equal(image.contentType, "image/webp");
  assert.equal(image.cacheKey.startsWith(`raster:${styleId}`), true);
  const text = new TextDecoder().decode(image.bytes);
  assert.equal(text.includes("local-render"), true);
});

test("render static map cache key is stable for overlay set order", async (): Promise<void> => {
  const artifact = await (async () => {
    await prepareActiveArtifact();
    const styleId = `style-${randomUUID().slice(0, 8)}`;
    publishStyle(styleId);
    return styleId;
  })();

  const first = await renderStaticMap({
    styleId: artifact,
    lon: -122.4,
    lat: 37.77,
    zoom: 12,
    width: 320,
    height: 240,
    format: "png",
    overlays: ["beta", "alpha"],
  });
  const second = await renderStaticMap({
    styleId: artifact,
    lon: -122.4,
    lat: 37.77,
    zoom: 12,
    width: 320,
    height: 240,
    format: "png",
    overlays: ["alpha", "beta", "alpha"],
  });
  assert.equal(first.cacheKey, second.cacheKey);
});

test("render static map cache key varies by output dimensions", async (): Promise<void> => {
  await prepareActiveArtifact();
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  publishStyle(styleId);

  const small = await renderStaticMap({
    styleId,
    lon: -122.4,
    lat: 37.77,
    zoom: 12,
    width: 320,
    height: 240,
    format: "png",
  });
  const large = await renderStaticMap({
    styleId,
    lon: -122.4,
    lat: 37.77,
    zoom: 12,
    width: 640,
    height: 480,
    format: "png",
  });

  assert.equal(small.cacheKey === large.cacheKey, false);
});

test("render static map forwards dimensions to remote renderer backend", async (): Promise<void> => {
  await prepareActiveArtifact();
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  publishStyle(styleId);
  const previousBackend = process.env.RENDER_BACKEND;
  process.env.RENDER_BACKEND = "remote";
  try {
    const image = await renderStaticMap({
      styleId,
      lon: -122.4,
      lat: 37.77,
      zoom: 12,
      width: 640,
      height: 360,
      format: "png",
    });
    const text = new TextDecoder().decode(image.bytes);
    assert.equal(text.includes("remote-renderer"), true);
    assert.equal(text.includes("size=640x360"), true);
  } finally {
    if (previousBackend === undefined) {
      delete process.env.RENDER_BACKEND;
    } else {
      process.env.RENDER_BACKEND = previousBackend;
    }
  }
});

test("renderStaticMap rejects invalid dimensions", async () => {
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  publishStyle(styleId);

  try {
    await renderStaticMap({
      styleId,
      lon: 0,
      lat: 0,
      zoom: 5,
      width: 0,
      height: 256,
      format: "png",
    });
    assert.fail("expected bad request");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }
});

test("renderRasterTile rejects blank style identifiers", async () => {
  try {
    await renderRasterTile({
      styleId: "   ",
      z: 1,
      x: 2,
      y: 3,
      format: "png",
    });
    assert.fail("expected bad request");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }
});

test("renderRasterTile rejects out-of-range tile coordinates", async () => {
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  publishStyle(styleId);

  try {
    await renderRasterTile({
      styleId,
      z: 1,
      x: 2,
      y: 0,
      format: "png",
    });
    assert.fail("expected bad request");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }
});

test("renderStaticMap rejects non-finite coordinates", async () => {
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  publishStyle(styleId);

  try {
    await renderStaticMap({
      styleId,
      lon: Number.POSITIVE_INFINITY,
      lat: 0,
      zoom: 5,
      width: 256,
      height: 256,
      format: "png",
    });
    assert.fail("expected bad request");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }
});

test("renderStaticMap rejects zoom values above supported range", async () => {
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  publishStyle(styleId);

  try {
    await renderStaticMap({
      styleId,
      lon: 0,
      lat: 0,
      zoom: 31,
      width: 256,
      height: 256,
      format: "png",
    });
    assert.fail("expected zoom validation failure");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }
});

test("renderRasterTile fails when style is missing", async () => {
  try {
    await renderRasterTile({
      styleId: "missing-style",
      z: 2,
      x: 2,
      y: 3,
      format: "png",
    });
    assert.fail("expected render style not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message, "RENDER_STYLE_NOT_FOUND");
  }
});
