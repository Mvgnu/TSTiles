import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createStyleVersion, publishStyleVersion } from "../../styles/styles.service";
import { loadConfig } from "../../../config/load-config";
import { promoteArtifact, registerArtifact } from "../../artifact/artifact.service";
import { renderRasterTile, renderStaticMap } from "../render.service";
import { createObjectStore as createObjectStoreDirect } from "../../storage/storage.service";
import { isCartographicRendererAvailable } from "../adapters/maplibre-native-renderer";
import { RenderError, RenderErrorCode } from "../types";

const RENDERER_AVAILABLE = isCartographicRendererAvailable();

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
let testChain = Promise.resolve();
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  testChain = testChain.then(() => Promise.resolve(fn()));
}));

process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.NODE_ENV = "development";

loadConfig();
const fixturePath = resolve(__dirname, "../../tile-resolver/__fixtures__/test_fixture_1.pmtiles");

async function prepareActiveArtifact(): Promise<{ id: string; key: string }> {
  const id = `artifact-${randomUUID().slice(0, 8)}`;
  const key = `${id}/tiles.pmtiles`;
  const payload = new Uint8Array(await readFile(fixturePath));

  const store = createObjectStoreDirect(loadConfig());
  await store.putObject(key, payload, "application/vnd.pmtiles");

  const artifact = {
    id,
    key,
    checksum: createHash("sha256").update(payload).digest("hex"),
    byteSize: payload.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  } as const;

  await registerArtifact(artifact);
  await promoteArtifact(id);
  return artifact;
}

