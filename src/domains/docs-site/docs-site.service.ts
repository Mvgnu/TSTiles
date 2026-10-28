import type {
  DocsGuidePage,
  DocsGuideSection,
  DocsGuideSlug,
  DocsIndex,
  ExampleBundle,
  OpenApiDocument,
  OpenApiMethodKey,
  OpenApiPathMethods,
  OpenApiRoute,
} from "./types";
import { getStyle, listStyles } from "../styles/styles.service";

const docsGuideSlugs = new Set<DocsGuideSlug>([
  "index",
  "quickstart",
  "authentication",
  "maplibre",
  "raster",
  "static-maps",
  "styles",
  "api",
  "examples",
]);

function normalizeDocsGuideSlug(slug: unknown): DocsGuideSlug {
  if (typeof slug !== "string") {
    throw new Error("Unknown docs guide slug");
  }
  const normalized = slug.trim();
  if (!docsGuideSlugs.has(normalized as DocsGuideSlug)) {
    throw new Error(`Unknown docs guide slug: ${normalized}`);
  }
  return normalized as DocsGuideSlug;
}

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
  {
    method: "GET",
    path: "/docs/quickstart",
    summary: "Quickstart guide",
  },
  {
    method: "HEAD",
    path: "/docs/quickstart",
    summary: "Quickstart guide",
  },
  {
    method: "OPTIONS",
    path: "/docs/quickstart",
    summary: "Quickstart guide CORS preflight",
  },
  {
    method: "GET",
    path: "/docs/authentication",
    summary: "Authentication guide",
  },
  {
    method: "HEAD",
    path: "/docs/authentication",
    summary: "Authentication guide",
  },
  {
    method: "OPTIONS",
    path: "/docs/authentication",
    summary: "Authentication guide CORS preflight",
  },
  {
    method: "GET",
    path: "/docs/maplibre",
    summary: "MapLibre integration guide",
  },
  {
    method: "HEAD",
    path: "/docs/maplibre",
    summary: "MapLibre integration guide",
  },
  {
    method: "OPTIONS",
    path: "/docs/maplibre",
    summary: "MapLibre integration guide CORS preflight",
  },
  {
    method: "GET",
    path: "/docs/raster",
    summary: "Raster guide",
  },
  {
    method: "HEAD",
    path: "/docs/raster",
    summary: "Raster guide",
  },
  {
    method: "OPTIONS",
    path: "/docs/raster",
    summary: "Raster guide CORS preflight",
  },
  {
    method: "GET",
    path: "/docs/static-maps",
    summary: "Static maps guide",
  },
  {
    method: "HEAD",
    path: "/docs/static-maps",
    summary: "Static maps guide",
  },
  {
    method: "OPTIONS",
    path: "/docs/static-maps",
    summary: "Static maps guide CORS preflight",
  },
  {
    method: "GET",
    path: "/docs/styles",
    summary: "Styles guide",
  },
  {
    method: "HEAD",
    path: "/docs/styles",
    summary: "Styles guide",
  },
  {
    method: "OPTIONS",
    path: "/docs/styles",
    summary: "Styles guide CORS preflight",
  },
  {
    method: "GET",
    path: "/docs/api",
    summary: "API guide",
  },
  {
    method: "HEAD",
    path: "/docs/api",
    summary: "API guide",
  },
  {
    method: "OPTIONS",
    path: "/docs/api",
    summary: "API guide CORS preflight",
  },
];

const routes = [...quickstartTiles, ...styleRoutes, ...rasterRoutes, ...docsRoutes];

function buildPaths(entries: ReadonlyArray<OpenApiRoute>): OpenApiDocument["paths"] {
  const out: OpenApiDocument["paths"] = {};
  for (const entry of entries) {
    const method = toOpenApiMethod(entry.method);
    const pathMethods: OpenApiPathMethods = out[entry.path] ?? {};
    pathMethods[method] = {
      summary: entry.summary,
    };
    out[entry.path] = pathMethods;
  }
  return out;
}

function toOpenApiMethod(method: OpenApiRoute["method"]): OpenApiMethodKey {
  if (method === "GET") {
    return "get";
  }
  if (method === "HEAD") {
    return "head";
  }
  if (method === "OPTIONS") {
    return "options";
  }
  return "post";
}

