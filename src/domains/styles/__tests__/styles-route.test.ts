import { strict as assert } from "node:assert";
import { createStyleVersion, publishStyleVersion } from "../styles.service";
import { handleStyleRequest } from "../styles-route.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.ADMIN_TOKEN = "admin-token";
process.env.ALLOWED_ORIGINS = "https://example.com";
process.env.NODE_ENV = "development";

test("style routes expose list, JSON, sprites, and glyph placeholders", async (): Promise<void> => {
  const version = createStyleVersion("style-route", {
    version: 8,
    sources: {
      osm: {
        type: "vector",
        url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
      },
    },
    sprites: "/v1/styles/{styleId}/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
  });
  publishStyleVersion("style-route", version.id);

  const list = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles",
  });
  assert.equal(list.status, 200);
  assert.equal(list.headers["content-type"], "application/json");
  assert.equal(typeof list.headers["content-length"], "string");
  const parsed = JSON.parse(list.body as string) as Array<{ id: string }>;
  const hasStyle = parsed.some((entry) => entry.id === "style-route");
  assert.equal(hasStyle, true);

  const listWithoutPrefix = await handleStyleRequest({
    method: "GET",
    path: "/styles",
  });
  assert.equal(listWithoutPrefix.status, 200);
  const parsedNoPrefix = JSON.parse(listWithoutPrefix.body as string) as Array<{ id: string }>;
  const hasStyleNoPrefix = parsedNoPrefix.some((entry) => entry.id === "style-route");
  assert.equal(hasStyleNoPrefix, true);

  const styleJson = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
  });
  assert.equal(styleJson.status, 200);
  assert.equal(styleJson.headers["content-type"], "application/json");
  assert.equal(typeof styleJson.headers["content-length"], "string");
  const style = JSON.parse(styleJson.body as string) as { version: number };
  assert.equal(style.version, 8);

  const sprite = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/sprites/sprite.png",
  });
  assert.equal(sprite.status, 200);
  assert.equal(sprite.headers["content-type"], "image/png");
  const spriteHead = await handleStyleRequest({
    method: "HEAD",
    path: "/v1/styles/style-route/sprites/sprite.png",
  });
  assert.equal(spriteHead.status, 200);
  assert.equal(spriteHead.body, undefined);
  assert.equal(spriteHead.headers["content-length"], sprite.headers["content-length"]);

  const spriteJson = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/sprites/sprite.json",
  });
  assert.equal(spriteJson.status, 200);
  assert.equal(spriteJson.headers["content-type"], "application/json");

  const sprite2x = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/sprites/sprite@2x.png",
  });
  assert.equal(sprite2x.status, 200);
  assert.equal(sprite2x.headers["content-type"], "image/png");

  const sprite2xJson = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/sprites/sprite@2x.json",
  });
  assert.equal(sprite2xJson.status, 200);
  assert.equal(sprite2xJson.headers["content-type"], "application/json");

  const spriteNestedPath = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/sprites/folder/sprite.png",
  });
  assert.equal(spriteNestedPath.status, 400);

  const spriteNestedPathOptions = await handleStyleRequest({
    method: "OPTIONS",
    path: "/v1/styles/style-route/sprites/folder/sprite.png",
  });
  assert.equal(spriteNestedPathOptions.status, 400);

  const fonts = await handleStyleRequest({
    method: "GET",
    path: "/v1/fonts/Roboto%20Regular/0-255.pbf",
  });
  assert.equal(fonts.status, 200);
  assert.equal(fonts.headers["content-type"], "application/octet-stream");
  const fontsHead = await handleStyleRequest({
    method: "HEAD",
    path: "/v1/fonts/Roboto%20Regular/0-255.pbf",
  });
  assert.equal(fontsHead.status, 200);
  assert.equal(fontsHead.body, undefined);
  assert.equal(fontsHead.headers["content-length"], fonts.headers["content-length"]);

  const fontsOptions = await handleStyleRequest({
    method: "OPTIONS",
    path: "/v1/fonts/Roboto%20Regular/0-255.pbf",
  });
  assert.equal(fontsOptions.status, 204);

  const options = await handleStyleRequest({
    method: "OPTIONS",
    path: "/v1/styles/style-route/style.json",
  });
  assert.equal(options.status, 204);

  const head = await handleStyleRequest({
    method: "HEAD",
    path: "/v1/styles/style-route/style.json",
  });
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers["content-length"], styleJson.headers["content-length"]);

  const listHead = await handleStyleRequest({
    method: "HEAD",
    path: "/v1/styles",
  });
  assert.equal(listHead.status, 200);
  assert.equal(listHead.body, undefined);
  assert.equal(listHead.headers["content-length"], list.headers["content-length"]);

  const badMethod = await handleStyleRequest({
    method: "POST" as unknown as "GET",
    path: "/v1/styles/style-route/style.json",
  });
  assert.equal(badMethod.status, 400);
  assert.equal(badMethod.headers["cache-control"], "no-store");

  const missing = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/missing/style.json",
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers["cache-control"], "no-store");

  const blankStyleId = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/%20/style.json",
  });
  assert.equal(blankStyleId.status, 400);
  assert.equal(blankStyleId.headers["cache-control"], "no-store");

  const blankSpriteStyleId = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/%20/sprites/sprite.png",
  });
  assert.equal(blankSpriteStyleId.status, 400);
  assert.equal(blankSpriteStyleId.headers["cache-control"], "no-store");

  const draftStyle = createStyleVersion("style-draft", {
    version: 8,
    sources: {
      osm: {
        type: "vector",
        url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
      },
    },
    sprites: "/v1/styles/{styleId}/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
  });
  assert.equal(typeof draftStyle.id, "string");
  const unpublished = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-draft/style.json",
  });
  assert.equal(unpublished.status, 404);
  assert.equal(unpublished.headers["cache-control"], "no-store");

  const unknown = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/unknown",
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.headers["cache-control"], "no-store");

  const invalidOptions = await handleStyleRequest({
    method: "OPTIONS",
    path: "/v1/styles/style-route/invalid/path",
  });
  assert.equal(invalidOptions.status, 400);
  assert.equal(invalidOptions.headers["cache-control"], "no-store");

  const styleOptions = await handleStyleRequest({
    method: "OPTIONS",
    path: "/v1/styles/style-route/style.json",
  });
  assert.equal(styleOptions.status, 204);
});
