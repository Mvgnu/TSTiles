import { strict as assert } from "node:assert";
import { prisma } from "../../../config/db";
import { docsIndexRoute } from "../routes/docs-index-route";
import { docsOpenApiRoute } from "../routes/openapi-route";
import { docsExamplesRoute } from "../routes/examples-route";
import { renderDocsGuideHtml } from "../routes/html";
import { createStyleVersion, publishStyleVersion } from "../../styles/styles.service";
import { getDocsGuidePage, getExamples, getOpenApiJson } from "../docs-site.service";

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

  const guideJson = await docsIndexRoute({
    method: "GET",
    path: "/docs/quickstart",
    headers: {
      accept: "application/json",
    },
  });
  assert.equal(guideJson.status, 200);
  assert.equal(guideJson.headers["content-type"], "application/json");
  const guidePayload = JSON.parse(guideJson.body as string) as {
    slug: string;
    sections: Array<{ id: string }>;
    ctas: Array<{ href: string; action?: string }>;
  };
  assert.equal(guidePayload.slug, "quickstart");
  assert.equal(Array.isArray(guidePayload.sections), true);
  assert.equal(guidePayload.sections.length > 0, true);
  assert.equal(Array.isArray(guidePayload.ctas), true);
  assert.equal(guidePayload.ctas.some((entry) => entry.href === "/sign-up?next=%2Fapp%2Fprojects%2Fnew"), true);
  assert.equal(
    guidePayload.ctas.some(
      (entry) => entry.href === "/sign-up?next=%2Fapp%2Fprojects%2Fnew" && entry.action === "create-project",
    ),
    true,
  );
});

