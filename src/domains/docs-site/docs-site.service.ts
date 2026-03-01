import type {
  DocsIndex,
  ExampleBundle,
  OpenApiDocument,
  OpenApiRoute,
} from "./types";
import { listStyles } from "../styles/styles.service";

const quickstartTiles: ReadonlyArray<OpenApiRoute> = [
  {
    method: "GET",
    path: "/v1/tiles/{z}/{x}/{y}.mvt",
    summary: "Vector tile endpoint (GET/HEAD/OPTIONS)",
  },
  {
    method: "HEAD",
    path: "/v1/tiles/{z}/{x}/{y}.mvt",
    summary: "Vector tile endpoint (GET/HEAD/OPTIONS)",
  },
  {
    method: "OPTIONS",
    path: "/v1/tiles/{z}/{x}/{y}.mvt",
    summary: "Vector tile CORS preflight",
  },
  {
    method: "GET",
    path: "/v1/tiles/metadata",
    summary: "Tile metadata endpoint",
  },
  {
    method: "HEAD",
    path: "/v1/tiles/metadata",
    summary: "Tile metadata endpoint",
  },
  {
    method: "OPTIONS",
    path: "/v1/tiles/metadata",
    summary: "Tile metadata CORS preflight",
  },
];

const styleRoutes: ReadonlyArray<OpenApiRoute> = [
  {
    method: "HEAD",
    path: "/v1/styles",
    summary: "List published styles",
  },
  {
    method: "OPTIONS",
    path: "/v1/styles",
    summary: "Style list CORS preflight",
  },
  {
    method: "GET",
    path: "/v1/styles",
    summary: "List published styles",
  },
  {
    method: "GET",
    path: "/v1/styles/{styleId}/style.json",
    summary: "Style JSON lookup",
  },
  {
    method: "HEAD",
    path: "/v1/styles/{styleId}/style.json",
    summary: "Style JSON lookup",
  },
  {
    method: "OPTIONS",
    path: "/v1/styles/{styleId}/style.json",
    summary: "Style JSON CORS preflight",
  },
  {
    method: "GET",
    path: "/v1/styles/{styleId}/sprites/{name}.png",
    summary: "Sprite image lookup",
  },
  {
    method: "GET",
    path: "/v1/styles/{styleId}/sprites/{name}@2x.png",
    summary: "High-DPI sprite image lookup",
  },
  {
    method: "GET",
    path: "/v1/styles/{styleId}/sprites/{name}.json",
    summary: "Sprite metadata lookup",
  },
  {
    method: "GET",
    path: "/v1/styles/{styleId}/sprites/{name}@2x.json",
    summary: "High-DPI sprite metadata lookup",
  },
  {
    method: "HEAD",
    path: "/v1/styles/{styleId}/sprites/{name}.png",
    summary: "Sprite image lookup",
  },
  {
    method: "OPTIONS",
    path: "/v1/styles/{styleId}/sprites/{name}.png",
    summary: "Sprite image CORS preflight",
  },
  {
    method: "HEAD",
    path: "/v1/styles/{styleId}/sprites/{name}@2x.png",
    summary: "High-DPI sprite image lookup",
  },
  {
    method: "OPTIONS",
    path: "/v1/styles/{styleId}/sprites/{name}.json",
    summary: "Sprite metadata CORS preflight",
  },
  {
    method: "HEAD",
    path: "/v1/styles/{styleId}/sprites/{name}.json",
    summary: "Sprite metadata lookup",
  },
  {
    method: "OPTIONS",
    path: "/v1/styles/{styleId}/sprites/{name}@2x.png",
    summary: "High-DPI sprite image CORS preflight",
  },
  {
    method: "HEAD",
    path: "/v1/styles/{styleId}/sprites/{name}@2x.json",
    summary: "High-DPI sprite metadata lookup",
  },
  {
    method: "OPTIONS",
    path: "/v1/styles/{styleId}/sprites/{name}@2x.json",
    summary: "High-DPI sprite metadata CORS preflight",
  },
  {
    method: "GET",
    path: "/v1/fonts/{fontstack}/{range}.pbf",
    summary: "Font glyph lookup",
  },
  {
    method: "HEAD",
    path: "/v1/fonts/{fontstack}/{range}.pbf",
    summary: "Font glyph lookup",
  },
  {
    method: "OPTIONS",
    path: "/v1/fonts/{fontstack}/{range}.pbf",
    summary: "Font glyph CORS preflight",
  },
];