async function getDefaultStyleId(): Promise<string> {
  try {
    const publishedStyleIds = (await listStyles())
      .filter((entry) => {
        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        const publishedVersionId = typeof entry.publishedVersionId === "string"
          ? entry.publishedVersionId.trim()
          : "";
        return id.length > 0 && publishedVersionId.length > 0;
      })
      .map((entry) => entry.id.trim())
      .sort((left, right) => left.localeCompare(right));
    const preferredStyleIds = ["style", "basic"].filter((styleId) => publishedStyleIds.includes(styleId));
    const candidateStyleIds = [
      ...preferredStyleIds,
      ...publishedStyleIds.filter((styleId) => !preferredStyleIds.includes(styleId)),
    ];
    for (const styleId of candidateStyleIds) {
      try {
        const document = await getStyle(styleId);
        if (Array.isArray(document.layers) && document.layers.length > 0) {
          return styleId;
        }
      } catch {
        // Skip styles that are listed as published but cannot produce a
        // browser-renderable MapLibre style document.
      }
    }
    return publishedStyleIds.includes("style") ? "style" : "basic";
  } catch {
    return "basic";
  }
}

function replaceStylePlaceholders(url: string, styleId: string): string {
  const encodedStyleId = encodeURIComponent(styleId);
  return url
    .replace("/v1/styles/basic/", `/v1/styles/${encodedStyleId}/`)
    .replace("/v1/raster/basic/", `/v1/raster/${encodedStyleId}/`)
    .replace("/v1/static/basic/", `/v1/static/${encodedStyleId}/`);
}

function cloneExamples(examples: ReadonlyArray<{ name: string; description: string; url: string }>): ExampleBundle["quickstart"] {
  return examples.map((entry) => ({
    name: entry.name,
    description: entry.description,
    url: entry.url,
  }));
}

function cloneOpenApiDocument(document: OpenApiDocument): OpenApiDocument {
  const clonedPaths: OpenApiDocument["paths"] = {};
  for (const [path, methods] of Object.entries(document.paths)) {
    const clonedMethods: OpenApiPathMethods = {};
    if (methods.get) {
      clonedMethods.get = { summary: methods.get.summary };
    }
    if (methods.head) {
      clonedMethods.head = { summary: methods.head.summary };
    }
    if (methods.options) {
      clonedMethods.options = { summary: methods.options.summary };
    }
    if (methods.post) {
      clonedMethods.post = { summary: methods.post.summary };
    }
    clonedPaths[path] = clonedMethods;
  }
  return {
    openapi: document.openapi,
    info: {
      title: document.info.title,
      version: document.info.version,
    },
    paths: clonedPaths,
  };
}

function cloneGuideSection(section: DocsGuideSection): DocsGuideSection {
  return {
    id: section.id,
    title: section.title,
    body: section.body,
    callout: section.callout,
    codeExamples: section.codeExamples?.map((example) => ({
      label: example.label,
      language: example.language,
      code: example.code,
    })),
  };
}

function cloneGuidePage(page: DocsGuidePage): DocsGuidePage {
  return {
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    nav: page.nav.map((item) => ({
      slug: item.slug,
      label: item.label,
      href: item.href,
    })),
    sections: page.sections.map((section) => cloneGuideSection(section)),
    ctas: page.ctas.map((cta) => ({
      label: cta.label,
      href: cta.href,
      action: cta.action,
    })),
  };
}