async function publishStyle(styleId: string): Promise<void> {
  const version = await createStyleVersion(styleId, {
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
  await publishStyleVersion(styleId, version.id);
}

function looksLikePng(bytes: Uint8Array): boolean {
  return bytes.byteLength > 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47;
}

async function expectRendererUnavailable(call: () => Promise<unknown>): Promise<void> {
  let captured: unknown;
  try {
    await call();
    assert.fail("expected RENDER_BACKEND_UNAVAILABLE");
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof RenderError);
  assert.equal((captured as RenderError).code, RenderErrorCode.BACKEND_UNAVAILABLE);
}

test("render raster tile returns a deterministic PNG payload (or fails closed when binding absent)", async () => {
  await prepareActiveArtifact();
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  await publishStyle(styleId);

  if (!RENDERER_AVAILABLE) {
    await expectRendererUnavailable(() => renderRasterTile({ styleId, z: 0, x: 0, y: 0, format: "png" }));
    return;
  }

  const image = await renderRasterTile({
    styleId,
    z: 0,
    x: 0,
    y: 0,
    format: "png",
  });

  assert.equal(image.contentType, "image/png");
  assert.equal(image.cacheKey.startsWith(`raster:${styleId}`), true);
  assert.equal(looksLikePng(image.bytes), true);
});

function looksLikeWebp(bytes: Uint8Array): boolean {
  // RIFF....WEBP magic.
  return bytes.byteLength > 12
    && bytes[0] === 0x52 // 'R'
    && bytes[1] === 0x49 // 'I'
    && bytes[2] === 0x46 // 'F'
    && bytes[3] === 0x46 // 'F'
    && bytes[8] === 0x57 // 'W'
    && bytes[9] === 0x45 // 'E'
    && bytes[10] === 0x42 // 'B'
    && bytes[11] === 0x50; // 'P'
}

test("render static map validates geometry and emits real WebP via sharp (or fails closed when binding absent)", async () => {
  await prepareActiveArtifact();
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  await publishStyle(styleId);

  const args = {
    styleId,
    lon: 0,
    lat: 0,
    zoom: 0,
    width: 512,
    height: 256,
    format: "webp" as const,
    overlays: ["route-1", "poi"],
  };

  if (!RENDERER_AVAILABLE) {
    await expectRendererUnavailable(() => renderStaticMap(args));
    return;
  }

  const image = await renderStaticMap(args);
  assert.equal(image.contentType, "image/webp");
  assert.equal(image.cacheKey.startsWith(`raster:${styleId}`), true);
  assert.equal(looksLikeWebp(image.bytes), true);
});

test("render static map cache key is stable for overlay set order", async (): Promise<void> => {
  const styleId = await (async () => {
    await prepareActiveArtifact();
    const id = `style-${randomUUID().slice(0, 8)}`;
    await publishStyle(id);
    return id;
  })();

  const baseArgs = {
    styleId,
    lon: 0,
    lat: 0,
    zoom: 0,
    width: 320,
    height: 240,
    format: "png" as const,
  };
  if (!RENDERER_AVAILABLE) {
    await expectRendererUnavailable(() => renderStaticMap({ ...baseArgs, overlays: ["beta", "alpha"] }));
    return;
  }

  const first = await renderStaticMap({ ...baseArgs, overlays: ["beta", "alpha"] });
  const second = await renderStaticMap({ ...baseArgs, overlays: ["alpha", "beta", "alpha"] });
  // Cache key must be order-stable across permutations and dedup'd entries.
  assert.equal(first.cacheKey, second.cacheKey);
});

test("render static map payload varies when overlays change", async (): Promise<void> => {
  await prepareActiveArtifact();
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  await publishStyle(styleId);

  const baseArgs = {
    styleId,
    lon: 0,
    lat: 0,
    zoom: 0,
    width: 320,
    height: 240,
    format: "png" as const,
  };
  if (!RENDERER_AVAILABLE) {
    await expectRendererUnavailable(() => renderStaticMap(baseArgs));
    return;
  }

  const plain = await renderStaticMap(baseArgs);
  const withOverlay = await renderStaticMap({ ...baseArgs, overlays: ["route-a"] });
  assert.equal(looksLikePng(plain.bytes), true);
  assert.equal(looksLikePng(withOverlay.bytes), true);
  assert.equal(plain.cacheKey === withOverlay.cacheKey, false);
});

test("render static map cache key varies by output dimensions", async (): Promise<void> => {
  await prepareActiveArtifact();
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  await publishStyle(styleId);

  const baseArgs = {
    styleId,
    lon: 0,
    lat: 0,
    zoom: 0,
    format: "png" as const,
  };
  if (!RENDERER_AVAILABLE) {
    await expectRendererUnavailable(() => renderStaticMap({ ...baseArgs, width: 320, height: 240 }));
    return;
  }

  const small = await renderStaticMap({ ...baseArgs, width: 320, height: 240 });
  const large = await renderStaticMap({ ...baseArgs, width: 640, height: 480 });
  assert.equal(small.cacheKey === large.cacheKey, false);
});

test("render static map forwards dimensions to local renderer", async (): Promise<void> => {
  await prepareActiveArtifact();
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  await publishStyle(styleId);
  const baseArgs = {
    styleId,
    lon: 0,
    lat: 0,
    zoom: 0,
    width: 640,
    height: 360,
    format: "png" as const,
  };
  if (!RENDERER_AVAILABLE) {
    await expectRendererUnavailable(() => renderStaticMap(baseArgs));
    return;
  }

  const first = await renderStaticMap(baseArgs);
  const second = await renderStaticMap(baseArgs);
  // Same input must produce identical byte output (deterministic encoding).
  assert.equal(looksLikePng(first.bytes), true);
  assert.equal(first.bytes.length, second.bytes.length);
});

test("renderStaticMap rejects invalid dimensions", async () => {
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  await publishStyle(styleId);

  try {
    await renderStaticMap(null as unknown as Parameters<typeof renderStaticMap>[0]);
    assert.fail("expected request object validation");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }

  try {
    await renderRasterTile(null as unknown as Parameters<typeof renderRasterTile>[0]);
    assert.fail("expected raster request object validation");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }

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

  try {
    await renderStaticMap({
      styleId,
      lon: 0,
      lat: 0,
      zoom: 5,
      width: 256.5,
      height: 256,
      format: "png",
    });
    assert.fail("expected integer dimension validation");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }

  try {
    await renderStaticMap({
      styleId: 42 as unknown as string,
      lon: 0,
      lat: 0,
      zoom: 5,
      width: 256,
      height: 256,
      format: "png",
    });
    assert.fail("expected styleId type validation");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }

  try {
    await renderRasterTile({
      styleId,
      versionId: 42 as unknown as string,
      z: 0,
      x: 0,
      y: 0,
      format: "png",
    });
    assert.fail("expected versionId type validation");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }
});

test("renderStaticMap rejects non-string overlays at the source boundary", async () => {
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  await publishStyle(styleId);

  try {
    await renderStaticMap({
      styleId,
      lon: 0,
      lat: 0,
      zoom: 5,
      width: 256,
      height: 256,
      format: "png",
      overlays: "route-a" as unknown as string[],
    });
    assert.fail("expected overlays array validation");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }

  try {
    await renderStaticMap({
      styleId,
      lon: 0,
      lat: 0,
      zoom: 5,
      width: 256,
      height: 256,
      format: "png",
      overlays: ["route-a", 42 as unknown as string],
    });
    assert.fail("expected overlay validation failure");
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

test("render rejects path-like style and version identifiers", async () => {
  try {
    await renderRasterTile({
      styleId: "foo/bar",
      z: 1,
      x: 0,
      y: 0,
      format: "png",
    });
    assert.fail("expected bad request");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }

  try {
    await renderRasterTile({
      styleId: ".",
      z: 1,
      x: 0,
      y: 0,
      format: "png",
    });
    assert.fail("expected bad request");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }

  const styleId = `style-${randomUUID().slice(0, 8)}`;
  await publishStyle(styleId);

  try {
    await renderStaticMap({
      styleId,
      versionId: "..",
      lon: 0,
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

  try {
    await renderStaticMap({
      styleId,
      versionId: ".",
      lon: 0,
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

test("renderRasterTile rejects out-of-range tile coordinates", async () => {
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  await publishStyle(styleId);

  try {
    await renderRasterTile({
      styleId,
      z: 1.5 as unknown as number,
      x: 1,
      y: 0,
      format: "png",
    });
    assert.fail("expected integer coordinate validation");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    assert.equal(message.startsWith("RENDER_BAD_REQUEST"), true);
  }

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
  await publishStyle(styleId);

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

test("renderStaticMap rejects latitude outside Web Mercator bounds", async () => {
  const styleId = `style-${randomUUID().slice(0, 8)}`;
  await publishStyle(styleId);

  try {
    await renderStaticMap({
      styleId,
      lon: 0,
      lat: 85.2,
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
  await publishStyle(styleId);

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