const rasterRoutes: ReadonlyArray<OpenApiRoute> = [
  {
    method: "GET",
    path: "/v1/raster/{styleId}/{z}/{x}/{y}.png",
    summary: "Rendered raster tile endpoint",
  },
  {
    method: "GET",
    path: "/v1/raster/{styleId}/{z}/{x}/{y}.webp",
    summary: "Rendered raster tile endpoint (WebP)",
  },
  {
    method: "HEAD",
    path: "/v1/raster/{styleId}/{z}/{x}/{y}.png",
    summary: "Rendered raster tile endpoint",
  },
  {
    method: "OPTIONS",
    path: "/v1/raster/{styleId}/{z}/{x}/{y}.png",
    summary: "Rendered raster tile CORS preflight",
  },
  {
    method: "HEAD",
    path: "/v1/raster/{styleId}/{z}/{x}/{y}.webp",
    summary: "Rendered raster tile endpoint (WebP)",
  },
  {
    method: "OPTIONS",
    path: "/v1/raster/{styleId}/{z}/{x}/{y}.webp",
    summary: "Rendered raster tile CORS preflight (WebP)",
  },
  {
    method: "GET",
    path: "/v1/static/{styleId}/{lon},{lat},{zoom}/{width}x{height}.png",
    summary: "Static map endpoint",
  },
  {
    method: "GET",
    path: "/v1/static/{styleId}/{lon},{lat},{zoom}/{width}x{height}.webp",
    summary: "Static map endpoint (WebP)",
  },
  {
    method: "HEAD",
    path: "/v1/static/{styleId}/{lon},{lat},{zoom}/{width}x{height}.png",
    summary: "Static map endpoint",
  },
  {
    method: "OPTIONS",
    path: "/v1/static/{styleId}/{lon},{lat},{zoom}/{width}x{height}.png",
    summary: "Static map CORS preflight",
  },
  {
    method: "HEAD",
    path: "/v1/static/{styleId}/{lon},{lat},{zoom}/{width}x{height}.webp",
    summary: "Static map endpoint (WebP)",
  },
  {
    method: "OPTIONS",
    path: "/v1/static/{styleId}/{lon},{lat},{zoom}/{width}x{height}.webp",
    summary: "Static map CORS preflight (WebP)",
  },
];

const docsRoutes: ReadonlyArray<OpenApiRoute> = [
  {
    method: "GET",
    path: "/v1/health",
    summary: "Public health check",
  },
  {
    method: "HEAD",
    path: "/v1/health",
    summary: "Public health check",
  },
  {
    method: "GET",
    path: "/docs",
    summary: "Public documentation index",
  },
  {
    method: "HEAD",
    path: "/docs",
    summary: "Public documentation index",
  },
  {
    method: "OPTIONS",
    path: "/docs",
    summary: "Documentation index CORS preflight",
  },
  {
    method: "GET",
    path: "/docs/openapi.json",
    summary: "OpenAPI reference",
  },
  {
    method: "HEAD",
    path: "/docs/openapi.json",
    summary: "OpenAPI reference",
  },
  {
    method: "OPTIONS",
    path: "/docs/openapi.json",
    summary: "OpenAPI reference CORS preflight",
  },
  {
    method: "GET",
    path: "/docs/examples",
    summary: "Example payloads",
  },
  {
    method: "HEAD",
    path: "/docs/examples",
    summary: "Example payloads",
  },
  {
    method: "OPTIONS",
    path: "/docs/examples",
    summary: "Example payloads CORS preflight",
  },
];

const routes = [...quickstartTiles, ...styleRoutes, ...rasterRoutes, ...docsRoutes];

function buildPaths(entries: ReadonlyArray<OpenApiRoute>): OpenApiDocument["paths"] {
  const out: OpenApiDocument["paths"] = {};
  for (const entry of entries) {
    const pathMethods = out[entry.path];
    if (pathMethods === undefined) {
      out[entry.path] = {
        [entry.method.toLowerCase()]: {
          summary: entry.summary,
        },
      };
      continue;
    }
    (pathMethods as Record<string, { summary: string }>)[entry.method.toLowerCase()] = {
      summary: entry.summary,
    };
  }
  return out;
}

function getDefaultStyleId(): string {
  const published = listStyles().filter((entry) => entry.publishedVersionId);
  const first = published[0];
  return first?.id ?? "basic";
}