const quickstartExamples = {
  vector: [
    {
      name: "Fetch a vector tile",
      description: "Replace path parameters and access token before sending. Browser clients should prefer query-token auth for CORS preflight compatibility.",
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

const docsGuideNav: ReadonlyArray<DocsGuidePage["nav"][number]> = [
  { slug: "index", label: "Overview", href: "/docs" },
  { slug: "quickstart", label: "Quickstart", href: "/docs/quickstart" },
  { slug: "authentication", label: "Authentication", href: "/docs/authentication" },
  { slug: "maplibre", label: "MapLibre", href: "/docs/maplibre" },
  { slug: "raster", label: "Raster", href: "/docs/raster" },
  { slug: "static-maps", label: "Static Maps", href: "/docs/static-maps" },
  { slug: "styles", label: "Styles", href: "/docs/styles" },
  { slug: "api", label: "API", href: "/docs/api" },
  { slug: "examples", label: "Examples", href: "/docs/examples" },
];

function codeBlock(label: string, language: string, code: string): DocsGuideSection["codeExamples"] {
  return [{ label, language, code }];
}

async function buildGuidePages(): Promise<Readonly<Record<DocsGuideSlug, DocsGuidePage>>> {
  const examples = await getExamples();
  const openApi = getOpenApiJson();
  const styleExample = examples.mapLibre[0]?.url ?? "/v1/styles/basic/style.json?access_token=YOUR_TOKEN";
  const rasterExample = examples.raster[0]?.url ?? "/v1/raster/basic/2/2/3.png?access_token=YOUR_TOKEN";
  const staticExample = examples.staticMaps[0]?.url ?? "/v1/static/basic/-122.4194,37.7749,12/640x480.png?access_token=YOUR_TOKEN";
  const quickstartTile = examples.quickstart[0]?.url ?? "/v1/tiles/2/2/3.mvt?access_token=YOUR_TOKEN";
  const apiReferenceSummary = Object.entries(openApi.paths)
    .slice(0, 6)
    .map(([path, methods]) => {
      const methodList = Object.keys(methods).map((entry) => entry.toUpperCase()).join(", ");
      return `${methodList} ${path}`;
    })
    .join("\n");

  return {
    index: {
      slug: "index",
      title: "Tileserver Docs",
      summary: "Developer-facing docs for tiles, styles, raster, and static maps.",
      nav: docsGuideNav,
      sections: [
        {
          id: "overview",
          title: "What you can ship",
          body: "This service gives you vector tiles, hosted styles, raster tiles, and static maps behind project-scoped credentials. The main path to success is: create a project, copy a snippet, then load a map.",
        },
        {
          id: "quick-links",
          title: "Start here",
          body: "Use Quickstart if you want the shortest route to a working map. Use Authentication if you need to choose between browser query-token auth and server-side Authorization headers.",
          callout: "Browser clients should prefer `?access_token=` URLs to avoid cross-origin preflight complications.",
        },
      ],
      ctas: [
        { label: "Open Quickstart", href: "/docs/quickstart" },
        { label: "Create Project", href: "/sign-up?next=%2Fapp%2Fprojects%2Fnew", action: "create-project" },
      ],
    },
    quickstart: {
      slug: "quickstart",
      title: "Quickstart",
      summary: "From zero to a working map with one project token and one style URL.",
      nav: docsGuideNav,
      sections: [
        {
          id: "steps",
          title: "1. Create a project",
          body: "Projects issue scoped delivery tokens and hold endpoint settings. Product sign-in uses the first-party account flow for the `/app` shell, while the first successful map integration should come directly after project creation with a project token.",
          callout: "Sign in or create a workspace, then issue a project token for API delivery. Do not paste product-session cookies, account credentials, or enterprise identity headers into tile, style, raster, or static requests.",
        },
        {
          id: "maplibre",
          title: "2. Load a style in MapLibre",
          body: "Use a published style URL with your token in the query string. That keeps browser integration simple and matches the customer-safe snippets exposed in the app.",
          codeExamples: codeBlock(
            "MapLibre",
            "js",
            `import maplibregl from "maplibre-gl";\n\nnew maplibregl.Map({\n  container: "map",\n  style: "${styleExample}",\n  center: [10.7522, 59.9139],\n  zoom: 5,\n});`,
          ),
        },
        {
          id: "vector",
          title: "3. Fetch a tile directly",
          body: "Direct tile requests are useful for debugging auth and verifying that your project token is active.",
          codeExamples: codeBlock(
            "curl",
            "bash",
            `curl "${quickstartTile}" --output tile.mvt`,
          ),
        },
      ],
      ctas: [
        { label: "Authentication", href: "/docs/authentication" },
        { label: "Create Project", href: "/sign-up?next=%2Fapp%2Fprojects%2Fnew", action: "create-project" },
      ],
    },
    authentication: {
      slug: "authentication",
      title: "Authentication",
      summary: "Choose the delivery auth mode that fits your client environment, and keep product sign-in separate.",
      nav: docsGuideNav,
      sections: [
        {
          id: "product-access",
          title: "Product access vs delivery auth",
          body: "Workspace sign-in for `/app` and `/app-api/*` uses first-party email/password sessions, email verification, and recovery flows. Enterprise deployments may place an identity bridge in front of the product shell, but map, raster, static, and style requests still use project-scoped access tokens.",
          callout: "Do not reuse app-session cookies, account passwords, or enterprise identity headers as delivery tokens. Delivery requests should use a project token via `access_token` or `Authorization: Bearer`.",
        },
        {
          id: "browser",
          title: "Browser clients",
          body: "Use `access_token` in the query string for browser-based map libraries. This keeps style, raster, and static-map requests simple across CORS boundaries.",
          codeExamples: codeBlock(
            "Browser URL",
            "text",
            styleExample,
          ),
        },
        {
          id: "server",
          title: "Server-side requests",
          body: "Use `Authorization: Bearer` when your project token stays on the server and you want cleaner URLs in logs and traces. This is still delivery auth, not interactive workspace sign-in.",
          codeExamples: codeBlock(
            "Header auth",
            "bash",
            `curl /v1/tiles/2/2/3.mvt \\\n  -H "Authorization: Bearer YOUR_TOKEN" \\\n  --output tile.mvt`,
          ),
        },
      ],
      ctas: [
        { label: "MapLibre Guide", href: "/docs/maplibre" },
        { label: "Get API key", href: "/sign-up?next=%2Fapp%2Fprojects%2Fnew", action: "get-api-key" },
      ],
    },
    maplibre: {
      slug: "maplibre",
      title: "MapLibre",
      summary: "Integrate published styles directly into MapLibre GL JS.",
      nav: docsGuideNav,
      sections: [
        {
          id: "style",
          title: "Published style URL",
          body: "Styles resolve fonts, sprites, vector sources, and token placeholders through the public styles domain. Use the published style endpoint as your map style.",
          codeExamples: codeBlock(
            "Style URL",
            "text",
            styleExample,
          ),
        },
        {
          id: "app-link",
          title: "Get a project token",
          body: "The app console issues tokens once at create or rotate time. Keep that one-time display flow as your operational source of truth.",
        },
      ],
      ctas: [
        { label: "Styles Guide", href: "/docs/styles" },
        { label: "Get API key", href: "/sign-up?next=%2Fapp%2Fprojects%2Fnew", action: "get-api-key" },
      ],
    },
    raster: {
      slug: "raster",
      title: "Raster",
      summary: "Rendered raster tiles for clients that do not use vector styles directly.",
      nav: docsGuideNav,
      sections: [
        {
          id: "png",
          title: "Raster tiles",
          body: "Raster routes render from published styles and support PNG or WebP output. They count against the same request budget as vector delivery.",
          codeExamples: codeBlock(
            "Raster URL",
            "text",
            rasterExample,
          ),
        },
        {
          id: "leaflet",
          title: "Leaflet-style usage",
          body: "Raster tiles are the easiest route for Leaflet-like clients or environments where vector rendering is not a fit.",
        },
      ],
      ctas: [
        { label: "Static Maps", href: "/docs/static-maps" },
        { label: "Examples", href: "/docs/examples" },
      ],
    },
    "static-maps": {
      slug: "static-maps",
      title: "Static Maps",
      summary: "Generate server-rendered map images from published styles.",
      nav: docsGuideNav,
      sections: [
        {
          id: "image",
          title: "Static image URL",
          body: "Static maps are useful for thumbnails, reports, email, previews, and any environment that needs a deterministic image instead of an interactive map.",
          codeExamples: codeBlock(
            "Static map",
            "text",
            staticExample,
          ),
        },
      ],
      ctas: [
        { label: "Raster Guide", href: "/docs/raster" },
        { label: "API Reference", href: "/docs/api" },
      ],
    },
    styles: {
      slug: "styles",
      title: "Styles",
      summary: "Published styles are the integration unit exposed to customers.",
      nav: docsGuideNav,
      sections: [
        {
          id: "published",
          title: "Published styles only",
          body: "Customer-facing integrations should only target published styles. Studio editing and publish controls remain internal until permissions and revision ownership are redesigned.",
        },
        {
          id: "url",
          title: "Style endpoint",
          body: "Every published style resolves to a style JSON document that can feed MapLibre directly or act as the rendering base for raster and static maps.",
          codeExamples: codeBlock(
            "Style JSON",
            "text",
            styleExample,
          ),
        },
      ],
      ctas: [
        { label: "MapLibre Guide", href: "/docs/maplibre" },
        { label: "Examples", href: "/docs/examples" },
      ],
    },
    api: {
      slug: "api",
      title: "API Reference",
      summary: "Public runtime routes only. Admin routes stay out of the public reference.",
      nav: docsGuideNav,
      sections: [
        {
          id: "summary",
          title: "Public routes",
          body: "The public API includes tiles, metadata, styles, fonts, raster, static maps, health, and public docs payloads. The machine-readable source remains `/docs/openapi.json`.",
          codeExamples: codeBlock(
            "Selected routes",
            "text",
            apiReferenceSummary,
          ),
        },
        {
          id: "auth-modes",
          title: "Authentication modes",
          body: "Use `?access_token=YOUR_TOKEN` for browser-facing map clients so style, glyph, sprite, vector, raster, and static requests stay easy to wire across CORS boundaries. Use `Authorization: Bearer YOUR_TOKEN` for server-side requests when you want cleaner URLs in logs and traces.",
          callout: "Browser integrations should prefer query-token auth. Header auth is best reserved for server-side or trusted backend-to-backend flows.",
        },
        {
          id: "limits-and-429",
          title: "Limits and 429 behavior",
          body: "Project quotas and rate-limit protections are enforced before raster or vector work is fully processed. A `429` response means the current project token has crossed a quota or rate-limit boundary and should be treated as an operational signal, not a malformed request. Check usage in the app console before retrying aggressively.",
        },
      ],
      ctas: [
        { label: "Open OpenAPI JSON", href: "/docs/openapi.json" },
        { label: "Quickstart", href: "/docs/quickstart" },
        { label: "Examples", href: "/docs/examples" },
      ],
    },
    examples: {
      slug: "examples",
      title: "Examples",
      summary: "Copy-first examples for quick evaluation and onboarding.",
      nav: docsGuideNav,
      sections: [
        {
          id: "maplibre-browser",
          title: "MapLibre browser bootstrap",
          body: "Use a published style URL directly in MapLibre when you want the shortest browser path from project creation to a visible map render.",
          callout: "Browser clients should prefer query-token auth here so style, sprite, glyph, tile, raster, and static requests stay simple across CORS boundaries.",
          codeExamples: codeBlock(
            "MapLibre quickstart",
            "js",
            `import maplibregl from "maplibre-gl";\n\nnew maplibregl.Map({\n  container: "map",\n  style: "${styleExample}",\n  center: [10.7522, 59.9139],\n  zoom: 5,\n});`,
          ),
        },
        {
          id: "direct-request-debugging",
          title: "Direct request debugging",
          body: examples.quickstart.map((entry) => `${entry.name}: ${entry.url}`).join("\n"),
          codeExamples: examples.quickstart.map((entry) => ({
            label: entry.name,
            language: "text",
            code: entry.url,
          })),
        },
        {
          id: "image-delivery",
          title: "Leaflet, raster, and static images",
          body: "Use these examples when you want image delivery instead of a vector style pipeline, whether that means a Leaflet-friendly raster layer or a deterministic static image output.",
          codeExamples: [...examples.leaflet, ...examples.raster, ...examples.staticMaps].map((entry) => ({
            label: entry.name,
            language: "text",
            code: entry.url,
          })),
        },
      ],
      ctas: [
        { label: "Quickstart", href: "/docs/quickstart" },
        { label: "Create Project", href: "/sign-up?next=%2Fapp%2Fprojects%2Fnew", action: "create-project" },
      ],
    },
  };
}

export function getDocsIndex(): DocsIndex {
  return {
    title: "Tileserver Documentation",
    version: "1.0.0",
    baseUrl: "/",
    sections: [
      {
        id: "quickstart",
        title: "Quickstart",
        body: "Use project access tokens via `Authorization: Bearer YOUR_TOKEN` or `?access_token=YOUR_TOKEN`; browser clients should prefer query-token auth to keep CORS preflight project-scoped.",
      },
      {
        id: "auth",
        title: "Authentication",
        body: "Project-scoped tokens are required for private requests. Use `Authorization: Bearer YOUR_TOKEN` for server-to-server requests and `?access_token=YOUR_TOKEN` for browser map clients.",
      },
      {
        id: "examples",
        title: "Examples",
        body: "Examples include both auth patterns; for browser preflight flows use `access_token` query parameter URLs.",
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
  return cloneOpenApiDocument(openApiDocument);
}

export async function getExamples(): Promise<ExampleBundle> {
  const styleId = await getDefaultStyleId();
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
    quickstart: cloneExamples(quickstartExamples.vector),
    mapLibre: cloneExamples(resolvedMapLibreExamples),
    leaflet: cloneExamples(resolvedLeafletExamples),
    raster: cloneExamples(resolvedRasterExamples),
    staticMaps: cloneExamples(resolvedStaticExamples),
  };
}

export async function getDocsGuidePage(slug?: DocsGuideSlug): Promise<DocsGuidePage> {
  const resolvedSlug = slug === undefined ? "index" : normalizeDocsGuideSlug(slug);
  const docsGuidePages = await buildGuidePages();
  const page = docsGuidePages[resolvedSlug];
  if (!page) {
    throw new Error(`Unknown docs guide slug: ${resolvedSlug}`);
  }
  return cloneGuidePage(page);
}
