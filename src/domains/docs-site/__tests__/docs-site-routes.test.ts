import { strict as assert } from "node:assert";
import { docsIndexRoute } from "../routes/docs-index-route";
import { docsOpenApiRoute } from "../routes/openapi-route";
import { docsExamplesRoute } from "../routes/examples-route";
import { createStyleVersion, publishStyleVersion } from "../../styles/styles.service";
import { getExamples, getOpenApiJson } from "../docs-site.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("docs index route exposes public index payload", async (): Promise<void> => {
  const response = await docsIndexRoute({ method: "GET", path: "/docs" });
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json");
  assert.equal(response.headers["access-control-allow-origin"], "*");
  assert.equal(response.headers["access-control-allow-methods"], "GET,HEAD,OPTIONS");
  const payload = JSON.parse(response.body as string) as { sections: Array<{ id: string }> };
  assert.equal(Array.isArray(payload.sections), true);
  assert.equal(payload.sections.length > 0, true);
});

test("docs index route handles HEAD and OPTIONS", async (): Promise<void> => {
  const get = await docsIndexRoute({ method: "GET", path: "/docs" });
  assert.equal(get.status, 200);
  assert.equal(typeof get.body, "string");
  const head = await docsIndexRoute({ method: "HEAD", path: "/docs" });
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers["access-control-allow-origin"], "*");
  assert.equal(head.headers["access-control-allow-methods"], "GET,HEAD,OPTIONS");
  assert.equal(head.headers["content-length"], get.headers["content-length"]);

  const options = await docsIndexRoute({ method: "OPTIONS", path: "/docs" });
  assert.equal(options.status, 204);
  assert.equal(options.body, undefined);
  assert.equal(options.headers["access-control-allow-origin"], "*");
  assert.equal(options.headers["access-control-allow-methods"], "GET,HEAD,OPTIONS");
});

test("openapi and examples routes handle OPTIONS", async (): Promise<void> => {
  const openApiGet = await docsOpenApiRoute({ method: "GET", path: "/docs/openapi.json" });
  assert.equal(openApiGet.status, 200);
  const openApiHead = await docsOpenApiRoute({ method: "HEAD", path: "/docs/openapi.json" });
  assert.equal(openApiHead.status, 200);
  assert.equal(openApiHead.body, undefined);
  assert.equal(openApiHead.headers["content-length"], openApiGet.headers["content-length"]);

  const examplesGet = await docsExamplesRoute({ method: "GET", path: "/docs/examples" });
  assert.equal(examplesGet.status, 200);
  const examplesHead = await docsExamplesRoute({ method: "HEAD", path: "/docs/examples" });
  assert.equal(examplesHead.status, 200);
  assert.equal(examplesHead.body, undefined);
  assert.equal(examplesHead.headers["content-length"], examplesGet.headers["content-length"]);

  const openApiOptions = await docsOpenApiRoute({ method: "OPTIONS", path: "/docs/openapi.json" });
  assert.equal(openApiOptions.status, 204);
  assert.equal(openApiOptions.body, undefined);
  assert.equal(openApiOptions.headers["access-control-allow-origin"], "*");
  assert.equal(openApiOptions.headers["access-control-allow-methods"], "GET,HEAD,OPTIONS");

  const examplesOptions = await docsExamplesRoute({ method: "OPTIONS", path: "/docs/examples" });
  assert.equal(examplesOptions.status, 204);
  assert.equal(examplesOptions.body, undefined);
  assert.equal(examplesOptions.headers["access-control-allow-origin"], "*");
  assert.equal(examplesOptions.headers["access-control-allow-methods"], "GET,HEAD,OPTIONS");
});

test("docs routes enforce path matching", async (): Promise<void> => {
  const badIndex = await docsIndexRoute({ method: "GET", path: "/docs/wrong" });
  assert.equal(badIndex.status, 404);
  assert.equal(badIndex.headers["cache-control"], "no-store");

  const badOpenApi = await docsOpenApiRoute({ method: "GET", path: "/docs/openapi" });
  assert.equal(badOpenApi.status, 404);
  assert.equal(badOpenApi.headers["cache-control"], "no-store");

  const badExamples = await docsExamplesRoute({ method: "OPTIONS", path: "/docs/examplez" });
  assert.equal(badExamples.status, 404);
  assert.equal(badExamples.headers["cache-control"], "no-store");

  const badMethodIndex = await docsIndexRoute({
    method: "POST" as unknown as "GET",
    path: "/docs",
  });
  assert.equal(badMethodIndex.status, 400);
  assert.equal(badMethodIndex.headers["cache-control"], "no-store");

  const badMethodOpenApi = await docsOpenApiRoute({
    method: "POST" as unknown as "GET",
    path: "/docs/openapi.json",
  });
  assert.equal(badMethodOpenApi.status, 400);
  assert.equal(badMethodOpenApi.headers["cache-control"], "no-store");

  const badMethodExamples = await docsExamplesRoute({
    method: "POST" as unknown as "GET",
    path: "/docs/examples",
  });
  assert.equal(badMethodExamples.status, 400);
  assert.equal(badMethodExamples.headers["cache-control"], "no-store");
});

