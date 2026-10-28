import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { createStyleVersion, publishStyleVersion } from "../styles.service";
import { handleStyleRequest } from "../styles-route.service";
import { createObjectStore } from "../../storage/storage.service";
import { loadConfig } from "../../../config/load-config";
import { promoteArtifact, registerArtifact } from "../../artifact/artifact.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.ADMIN_TOKEN = "admin-token";
process.env.ALLOWED_ORIGINS = "https://example.com";
process.env.NODE_ENV = "development";

const fixturePmtilesPath = resolve(process.cwd(), "src/domains/tile-resolver/__fixtures__/test_fixture_1.pmtiles");

test("style routes expose list, JSON, and local sprite or glyph assets", async (): Promise<void> => {
  const config = loadConfig(process.env);
  const store = createObjectStore(config);
  const fixtureBytes = await readFile(fixturePmtilesPath);
  await store.putObject("artifacts/style-route/tiles.pmtiles", fixtureBytes);
  await registerArtifact({
    id: "style-route-artifact",
    key: "artifacts/style-route/tiles.pmtiles",
    checksum: "style-route-checksum",
    byteSize: fixtureBytes.byteLength,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await promoteArtifact("style-route-artifact");

  const version = await createStyleVersion("style-route", {
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
  await publishStyleVersion("style-route", version.id);

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
  assert.equal(listWithoutPrefix.headers["content-type"], "application/json");
  const parsedNoPrefix = JSON.parse(listWithoutPrefix.body as string) as Array<{ id: string }>;
  const hasStyleNoPrefix = parsedNoPrefix.some((entry) => entry.id === "style-route");
  assert.equal(hasStyleNoPrefix, true);

  const listWithoutPrefixHead = await handleStyleRequest({
    method: "HEAD",
    path: "/styles",
  });
  assert.equal(listWithoutPrefixHead.status, 200);
  assert.equal(listWithoutPrefixHead.body, undefined);
  assert.equal(listWithoutPrefixHead.headers["content-length"], listWithoutPrefix.headers["content-length"]);

  const listWithoutPrefixOptions = await handleStyleRequest({
    method: "OPTIONS",
    path: "/styles",
  });
  assert.equal(listWithoutPrefixOptions.status, 204);
  assert.equal(listWithoutPrefixOptions.headers["access-control-allow-methods"], "GET,HEAD,OPTIONS");

  const styleJson = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
  });
  assert.equal(styleJson.status, 200);
  assert.equal(styleJson.headers["content-type"], "application/json");
  assert.equal(typeof styleJson.headers["content-length"], "string");
  const style = JSON.parse(styleJson.body as string) as {
    version: number;
    sprite?: string;
    sprites?: string;
    glyphs?: string;
    sources?: Record<string, { url?: string; tiles?: string[]; minzoom?: number; maxzoom?: number }>;
  };
  assert.equal(style.version, 8);
  assert.equal(Array.isArray(style.sources?.osm?.tiles), true);
  assert.equal(style.sources?.osm?.tiles?.[0]?.includes("{access_token}") ?? false, false);
  assert.equal(style.sources?.osm?.url, undefined);
  assert.equal(typeof style.sources?.osm?.minzoom, "number");
  assert.equal(typeof style.sources?.osm?.maxzoom, "number");
  assert.equal(style.sprite, "/v1/styles/style-route/sprites/sprite");
  assert.equal("sprites" in style, false);
  assert.equal(style.glyphs, "/v1/fonts/{fontstack}/{range}.pbf");
  assert.equal(styleJson.headers["cache-control"], "public, max-age=300");

  const tokenizedStyleJson = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
    baseUrl: "http://127.0.0.1:8787",
    query: {
      access_token: "browser-preview-token",
    },
  });
  assert.equal(tokenizedStyleJson.status, 200);
  assert.equal(tokenizedStyleJson.headers["cache-control"], "public, max-age=300");
  const tokenizedStyle = JSON.parse(tokenizedStyleJson.body as string) as {
    sprite?: string;
    glyphs?: string;
    sources?: Record<string, { url?: string; tiles?: string[]; minzoom?: number; maxzoom?: number }>;
  };
  assert.equal(tokenizedStyle.sources?.osm?.tiles?.[0]?.includes("http://127.0.0.1:8787/v1/tiles/") ?? false, true);
  assert.equal(tokenizedStyle.sources?.osm?.tiles?.[0]?.includes("browser-preview-token") ?? false, true);
  assert.equal(tokenizedStyle.sources?.osm?.tiles?.[0]?.includes("{access_token}") ?? false, false);
  assert.equal(tokenizedStyle.sources?.osm?.url, undefined);
  assert.equal(tokenizedStyle.sprite, "http://127.0.0.1:8787/v1/styles/style-route/sprites/sprite");
  assert.equal(tokenizedStyle.glyphs, "http://127.0.0.1:8787/v1/fonts/{fontstack}/{range}.pbf");

  const tokenizedStyleJsonFromPath = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json?access_token=browser-preview-token",
    baseUrl: "http://127.0.0.1:8787",
  });
  assert.equal(tokenizedStyleJsonFromPath.status, 200);
  const tokenizedStyleFromPath = JSON.parse(tokenizedStyleJsonFromPath.body as string) as {
    sprite?: string;
    glyphs?: string;
    sources?: Record<string, { tiles?: string[] }>;
  };
  assert.equal(tokenizedStyleFromPath.sources?.osm?.tiles?.[0]?.includes("browser-preview-token") ?? false, true);
  assert.equal(tokenizedStyleFromPath.sources?.osm?.tiles?.[0]?.includes("{access_token}") ?? false, false);
  assert.equal(tokenizedStyleFromPath.sprite, "http://127.0.0.1:8787/v1/styles/style-route/sprites/sprite");
  assert.equal(tokenizedStyleFromPath.glyphs, "http://127.0.0.1:8787/v1/fonts/{fontstack}/{range}.pbf");

  const tokenizedStyleJsonFromPathWithSparseQuery = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json?access_token=browser-preview-token",
    baseUrl: "http://127.0.0.1:8787",
    query: {
      access_token: undefined,
    },
  });
  assert.equal(tokenizedStyleJsonFromPathWithSparseQuery.status, 200);
  const tokenizedStyleFromPathWithSparseQuery = JSON.parse(tokenizedStyleJsonFromPathWithSparseQuery.body as string) as {
    sources?: Record<string, { tiles?: string[] }>;
  };
  assert.equal(tokenizedStyleFromPathWithSparseQuery.sources?.osm?.tiles?.[0]?.includes("browser-preview-token") ?? false, true);
  assert.equal(tokenizedStyleFromPathWithSparseQuery.sources?.osm?.tiles?.[0]?.includes("{access_token}") ?? false, false);

  const tokenizedStyleJsonFromQueryArray = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
    baseUrl: "http://127.0.0.1:8787",
    query: {
      access_token: ["", "browser-preview-token"],
    },
  });
  assert.equal(tokenizedStyleJsonFromQueryArray.status, 200);
  const tokenizedStyleFromQueryArray = JSON.parse(tokenizedStyleJsonFromQueryArray.body as string) as {
    sources?: Record<string, { tiles?: string[] }>;
  };
  assert.equal(tokenizedStyleFromQueryArray.sources?.osm?.tiles?.[0]?.includes("browser-preview-token") ?? false, true);
  assert.equal(tokenizedStyleFromQueryArray.sources?.osm?.tiles?.[0]?.includes("{access_token}") ?? false, false);

  const tokenizedStyleJsonWithTrailingSlashBaseUrl = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
    baseUrl: "http://127.0.0.1:8787/",
    query: {
      access_token: "browser-preview-token",
    },
  });
  assert.equal(tokenizedStyleJsonWithTrailingSlashBaseUrl.status, 200);
  const trailingSlashBaseUrlStyle = JSON.parse(tokenizedStyleJsonWithTrailingSlashBaseUrl.body as string) as {
    sprite?: string;
    glyphs?: string;
    sources?: Record<string, { tiles?: string[] }>;
  };
  assert.equal(trailingSlashBaseUrlStyle.sources?.osm?.tiles?.[0]?.includes("http://127.0.0.1:8787//"), false);
  assert.equal(trailingSlashBaseUrlStyle.sprite?.includes("http://127.0.0.1:8787//"), false);
  assert.equal(trailingSlashBaseUrlStyle.glyphs?.includes("http://127.0.0.1:8787//"), false);
  assert.equal(
    trailingSlashBaseUrlStyle.sources?.osm?.tiles?.[0],
    "http://127.0.0.1:8787/v1/tiles/{z}/{x}/{y}.mvt?access_token=browser-preview-token",
  );
  assert.equal(trailingSlashBaseUrlStyle.sprite, "http://127.0.0.1:8787/v1/styles/style-route/sprites/sprite");
  assert.equal(trailingSlashBaseUrlStyle.glyphs, "http://127.0.0.1:8787/v1/fonts/{fontstack}/{range}.pbf");

  const tokenizedStyleJsonWithPathBearingBaseUrl = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
    baseUrl: "http://127.0.0.1:8787/app/projects",
    query: {
      access_token: "browser-preview-token",
    },
  });
  assert.equal(tokenizedStyleJsonWithPathBearingBaseUrl.status, 200);
  const pathBearingBaseUrlStyle = JSON.parse(tokenizedStyleJsonWithPathBearingBaseUrl.body as string) as {
    sprite?: string;
    glyphs?: string;
    sources?: Record<string, { tiles?: string[] }>;
  };
  assert.equal(pathBearingBaseUrlStyle.sources?.osm?.tiles?.[0]?.includes("http://127.0.0.1:8787/app/"), false);
  assert.equal(pathBearingBaseUrlStyle.sprite?.includes("http://127.0.0.1:8787/app/"), false);
  assert.equal(pathBearingBaseUrlStyle.glyphs?.includes("http://127.0.0.1:8787/app/"), false);
  assert.equal(
    pathBearingBaseUrlStyle.sources?.osm?.tiles?.[0],
    "http://127.0.0.1:8787/v1/tiles/{z}/{x}/{y}.mvt?access_token=browser-preview-token",
  );
  assert.equal(pathBearingBaseUrlStyle.sprite, "http://127.0.0.1:8787/v1/styles/style-route/sprites/sprite");
  assert.equal(pathBearingBaseUrlStyle.glyphs, "http://127.0.0.1:8787/v1/fonts/{fontstack}/{range}.pbf");

  const tokenizedStyleJsonWithRelativePathBaseUrl = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
    baseUrl: "/app/projects",
    query: {
      access_token: "browser-preview-token",
    },
  });
  assert.equal(tokenizedStyleJsonWithRelativePathBaseUrl.status, 200);
  const relativePathBaseUrlStyle = JSON.parse(tokenizedStyleJsonWithRelativePathBaseUrl.body as string) as {
    sprite?: string;
    glyphs?: string;
    sources?: Record<string, { tiles?: string[] }>;
  };
  assert.equal(relativePathBaseUrlStyle.sources?.osm?.tiles?.[0]?.includes("/app/"), false);
  assert.equal(relativePathBaseUrlStyle.sprite?.includes("/app/"), false);
  assert.equal(relativePathBaseUrlStyle.glyphs?.includes("/app/"), false);
  assert.equal(
    relativePathBaseUrlStyle.sources?.osm?.tiles?.[0],
    "/v1/tiles/{z}/{x}/{y}.mvt?access_token=browser-preview-token",
  );
  assert.equal(relativePathBaseUrlStyle.sprite, "/v1/styles/style-route/sprites/sprite");
  assert.equal(relativePathBaseUrlStyle.glyphs, "/v1/fonts/{fontstack}/{range}.pbf");

  const tokenizedStyleJsonWithJavascriptBaseUrl = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
    baseUrl: "javascript:alert('xss')",
    query: {
      access_token: "browser-preview-token",
    },
  });
  assert.equal(tokenizedStyleJsonWithJavascriptBaseUrl.status, 200);
  const javascriptBaseUrlStyle = JSON.parse(tokenizedStyleJsonWithJavascriptBaseUrl.body as string) as {
    sprite?: string;
    glyphs?: string;
    sources?: Record<string, { tiles?: string[] }>;
  };
  assert.equal(
    javascriptBaseUrlStyle.sources?.osm?.tiles?.[0],
    "/v1/tiles/{z}/{x}/{y}.mvt?access_token=browser-preview-token",
  );
  assert.equal(javascriptBaseUrlStyle.sprite, "/v1/styles/style-route/sprites/sprite");
  assert.equal(javascriptBaseUrlStyle.glyphs, "/v1/fonts/{fontstack}/{range}.pbf");

  const tokenizedStyleJsonWithHostlessBaseUrl = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
    baseUrl: "app/projects",
    query: {
      access_token: "browser-preview-token",
    },
  });
  assert.equal(tokenizedStyleJsonWithHostlessBaseUrl.status, 200);
  const hostlessBaseUrlStyle = JSON.parse(tokenizedStyleJsonWithHostlessBaseUrl.body as string) as {
    sprite?: string;
    glyphs?: string;
    sources?: Record<string, { tiles?: string[] }>;
  };
  assert.equal(
    hostlessBaseUrlStyle.sources?.osm?.tiles?.[0],
    "/v1/tiles/{z}/{x}/{y}.mvt?access_token=browser-preview-token",
  );
  assert.equal(hostlessBaseUrlStyle.sprite, "/v1/styles/style-route/sprites/sprite");
  assert.equal(hostlessBaseUrlStyle.glyphs, "/v1/fonts/{fontstack}/{range}.pbf");

  const sprite = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/sprites/sprite.png",
  });
  assert.equal(sprite.status, 200);
  assert.equal(sprite.headers["content-type"], "image/png");
  assert.equal(Number(sprite.headers["content-length"] ?? "0") > 0, true);
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
  assert.equal(Number(spriteJson.headers["content-length"] ?? "0") > 0, true);

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
    path: "/v1/fonts/Noto%20Sans%20Regular/0-255.pbf",
  });
  assert.equal(fonts.status, 200);
  assert.equal(fonts.headers["content-type"], "application/x-protobuf");
  assert.equal(Number(fonts.headers["content-length"] ?? "0") > 0, true);
  const fontsHead = await handleStyleRequest({
    method: "HEAD",
    path: "/v1/fonts/Noto%20Sans%20Regular/0-255.pbf",
  });
  assert.equal(fontsHead.status, 200);
  assert.equal(fontsHead.body, undefined);
  assert.equal(fontsHead.headers["content-length"], fonts.headers["content-length"]);

  const fontsOptions = await handleStyleRequest({
    method: "OPTIONS",
    path: "/v1/fonts/Noto%20Sans%20Regular/0-255.pbf",
  });
  assert.equal(fontsOptions.status, 204);

  const fontTraversal = await handleStyleRequest({
    method: "GET",
    path: "/v1/fonts/..%2Fsecret/0-255.pbf",
  });
  assert.equal(fontTraversal.status, 400);
  assert.equal(fontTraversal.headers["cache-control"], "no-store");

  const fontDotSegment = await handleStyleRequest({
    method: "GET",
    path: "/v1/fonts/%2E/0-255.pbf",
  });
  assert.equal(fontDotSegment.status, 400);
  assert.equal(fontDotSegment.headers["cache-control"], "no-store");

  const malformedFontEncoding = await handleStyleRequest({
    method: "GET",
    path: "/v1/fonts/%E0%A4%A/0-255.pbf",
  });
  assert.equal(malformedFontEncoding.status, 400);
  assert.equal(malformedFontEncoding.headers["cache-control"], "no-store");

  const malformedRouteRequest = await handleStyleRequest(
    null as unknown as Parameters<typeof handleStyleRequest>[0],
  );
  assert.equal(malformedRouteRequest.status, 400);
  assert.equal(malformedRouteRequest.body, JSON.stringify({ error: "STYLE_BAD_REQUEST" }));

  const malformedPath = await handleStyleRequest({
    method: "GET",
    path: 42 as unknown as string,
  });
  assert.equal(malformedPath.status, 400);

  const malformedQuery = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
    query: 42 as unknown as Record<string, string>,
  });
  assert.equal(malformedQuery.status, 400);

  const malformedQueryEntry = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
    query: {
      access_token: [42 as unknown as string],
    },
  });
  assert.equal(malformedQueryEntry.status, 400);

  const malformedBaseUrl = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route/style.json",
    baseUrl: 42 as unknown as string,
  });
  assert.equal(malformedBaseUrl.status, 400);

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

  const queryBearingStyleVersion = await createStyleVersion("style-route-query-shape", {
    version: 8,
    sources: {
      osm: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?draft=published&access_token={access_token}&lang=en"],
      },
    },
    layers: [],
  });
  await publishStyleVersion("style-route-query-shape", queryBearingStyleVersion.id);

  const queryBearingStyleJson = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/style-route-query-shape/style.json",
  });
  assert.equal(queryBearingStyleJson.status, 200);
  const queryBearingStyle = JSON.parse(queryBearingStyleJson.body as string) as {
    sources?: Record<string, { tiles?: string[] }>;
  };
  assert.equal(queryBearingStyle.sources?.osm?.tiles?.[0], "/v1/tiles/{z}/{x}/{y}.mvt?draft=published&lang=en");

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
  assert.equal(typeof missing.body, "string");

  const missingHead = await handleStyleRequest({
    method: "HEAD",
    path: "/v1/styles/missing/style.json",
  });
  assert.equal(missingHead.status, 404);
  assert.equal(missingHead.headers["cache-control"], "no-store");
  assert.equal(missingHead.body, undefined);

  const blankStyleId = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/%20/style.json",
  });
  assert.equal(blankStyleId.status, 400);
  assert.equal(blankStyleId.headers["cache-control"], "no-store");

  const dotStyleId = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/%2E/style.json",
  });
  assert.equal(dotStyleId.status, 400);
  assert.equal(dotStyleId.headers["cache-control"], "no-store");

  const blankSpriteStyleId = await handleStyleRequest({
    method: "GET",
    path: "/v1/styles/%20/sprites/sprite.png",
  });
  assert.equal(blankSpriteStyleId.status, 400);
  assert.equal(blankSpriteStyleId.headers["cache-control"], "no-store");

  const draftStyle = await createStyleVersion("style-draft", {
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
  assert.equal(typeof unknown.body, "string");

  const unknownHead = await handleStyleRequest({
    method: "HEAD",
    path: "/v1/styles/style-route/unknown",
  });
  assert.equal(unknownHead.status, 400);
  assert.equal(unknownHead.headers["cache-control"], "no-store");
  assert.equal(unknownHead.body, undefined);

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