test("docs routes serve human-facing html guides for browsers and guide paths", async (): Promise<void> => {
  const rootHtml = await docsIndexRoute({
    method: "GET",
    path: "/docs",
    headers: {
      accept: "text/html,application/xhtml+xml",
    },
  });
  assert.equal(rootHtml.status, 200);
  assert.equal(rootHtml.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((rootHtml.body ?? "").includes("Tileserver Docs"), true);
  assert.equal((rootHtml.body ?? "").includes("universal-header"), true);
  assert.equal((rootHtml.body ?? "").includes("Create project"), true);
  assert.equal((rootHtml.body ?? "").includes("Open dashboard"), true);
  assert.equal((rootHtml.body ?? "").includes("Get API key"), true);
  assert.equal((rootHtml.body ?? "").includes("/app-api/session"), true);
  assert.equal((rootHtml.body ?? "").includes("catch (_error)"), true);
  assert.equal((rootHtml.body ?? "").includes("hasSessionCookie"), false);
  assert.equal((rootHtml.body ?? "").includes("/app/projects/new"), true);
  assert.equal((rootHtml.body ?? "").includes("/sign-up?next=%2Fapp%2Fprojects%2Fnew"), true);
  assert.equal((rootHtml.body ?? "").includes("Issue API key"), true);
  assert.equal((rootHtml.body ?? "").includes("/security"), true);
  assert.equal((rootHtml.body ?? "").includes("/status"), true);
  assert.equal((rootHtml.body ?? "").includes("/legal/dpa"), true);
  assert.equal((rootHtml.body ?? "").includes("Security contact"), true);
  assert.equal((rootHtml.body ?? "").includes("mailto:security@tstiles.com"), true);

  const quickstartHtml = await docsIndexRoute({
    method: "GET",
    path: "/docs/quickstart",
    headers: {
      accept: "text/html",
    },
  });
  assert.equal(quickstartHtml.status, 200);
  assert.equal(quickstartHtml.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((quickstartHtml.body ?? "").includes("Quickstart"), true);
  assert.equal((quickstartHtml.body ?? "").includes("docs-hero-button"), true);
  assert.equal((quickstartHtml.body ?? "").includes("background: #111111;"), true);
  assert.equal((quickstartHtml.body ?? "").includes("color: #111111;"), true);
  assert.equal((quickstartHtml.body ?? "").includes("Copy snippet"), true);
  assert.equal((quickstartHtml.body ?? "").includes("Query token"), true);
  assert.equal((quickstartHtml.body ?? "").includes("Header token"), true);
  assert.equal((quickstartHtml.body ?? "").includes("data-docs-code-card"), true);
  assert.equal((quickstartHtml.body ?? "").includes("catch (_error)"), true);
  assert.equal((quickstartHtml.body ?? "").includes("return true;"), true);
  assert.equal((quickstartHtml.body ?? "").includes('copyButton.textContent = copied ? "Copied" : "Copy failed";'), true);
  assert.equal((quickstartHtml.body ?? "").includes("/sign-up?next=%2Fapp%2Fprojects%2Fnew"), true);
  assert.equal((quickstartHtml.body ?? "").includes('data-docs-action="create-project"'), true);
  assert.equal((quickstartHtml.body ?? "").includes("Sign in or create a workspace, then issue a project token for API delivery."), true);
  assert.equal((quickstartHtml.body ?? "").includes("Do not paste product-session cookies, account credentials, or enterprise identity headers into tile, style, raster, or static requests."), true);

  const quickstartHtmlWithMixedCaseAccept = await docsIndexRoute({
    method: "GET",
    path: "/docs/quickstart",
    headers: {
      Accept: "text/html",
    },
  });
  assert.equal(quickstartHtmlWithMixedCaseAccept.status, 200);
  assert.equal(quickstartHtmlWithMixedCaseAccept.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((quickstartHtmlWithMixedCaseAccept.body ?? "").includes("Quickstart"), true);

  const quickstartHtmlWithUppercaseAcceptValue = await docsIndexRoute({
    method: "GET",
    path: "/docs/quickstart",
    headers: {
      accept: "TEXT/HTML,APPLICATION/XHTML+XML",
    },
  });
  assert.equal(quickstartHtmlWithUppercaseAcceptValue.status, 200);
  assert.equal(quickstartHtmlWithUppercaseAcceptValue.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((quickstartHtmlWithUppercaseAcceptValue.body ?? "").includes("Quickstart"), true);

  const quickstartHtmlWithXhtmlAccept = await docsIndexRoute({
    method: "GET",
    path: "/docs/quickstart",
    headers: {
      accept: "application/xhtml+xml",
    },
  });
  assert.equal(quickstartHtmlWithXhtmlAccept.status, 200);
  assert.equal(quickstartHtmlWithXhtmlAccept.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((quickstartHtmlWithXhtmlAccept.body ?? "").includes("Quickstart"), true);

  const examplesHtml = await docsExamplesRoute({
    method: "GET",
    path: "/docs/examples",
    headers: {
      accept: "text/html",
    },
  });
  assert.equal(examplesHtml.status, 200);
  assert.equal(examplesHtml.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((examplesHtml.body ?? "").includes("Copy-first examples"), true);
  assert.equal((examplesHtml.body ?? "").includes("MapLibre browser bootstrap"), true);
  assert.equal((examplesHtml.body ?? "").includes("Browser clients should prefer query-token auth"), true);
  assert.equal((examplesHtml.body ?? "").includes("MapLibre quickstart"), true);
  assert.equal((examplesHtml.body ?? "").includes("Raster source example for Leaflet"), true);
  assert.equal((examplesHtml.body ?? "").includes("/sign-up?next=%2Fapp%2Fprojects%2Fnew"), true);
  assert.equal((examplesHtml.body ?? "").includes('data-docs-action="create-project"'), true);

  const examplesHtmlWithMixedCaseAccept = await docsExamplesRoute({
    method: "GET",
    path: "/docs/examples",
    headers: {
      Accept: "text/html",
    },
  });
  assert.equal(examplesHtmlWithMixedCaseAccept.status, 200);
  assert.equal(examplesHtmlWithMixedCaseAccept.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((examplesHtmlWithMixedCaseAccept.body ?? "").includes("Copy-first examples"), true);

  const examplesHtmlWithUppercaseAcceptValue = await docsExamplesRoute({
    method: "GET",
    path: "/docs/examples",
    headers: {
      accept: "TEXT/HTML",
    },
  });
  assert.equal(examplesHtmlWithUppercaseAcceptValue.status, 200);
  assert.equal(examplesHtmlWithUppercaseAcceptValue.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((examplesHtmlWithUppercaseAcceptValue.body ?? "").includes("Copy-first examples"), true);

  const examplesHtmlWithXhtmlAccept = await docsExamplesRoute({
    method: "GET",
    path: "/docs/examples",
    headers: {
      accept: "application/xhtml+xml",
    },
  });
  assert.equal(examplesHtmlWithXhtmlAccept.status, 200);
  assert.equal(examplesHtmlWithXhtmlAccept.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((examplesHtmlWithXhtmlAccept.body ?? "").includes("Copy-first examples"), true);

  const apiHtml = await docsIndexRoute({
    method: "GET",
    path: "/docs/api",
    headers: {
      accept: "text/html",
    },
  });
  assert.equal(apiHtml.status, 200);
  assert.equal(apiHtml.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((apiHtml.body ?? "").includes("API Reference"), true);
  assert.equal((apiHtml.body ?? "").includes("Authentication modes"), true);
  assert.equal((apiHtml.body ?? "").includes("query-token auth"), true);
  assert.equal((apiHtml.body ?? "").includes("Limits and 429 behavior"), true);
  assert.equal((apiHtml.body ?? "").includes("A `429` response means"), true);

  const maplibreHtml = await docsIndexRoute({
    method: "GET",
    path: "/docs/maplibre",
    headers: {
      accept: "text/html",
    },
  });
  assert.equal(maplibreHtml.status, 200);
  assert.equal((maplibreHtml.body ?? "").includes("Get API key"), true);
  assert.equal((maplibreHtml.body ?? "").includes('data-docs-action="get-api-key"'), true);

  const authenticationHtml = await docsIndexRoute({
    method: "GET",
    path: "/docs/authentication",
    headers: {
      accept: "text/html",
    },
  });
  assert.equal(authenticationHtml.status, 200);
  assert.equal((authenticationHtml.body ?? "").includes("Product access vs delivery auth"), true);
  assert.equal((authenticationHtml.body ?? "").includes("uses first-party email/password sessions, email verification, and recovery flows"), true);
  assert.equal((authenticationHtml.body ?? "").includes("Enterprise deployments may place an identity bridge in front of the product shell"), true);
  assert.equal((authenticationHtml.body ?? "").includes("Do not reuse app-session cookies, account passwords, or enterprise identity headers as delivery tokens."), true);
  assert.equal((authenticationHtml.body ?? "").includes("Get API key"), true);
  assert.equal((authenticationHtml.body ?? "").includes('data-docs-action="get-api-key"'), true);
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

  const guideGet = await docsIndexRoute({
    method: "GET",
    path: "/docs/authentication",
    headers: {
      accept: "application/json",
    },
  });
  const guideHead = await docsIndexRoute({
    method: "HEAD",
    path: "/docs/authentication",
    headers: {
      accept: "application/json",
    },
  });
  assert.equal(guideHead.status, 200);
  assert.equal(guideHead.body, undefined);
  assert.equal(guideHead.headers["content-type"], "application/json");
  assert.equal(guideHead.headers["content-length"], guideGet.headers["content-length"]);

  const malformedIndex = await docsIndexRoute(
    null as unknown as Parameters<typeof docsIndexRoute>[0],
  );
  assert.equal(malformedIndex.status, 400);
  assert.equal((malformedIndex.body ?? "").includes("DOCS_BAD_REQUEST"), true);

  const malformedExamples = await docsExamplesRoute({
    method: "GET",
    path: 42 as unknown as string,
  });
  assert.equal(malformedExamples.status, 400);

  const malformedOpenApi = await docsOpenApiRoute({
    method: 42 as unknown as "GET",
    path: "/docs/openapi.json",
  });
  assert.equal(malformedOpenApi.status, 400);

  const malformedIndexHeaders = await docsIndexRoute({
    method: "GET",
    path: "/docs",
    headers: {
      accept: 42 as unknown as string,
    },
  });
  assert.equal(malformedIndexHeaders.status, 400);

  const malformedExamplesHeaders = await docsExamplesRoute({
    method: "GET",
    path: "/docs/examples",
    headers: {
      accept: 42 as unknown as string,
    },
  });
  assert.equal(malformedExamplesHeaders.status, 400);
});

test("docs html header variants remove query-token placeholders while preserving other query params", (): void => {
  const html = renderDocsGuideHtml({
    slug: "quickstart",
    title: "Header variant regression",
    summary: "Regression coverage",
    nav: [],
    sections: [
      {
        id: "query-shape",
        title: "Query shape",
        body: "Ensure auth toggles preserve unrelated query params.",
        codeExamples: [
          {
            label: "MapLibre",
            language: "js",
            code: 'new maplibregl.Map({\n  container: "map",\n  style: "/v1/styles/basic/style.json?draft=published&access_token=YOUR_TOKEN&lang=en#preview",\n});',
          },
          {
            label: "Raster curl",
            language: "bash",
            code: 'curl "/v1/raster/basic/2/2/3.png?format=png&access_token=YOUR_TOKEN&lang=en#preview" --output tile.png',
          },
          {
            label: "Direct URL",
            language: "text",
            code: "/v1/static/basic/-122.4194,37.7749,12/640x480.png?scale=2&access_token=YOUR_TOKEN&lang=en#preview",
          },
        ],
      },
    ],
    ctas: [],
  });

  assert.equal(html.includes('style: &quot;/v1/styles/basic/style.json?draft=published&amp;lang=en#preview&quot;'), true);
  assert.equal(html.includes('curl -H &quot;Authorization: Bearer YOUR_TOKEN&quot; &quot;/v1/raster/basic/2/2/3.png?format=png&amp;lang=en#preview&quot; --output tile.png'), true);
  assert.equal(html.includes('curl -H &quot;Authorization: Bearer YOUR_TOKEN&quot; &quot;/v1/static/basic/-122.4194,37.7749,12/640x480.png?scale=2&amp;lang=en#preview&quot;'), true);
  assert.equal(html.includes('data-header-code="curl -H &quot;Authorization: Bearer YOUR_TOKEN&quot; &quot;/v1/raster/basic/2/2/3.png?format=png&amp;access_token=YOUR_TOKEN&amp;lang=en#preview&quot; --output tile.png"'), false);
  assert.equal(html.includes('data-header-code="curl -H &quot;Authorization: Bearer YOUR_TOKEN&quot; &quot;/v1/static/basic/-122.4194,37.7749,12/640x480.png?scale=2&amp;access_token=YOUR_TOKEN&amp;lang=en#preview&quot;"'), false);
});

test("docs examples fail closed to the basic placeholder style when published-style lookup errors", async (): Promise<void> => {
  const originalFindMany = prisma.style.findMany.bind(prisma.style);
  (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = (async () => {
    throw new Error("style lookup unavailable");
  }) as typeof prisma.style.findMany;

  try {
    const examples = await getExamples();
    assert.equal(examples.mapLibre[0]?.url, "/v1/styles/basic/style.json?access_token=YOUR_TOKEN");
    assert.equal(examples.raster[0]?.url, "/v1/raster/basic/2/2/3.png?access_token=YOUR_TOKEN");
    assert.equal(examples.staticMaps[0]?.url, "/v1/static/basic/-122.4194,37.7749,12/640x480.png?access_token=YOUR_TOKEN");

    const guide = await getDocsGuidePage("quickstart");
    const maplibreCode = guide.sections.find((section) => section.id === "maplibre")?.codeExamples?.[0]?.code ?? "";
    assert.equal(maplibreCode.includes('/v1/styles/basic/style.json?access_token=YOUR_TOKEN'), true);
  } finally {
    (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = originalFindMany;
  }
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
  assert.equal(typeof badIndex.body, "string");

  const badIndexHead = await docsIndexRoute({ method: "HEAD", path: "/docs/wrong" });
  assert.equal(badIndexHead.status, 404);
  assert.equal(badIndexHead.headers["cache-control"], "no-store");
  assert.equal(badIndexHead.body, undefined);

  const badOpenApi = await docsOpenApiRoute({ method: "GET", path: "/docs/openapi" });
  assert.equal(badOpenApi.status, 404);
  assert.equal(badOpenApi.headers["cache-control"], "no-store");
  assert.equal(typeof badOpenApi.body, "string");

  const badOpenApiHead = await docsOpenApiRoute({ method: "HEAD", path: "/docs/openapi" });
  assert.equal(badOpenApiHead.status, 404);
  assert.equal(badOpenApiHead.headers["cache-control"], "no-store");
  assert.equal(badOpenApiHead.body, undefined);

  const badExamples = await docsExamplesRoute({ method: "OPTIONS", path: "/docs/examplez" });
  assert.equal(badExamples.status, 404);
  assert.equal(badExamples.headers["cache-control"], "no-store");
  assert.equal(typeof badExamples.body, "string");

  const badExamplesHead = await docsExamplesRoute({ method: "HEAD", path: "/docs/examplez" });
  assert.equal(badExamplesHead.status, 404);
  assert.equal(badExamplesHead.headers["cache-control"], "no-store");
  assert.equal(badExamplesHead.body, undefined);

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

  const badGuide = await docsIndexRoute({
    method: "GET",
    path: "/docs/not-a-guide",
    headers: {
      accept: "text/html",
    },
  });
  assert.equal(badGuide.status, 404);

  const malformedGuide = await docsIndexRoute({
    method: "GET",
    path: "/docs/%E0%A4%A",
    headers: {
      accept: "text/html",
    },
  });
  assert.equal(malformedGuide.status, 404);
  assert.equal(malformedGuide.headers["cache-control"], "no-store");
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

  const docsQuickstartPath = openApi.paths["/docs/quickstart"];
  assert.equal(docsQuickstartPath !== undefined, true);
  assert.equal(docsQuickstartPath?.get !== undefined, true);
  assert.equal(docsQuickstartPath?.head !== undefined, true);
  assert.equal(docsQuickstartPath?.options !== undefined, true);

  const docsAuthenticationPath = openApi.paths["/docs/authentication"];
  assert.equal(docsAuthenticationPath !== undefined, true);
  assert.equal(docsAuthenticationPath?.get !== undefined, true);
  assert.equal(docsAuthenticationPath?.head !== undefined, true);
  assert.equal(docsAuthenticationPath?.options !== undefined, true);

  const docsMapLibrePath = openApi.paths["/docs/maplibre"];
  assert.equal(docsMapLibrePath !== undefined, true);
  assert.equal(docsMapLibrePath?.get !== undefined, true);
  assert.equal(docsMapLibrePath?.head !== undefined, true);
  assert.equal(docsMapLibrePath?.options !== undefined, true);

  const docsRasterPath = openApi.paths["/docs/raster"];
  assert.equal(docsRasterPath !== undefined, true);
  assert.equal(docsRasterPath?.get !== undefined, true);
  assert.equal(docsRasterPath?.head !== undefined, true);
  assert.equal(docsRasterPath?.options !== undefined, true);

  const docsStaticMapsPath = openApi.paths["/docs/static-maps"];
  assert.equal(docsStaticMapsPath !== undefined, true);
  assert.equal(docsStaticMapsPath?.get !== undefined, true);
  assert.equal(docsStaticMapsPath?.head !== undefined, true);
  assert.equal(docsStaticMapsPath?.options !== undefined, true);

  const docsStylesPath = openApi.paths["/docs/styles"];
  assert.equal(docsStylesPath !== undefined, true);
  assert.equal(docsStylesPath?.get !== undefined, true);
  assert.equal(docsStylesPath?.head !== undefined, true);
  assert.equal(docsStylesPath?.options !== undefined, true);

  const docsApiPath = openApi.paths["/docs/api"];
  assert.equal(docsApiPath !== undefined, true);
  assert.equal(docsApiPath?.get !== undefined, true);
  assert.equal(docsApiPath?.head !== undefined, true);
  assert.equal(docsApiPath?.options !== undefined, true);

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
  const style = await createStyleVersion("docs-style", {
    version: 8,
    sources: {
      map: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#f8f6f0",
        },
      },
    ],
  });
  await publishStyleVersion("docs-style", style.id);

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
  assert.equal(examples.leaflet.some((entry) => entry.url.includes("/v1/raster/")), true);
  assert.equal(examples.mapLibre.some((entry) => entry.url.includes("/v1/styles/")), true);
  assert.equal(examples.raster.some((entry) => entry.url.includes("/v1/raster/")), true);
  assert.equal(examples.staticMaps.some((entry) => entry.url.includes("/v1/static/")), true);
  assert.equal(examples.mapLibre.some((entry) => entry.url.includes("{styleId}")), false);
});

test("docs examples and guides encode published renderable style ids in example URLs", async (): Promise<void> => {
  const styleId = "!! docs style encoded";
  const style = await createStyleVersion(styleId, {
    version: 8,
    sources: {
      map: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#f8f6f0",
        },
      },
    ],
  });
  await publishStyleVersion(styleId, style.id);

  const originalFindMany = prisma.style.findMany.bind(prisma.style);
  (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = ((async (...args: Parameters<typeof prisma.style.findMany>) => {
    if (args[0]?.orderBy) {
      return [
        {
          id: styleId,
          name: styleId,
          latestVersionId: style.id,
          publishedVersionId: style.id,
          createdAt: style.createdAt,
        },
      ];
    }
    return await originalFindMany(...args);
  }) as unknown) as typeof prisma.style.findMany;

  try {
    const examples = await getExamples();
    assert.equal(
      examples.mapLibre.some((entry) => entry.url.includes("/v1/styles/!!%20docs%20style%20encoded/style.json")),
      true,
    );
    assert.equal(
      examples.raster.some((entry) => entry.url.includes("/v1/raster/!!%20docs%20style%20encoded/")),
      true,
    );
    assert.equal(
      examples.staticMaps.some((entry) => entry.url.includes("/v1/static/!!%20docs%20style%20encoded/")),
      true,
    );

    const guide = await getDocsGuidePage("quickstart");
    const mapLibreCode = guide.sections.find((section) => section.id === "maplibre")?.codeExamples?.[0]?.code ?? "";
    assert.equal(mapLibreCode.includes("/v1/styles/!!%20docs%20style%20encoded/style.json"), true);
  } finally {
    (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = originalFindMany;
  }
});

test("docs examples skip malformed published style rows when selecting the default style id", async (): Promise<void> => {
  const version = await createStyleVersion("valid-docs-style", {
    version: 8,
    sources: {
      map: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#f8f6f0",
        },
      },
    ],
  });
  await publishStyleVersion("valid-docs-style", version.id);

  const originalFindMany = prisma.style.findMany.bind(prisma.style);
  (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = ((async (...args: Parameters<typeof prisma.style.findMany>) => {
    if (args[0]?.orderBy) {
      return [
        {
          id: "   ",
          name: "Broken Style",
          latestVersionId: "broken-v1",
          publishedVersionId: "broken-v1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "valid-docs-style",
          name: "Valid Docs Style",
          latestVersionId: "valid-docs-style-v1",
          publishedVersionId: "valid-docs-style-v1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ];
    }
    return await originalFindMany(...args);
  }) as unknown) as typeof prisma.style.findMany;

  try {
    const examples = await getExamples();
    assert.equal(examples.mapLibre[0]?.url, "/v1/styles/valid-docs-style/style.json?access_token=YOUR_TOKEN");
    assert.equal(examples.raster[0]?.url, "/v1/raster/valid-docs-style/2/2/3.png?access_token=YOUR_TOKEN");
    assert.equal(examples.staticMaps[0]?.url, "/v1/static/valid-docs-style/-122.4194,37.7749,12/640x480.png?access_token=YOUR_TOKEN");

    const guide = await getDocsGuidePage("quickstart");
    const mapLibreCode = guide.sections.find((section) => section.id === "maplibre")?.codeExamples?.[0]?.code ?? "";
    assert.equal(mapLibreCode.includes("/v1/styles/valid-docs-style/style.json?access_token=YOUR_TOKEN"), true);
  } finally {
    (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = originalFindMany;
  }
});

test("docs-site service returns defensive copies", async (): Promise<void> => {
  const openApi = getOpenApiJson();
  const originalSummary = openApi.paths["/docs"]?.get?.summary ?? "";
  Reflect.set(openApi.paths["/docs"]?.get ?? {}, "summary", "mutated-summary");
  const reloadedOpenApi = getOpenApiJson();
  assert.equal(reloadedOpenApi.paths["/docs"]?.get?.summary, originalSummary);

  const examples = await getExamples();
  const originalQuickstartName = examples.quickstart[0]?.name ?? "";
  Reflect.set(examples.quickstart[0] ?? {}, "name", "mutated-example");
  const reloadedExamples = await getExamples();
  assert.equal(reloadedExamples.quickstart[0]?.name, originalQuickstartName);

  const guide = await getDocsGuidePage("quickstart");
  const originalGuideTitle = guide.sections[0]?.title ?? "";
  const originalGuideAction = guide.ctas[1]?.action;
  Reflect.set(guide.sections[0] ?? {}, "title", "mutated-guide");
  Reflect.set(guide.ctas[1] ?? {}, "action", "open-dashboard");
  const reloadedGuide = await getDocsGuidePage("quickstart");
  assert.equal(reloadedGuide.sections[0]?.title, originalGuideTitle);
  assert.equal(reloadedGuide.ctas[1]?.action, originalGuideAction);
});

test("docs-site service rejects malformed direct guide slugs", async (): Promise<void> => {
  await assert.rejects(async () => {
    await getDocsGuidePage("missing" as unknown as Parameters<typeof getDocsGuidePage>[0]);
  }, /Unknown docs guide slug/);

  await assert.rejects(async () => {
    await getDocsGuidePage(42 as unknown as Parameters<typeof getDocsGuidePage>[0]);
  }, /Unknown docs guide slug/);
});