function replaceStylePlaceholders(url: string, styleId: string): string {
  return url
    .replace("/v1/styles/basic/", `/v1/styles/${styleId}/`)
    .replace("/v1/raster/basic/", `/v1/raster/${styleId}/`)
    .replace("/v1/static/basic/", `/v1/static/${styleId}/`);
}

const quickstartExamples = {
  vector: [
    {
      name: "Fetch a vector tile",
      description: "Replace path parameters and access token before sending.",
      url: "/v1/tiles/2/2/3.mvt?access_token=YOUR_TOKEN",
    },
    {
      name: "Use Authorization header",
      description: "Send the token in `Authorization: Bearer` while keeping query placeholder values out.",
      url: "/v1/tiles/2/2/3.mvt",
    },
  ],
  mapLibre: [
    {
      name: "Load a style in MapLibre GL JS",
      description: "Use your published style endpoint in a map constructor.",
      url: "/v1/styles/basic/style.json?access_token=YOUR_TOKEN",
    },
  ],
  leaflet: [
    {
      name: "Raster source example for Leaflet",
      description: "Use raster tiles as a custom layer source URL.",
      url: "/v1/raster/basic/2/2/3.png?access_token=YOUR_TOKEN",
    },
  ],
  raster: [
    {
      name: "Fetch a raster tile",
      description: "PNG output for map client tile layers.",
      url: "/v1/raster/basic/2/2/3.png?access_token=YOUR_TOKEN",
    },
    {
      name: "Fetch a raster tile (WebP)",
      description: "WebP output for browser-friendly output.",
      url: "/v1/raster/basic/2/2/3.webp?access_token=YOUR_TOKEN",
    },
  ],
  staticMaps: [
    {
      name: "Render a static map",
      description: "PNG static image around lon/lat at zoom.",
      url: "/v1/static/basic/-122.4194,37.7749,12/640x480.png?access_token=YOUR_TOKEN",
    },
    {
      name: "Render a static map (WebP)",
      description: "WebP static image around lon/lat at zoom.",
      url: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp?access_token=YOUR_TOKEN",
    },
  ],
};

const openApiDocument: OpenApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Tileserver V1 API",
    version: "1.0.0",
  },
  paths: buildPaths(routes),
};

export function getDocsIndex(): DocsIndex {
  return {
    title: "Tileserver Documentation",
    version: "1.0.0",
    baseUrl: "/",
    sections: [
      {
        id: "quickstart",
        title: "Quickstart",
        body: "Use project access tokens via `Authorization: Bearer YOUR_TOKEN` or `?access_token=YOUR_TOKEN`.",
      },
      {
        id: "auth",
        title: "Authentication",
        body: "Project-scoped tokens are required for private requests. Use `Authorization: Bearer YOUR_TOKEN` or `?access_token=YOUR_TOKEN`.",
      },
      {
        id: "examples",
        title: "Examples",
        body: "Use `access_token` query parameter or `Authorization: Bearer` header with all protected endpoints.",
      },
      {
        id: "limits",
        title: "Limits",
        body: "Project quotas are enforced before raster/vector processing. 429 indicates quota/rate limit.",
      },
      {
        id: "health",
        title: "Health",
        body: "GET /v1/health returns service liveness for external health checks.",
      },
    ],
  };
}

export function getOpenApiJson(): OpenApiDocument {
  return openApiDocument;
}

export function getExamples(): ExampleBundle {
  const styleId = getDefaultStyleId();
  const resolvedMapLibreExamples = quickstartExamples.mapLibre.map((example) => ({
    ...example,
    url: replaceStylePlaceholders(example.url, styleId),
  }));
  const resolvedLeafletExamples = quickstartExamples.leaflet.map((example) => ({
    ...example,
    url: replaceStylePlaceholders(example.url, styleId),
  }));
  const resolvedRasterExamples = quickstartExamples.raster.map((example) => ({
    ...example,
    url: replaceStylePlaceholders(example.url, styleId),
  }));
  const resolvedStaticExamples = quickstartExamples.staticMaps.map((example) => ({
    ...example,
    url: replaceStylePlaceholders(example.url, styleId),
  }));
  return {
    quickstart: quickstartExamples.vector,
    mapLibre: resolvedMapLibreExamples,
    leaflet: resolvedLeafletExamples,
    raster: resolvedRasterExamples,
    staticMaps: resolvedStaticExamples,
  };
}