test("openapi route returns expected docs schema", async (): Promise<void> => {
  const response = await docsOpenApiRoute({ method: "GET", path: "/docs/openapi.json" });
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], "*");
  assert.equal(response.headers["access-control-allow-methods"], "GET,HEAD,OPTIONS");
  const openApi = JSON.parse(response.body as string) as { openapi: string; paths: Record<string, Record<string, unknown>> };
  assert.equal(openApi.openapi.startsWith("3.0"), true);
  assert.equal(typeof openApi.paths, "object");
  const tilesPath = openApi.paths["/v1/tiles/{z}/{x}/{y}.mvt"];
  assert.equal(tilesPath !== undefined, true);
  assert.equal(tilesPath?.get !== undefined, true);
  assert.equal(tilesPath?.head !== undefined, true);
  assert.equal(tilesPath?.options !== undefined, true);

  const rasterPath = openApi.paths["/v1/raster/{styleId}/{z}/{x}/{y}.png"];
  assert.equal(rasterPath !== undefined, true);
  assert.equal(rasterPath?.get !== undefined, true);
  assert.equal(rasterPath?.head !== undefined, true);
  assert.equal(rasterPath?.options !== undefined, true);

  const staticPath = openApi.paths["/v1/static/{styleId}/{lon},{lat},{zoom}/{width}x{height}.png"];
  assert.equal(staticPath !== undefined, true);
  assert.equal(staticPath?.get !== undefined, true);
  assert.equal(staticPath?.head !== undefined, true);
  assert.equal(staticPath?.options !== undefined, true);

  const docsPath = openApi.paths["/docs"];
  assert.equal(docsPath !== undefined, true);
  assert.equal(docsPath?.get !== undefined, true);
  assert.equal(docsPath?.head !== undefined, true);
  assert.equal(docsPath?.options !== undefined, true);

  const docsOpenApiPath = openApi.paths["/docs/openapi.json"];
  assert.equal(docsOpenApiPath !== undefined, true);
  assert.equal(docsOpenApiPath?.get !== undefined, true);
  assert.equal(docsOpenApiPath?.head !== undefined, true);
  assert.equal(docsOpenApiPath?.options !== undefined, true);

  const docsExamplesPath = openApi.paths["/docs/examples"];
  assert.equal(docsExamplesPath !== undefined, true);
  assert.equal(docsExamplesPath?.get !== undefined, true);
  assert.equal(docsExamplesPath?.head !== undefined, true);
  assert.equal(docsExamplesPath?.options !== undefined, true);

  assert.equal(openApi.paths["/admin/ingest"] === undefined, true);
  assert.equal(openApi.paths["/admin/projects"] === undefined, true);

  const styleJsonPath = openApi.paths["/v1/styles/{styleId}/style.json"];
  assert.equal(styleJsonPath !== undefined, true);
  assert.equal(styleJsonPath?.get !== undefined, true);
  assert.equal(styleJsonPath?.head !== undefined, true);
  assert.equal(styleJsonPath?.options !== undefined, true);

  const healthPath = openApi.paths["/v1/health"];
  assert.equal(healthPath !== undefined, true);
  assert.equal(healthPath?.get !== undefined, true);
  assert.equal(healthPath?.head !== undefined, true);

  const head = await docsOpenApiRoute({ method: "HEAD", path: "/docs/openapi.json" });
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers["access-control-allow-origin"], "*");
  assert.equal(head.headers["access-control-allow-methods"], "GET,HEAD,OPTIONS");
});

test("examples route resolves known styleId from published styles", async (): Promise<void> => {
  const style = createStyleVersion("docs-style", {
    version: 8,
    sources: {
      map: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
  });
  publishStyleVersion("docs-style", style.id);

  const response = await docsExamplesRoute({ method: "GET", path: "/docs/examples" });
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], "*");
  assert.equal(response.headers["access-control-allow-methods"], "GET,HEAD,OPTIONS");
  const examples = JSON.parse(response.body as string) as {
    quickstart: Array<{ name: string; description: string; url: string }>;
    mapLibre: Array<{ name: string; description: string; url: string }>;
    leaflet: Array<{ name: string; description: string; url: string }>;
    raster: Array<{ name: string; description: string; url: string }>;
    staticMaps: Array<{ name: string; description: string; url: string }>;
  };
  assert.equal(examples.quickstart.length > 0, true);
  assert.equal(examples.mapLibre.length > 0, true);
  assert.equal(examples.leaflet.length > 0, true);
  assert.equal(examples.raster.length > 0, true);
  assert.equal(examples.staticMaps.length > 0, true);
  assert.equal(examples.quickstart.some((entry) => entry.url.includes("YOUR_TOKEN")), true);
  assert.equal(examples.quickstart.some((entry) => entry.description.includes("Authorization")), true);
  const hasHeaderAuthExample = examples.quickstart.some((entry) => entry.url.endsWith("/v1/tiles/2/2/3.mvt") && entry.description.includes("Authorization"));
  assert.equal(hasHeaderAuthExample, true);
  for (const entry of examples.leaflet) {
    assert.equal(entry.url.includes("access_token=YOUR_TOKEN"), true);
  }
  assert.equal(examples.leaflet.some((entry) => entry.url.includes("/v1/raster/docs-style/")), true);
  assert.equal(examples.mapLibre.some((entry) => entry.url.includes("/v1/styles/docs-style/style.json")), true);
  assert.equal(examples.raster.some((entry) => entry.url.includes("/v1/raster/docs-style/")), true);
  assert.equal(examples.staticMaps.some((entry) => entry.url.includes("/v1/static/docs-style/")), true);
});

test("docs-site service returns defensive copies", (): void => {
  const openApi = getOpenApiJson();
  const originalSummary = openApi.paths["/docs"]?.get?.summary ?? "";
  Reflect.set(openApi.paths["/docs"]?.get ?? {}, "summary", "mutated-summary");
  const reloadedOpenApi = getOpenApiJson();
  assert.equal(reloadedOpenApi.paths["/docs"]?.get?.summary, originalSummary);

  const examples = getExamples();
  const originalQuickstartName = examples.quickstart[0]?.name ?? "";
  Reflect.set(examples.quickstart[0] ?? {}, "name", "mutated-example");
  const reloadedExamples = getExamples();
  assert.equal(reloadedExamples.quickstart[0]?.name, originalQuickstartName);
});
