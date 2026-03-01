import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { HttpMethod } from "../contracts/types";
import { loadConfig } from "../config/load-config";
import { handleHealthRequest, handleMetadataRequest, handleTileRequest } from "../domains/tile-api/tile-api.service";
import { handleRasterTileRequest, handleStaticMapRequest } from "../domains/raster-api/raster-api.service";
import { handleStyleRequest } from "../domains/styles/styles-route.service";
import { createObjectStore } from "../domains/storage/storage.service";
import { docsExamplesRoute } from "../domains/docs-site/routes/examples-route";
import { docsIndexRoute } from "../domains/docs-site/routes/docs-index-route";
import { docsOpenApiRoute } from "../domains/docs-site/routes/openapi-route";
import { bootstrapDemoData, type DemoBootstrapState } from "./demo-bootstrap";

interface RoutedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body?: string | Uint8Array;
}

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

function normalizeMethod(method: string | undefined): HttpMethod {
  return ((method ?? "GET").toUpperCase() as unknown) as HttpMethod;
}

function normalizeHeaders(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.join(",");
      continue;
    }
    normalized[key] = undefined;
  }
  return normalized;
}

function normalizeQuery(pathname: URL): Readonly<Record<string, string | string[] | undefined>> {
  const query: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of pathname.searchParams.entries()) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
      continue;
    }
    if (Array.isArray(existing)) {
      query[key] = [...existing, value];
      continue;
    }
    query[key] = [existing, value];
  }
  return query;
}

function sendResponse(response: ServerResponse, input: RoutedResponse): void {
  for (const [key, value] of Object.entries(input.headers)) {
    response.setHeader(key, value);
  }
  response.statusCode = input.status;
  if (input.body === undefined) {
    response.end();
    return;
  }
  if (typeof input.body === "string") {
    response.end(input.body);
    return;
  }
  response.end(Buffer.from(input.body));
}

function jsonResponse(status: number, body: Record<string, unknown>): RoutedResponse {
  const payload = JSON.stringify(body);
  return {
    status,
    body: payload,
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(payload).byteLength),
      "cache-control": "no-store",
    },
  };
}

function isDemoPmtilesPath(pathname: string): boolean {
  return pathname === "/demo/data.pmtiles";
}

function parseSingleRangeHeader(input: string, totalBytes: number): ByteRange | null {
  const normalized = input.trim();
  if (!normalized.startsWith("bytes=")) {
    return null;
  }
  const rangesPart = normalized.slice("bytes=".length).trim();
  if (rangesPart.includes(",")) {
    return null;
  }
  const [startRaw, endRaw] = rangesPart.split("-", 2);
  if (startRaw === undefined || endRaw === undefined) {
    return null;
  }
  if (startRaw.length === 0 && endRaw.length === 0) {
    return null;
  }
  if (startRaw.length === 0) {
    const suffixLength = Number(endRaw);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null;
    }
    const boundedSuffix = Math.min(suffixLength, totalBytes);
    return {
      start: totalBytes - boundedSuffix,
      end: totalBytes - 1,
    };
  }
  const start = Number(startRaw);
  if (!Number.isInteger(start) || start < 0 || start >= totalBytes) {
    return null;
  }
  if (endRaw.length === 0) {
    return {
      start,
      end: totalBytes - 1,
    };
  }
  const end = Number(endRaw);
  if (!Number.isInteger(end) || end < start) {
    return null;
  }
  return {
    start,
    end: Math.min(end, totalBytes - 1),
  };
}

async function maybeHandleDemoPmtilesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: DemoBootstrapState,
): Promise<boolean> {
  const host = request.headers.host ?? "127.0.0.1";
  const url = new URL(request.url ?? "/", `http://${host}`);
  const pathname = url.pathname;
  if (!isDemoPmtilesPath(pathname)) {
    return false;
  }
  const method = (request.method ?? "GET").toUpperCase();
  const baseHeaders: Record<string, string> = {
    "accept-ranges": "bytes",
    "content-type": "application/vnd.pmtiles",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-allow-headers": "range,content-type",
    vary: "origin",
  };

  if (method === "OPTIONS") {
    sendResponse(response, {
      status: 204,
      headers: {
        ...baseHeaders,
      },
    });
    return true;
  }
  if (method !== "GET" && method !== "HEAD") {
    sendResponse(response, {
      status: 400,
      body: JSON.stringify({ error: "DEMO_BAD_REQUEST" }),
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
      },
    });
    return true;
  }

  const config = loadConfig();
  const store = createObjectStore(config);
  let size = 0;
  try {
    const metadata = await store.head(state.artifactKey);
    size = metadata.size;
  } catch {
    sendResponse(response, {
      status: 404,
      body: JSON.stringify({ error: "PMTILES_NOT_FOUND" }),
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
      },
    });
    return true;
  }
  if (size <= 0) {
    sendResponse(response, {
      status: 503,
      body: JSON.stringify({ error: "PMTILES_EMPTY" }),
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
      },
    });
    return true;
  }

  const rangeHeaderRaw = request.headers.range;
  const rangeHeader = typeof rangeHeaderRaw === "string" ? rangeHeaderRaw : undefined;
  const range = rangeHeader ? parseSingleRangeHeader(rangeHeader, size) : undefined;
  if (rangeHeader !== undefined && range === null) {
    sendResponse(response, {
      status: 416,
      body: JSON.stringify({ error: "RANGE_NOT_SATISFIABLE" }),
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "content-range": `bytes */${size}`,
      },
    });
    return true;
  }

  if (range) {
    let chunk: Uint8Array;
    try {
      const result = await store.getRange({
        key: state.artifactKey,
        start: range.start,
        end: range.end,
      });
      chunk = result.bytes;
    } catch {
      sendResponse(response, {
        status: 503,
        body: JSON.stringify({ error: "PMTILES_READ_FAILED" }),
        headers: {
          ...baseHeaders,
          "content-type": "application/json",
        },
      });
      return true;
    }
    const length = range.end - range.start + 1;
    for (const [key, value] of Object.entries({
      ...baseHeaders,
      "content-length": String(length),
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
    })) {
      response.setHeader(key, value);
    }
    response.statusCode = 206;
    if (method === "HEAD") {
      response.end();
      return true;
    }
    response.end(Buffer.from(chunk));
    return true;
  }

  for (const [key, value] of Object.entries({
    ...baseHeaders,
    "content-length": String(size),
  })) {
    response.setHeader(key, value);
  }
  response.statusCode = 200;
  if (method === "HEAD") {
    response.end();
    return true;
  }

  const chunkSize = Math.max(config.tileDeliveryPolicy.maxRangeBytes, 1);
  try {
    let start = 0;
    while (start < size) {
      const end = Math.min(start + chunkSize - 1, size - 1);
      const chunk = await store.getRange({
        key: state.artifactKey,
        start,
        end,
      });
      response.write(Buffer.from(chunk.bytes));
      start = end + 1;
    }
    response.end();
  } catch {
    if (!response.headersSent) {
      sendResponse(response, jsonResponse(503, { error: "PMTILES_READ_FAILED" }));
    } else {
      response.destroy();
    }
  }
  return true;
}

async function buildDemoStatus(state: DemoBootstrapState): Promise<Record<string, unknown>> {
  let liveSize = state.artifactByteSize;
  try {
    const config = loadConfig();
    const store = createObjectStore(config);
    const metadata = await store.head(state.artifactKey);
    liveSize = metadata.size;
  } catch {
    // keep bootstrap size when the file is unavailable during startup.
  }
  return {
    artifactId: state.artifactId,
    artifactKey: state.artifactKey,
    artifactByteSize: state.artifactByteSize,
    artifactByteSizeLive: liveSize,
    pmtilesLocation: state.pmtilesLocation,
    pmtilesLocalPath: state.pmtilesLocalPath,
    pmtilesHttpEndpoint: "/demo/data.pmtiles",
    styles: state.styleIds,
    token: state.accessToken,
  };
}

function renderDemoHtml(state: DemoBootstrapState): string {
  const stateJson = JSON.stringify({
    styleIds: state.styleIds,
    defaultToken: state.accessToken,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tileserver Demo</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
  <style>
    :root {
      --bg: #f4f0e5;
      --panel: #fffaf1;
      --ink: #1b2733;
      --muted: #5c6670;
      --line: #c7bba5;
      --accent: #1f5f8b;
    }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
      color: var(--ink);
      background: radial-gradient(circle at top left, #fef3db 0%, var(--bg) 55%, #e8efe7 100%);
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 16px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 8px 20px rgba(20, 31, 41, 0.08);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
    }
    h3 {
      margin: 0 0 8px;
    }
    p {
      margin: 6px 0;
      color: var(--muted);
    }
    label {
      display: block;
      font-weight: 600;
      margin: 10px 0 4px;
    }
    input, select, button {
      font: inherit;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      width: 100%;
      box-sizing: border-box;
    }
    button {
      background: var(--accent);
      color: #fff;
      border: none;
      cursor: pointer;
      margin-top: 12px;
    }
    pre {
      margin: 0;
      max-height: 280px;
      overflow: auto;
      padding: 12px;
      border-radius: 8px;
      background: #f5f8fb;
      border: 1px solid #d3dce6;
      font-size: 12px;
      line-height: 1.4;
    }
    #map {
      width: 100%;
      min-height: 380px;
      border-radius: 10px;
      border: 1px solid #c9d2dc;
      background: #d9e5ee;
    }
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 8px;
    }
    .links a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <h1>Tileserver E2E Demo</h1>
      <p>This page runs live requests through your local server routes using the external PMTiles artifact.</p>
      <div class="links">
        <a href="/docs" target="_blank" rel="noreferrer">/docs</a>
        <a href="/docs/openapi.json" target="_blank" rel="noreferrer">/docs/openapi.json</a>
        <a href="/docs/examples" target="_blank" rel="noreferrer">/docs/examples</a>
        <a href="/demo/status" target="_blank" rel="noreferrer">/demo/status</a>
        <a href="/demo/data.pmtiles" target="_blank" rel="noreferrer">/demo/data.pmtiles</a>
      </div>
    </section>
    <section class="panel">
      <h3>Map</h3>
      <p>Interactive map reads PMTiles directly from <code>/demo/data.pmtiles</code> via range requests.</p>
      <div id="map"></div>
      <pre id="map-status"></pre>
    </section>
    <section class="panel">
      <label for="token">Access token</label>
      <input id="token" />
      <label for="style">Style</label>
      <select id="style"></select>
      <button id="run">Run E2E checks</button>
    </section>
    <section class="grid">
      <div class="panel">
        <h3>Status</h3>
        <pre id="status"></pre>
      </div>
      <div class="panel">
        <h3>Health + Metadata</h3>
        <pre id="health"></pre>
      </div>
      <div class="panel">
        <h3>Tile Sample</h3>
        <pre id="tile"></pre>
      </div>
      <div class="panel">
        <h3>Style + Raster + Static</h3>
        <pre id="style-data"></pre>
      </div>
    </section>
  </main>
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script src="https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js"></script>
  <script>
    const state = ${stateJson};
    const tokenInput = document.getElementById("token");
    const styleSelect = document.getElementById("style");
    const statusEl = document.getElementById("status");
    const healthEl = document.getElementById("health");
    const tileEl = document.getElementById("tile");
    const styleEl = document.getElementById("style-data");
    const mapStatusEl = document.getElementById("map-status");
    tokenInput.value = state.defaultToken;
    for (const styleId of state.styleIds) {
      const option = document.createElement("option");
      option.value = styleId;
      option.textContent = styleId;
      styleSelect.appendChild(option);
    }

    function setMapStatus(value) {
      mapStatusEl.textContent = value;
    }

    async function fetchJson(url) {
      const response = await fetch(url);
      const text = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: parsed };
    }

    function spriteVariantForStyleId(styleId) {
      if (styleId === "style-dark") {
        return "dark";
      }
      if (styleId === "style-black") {
        return "black";
      }
      if (styleId === "style-grey") {
        return "grayscale";
      }
      if (styleId === "style-white") {
        return "white";
      }
      return "light";
    }

    async function buildMapStyle(styleId) {
      const response = await fetch("/v1/styles/" + encodeURIComponent(styleId) + "/style.json");
      if (!response.ok) {
        throw new Error("style fetch failed: " + response.status);
      }
      const style = await response.json();
      if (!style || typeof style !== "object") {
        throw new Error("style payload invalid");
      }
      const pmtilesHttpUrl = location.origin + "/demo/data.pmtiles";
      const spriteVariant = spriteVariantForStyleId(styleId);
      style.glyphs = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
      style.sprite = "https://protomaps.github.io/basemaps-assets/sprites/v4/" + spriteVariant;
      if (style.sources && typeof style.sources === "object") {
        for (const sourceKey of Object.keys(style.sources)) {
          const source = style.sources[sourceKey];
          if (!source || typeof source !== "object") {
            continue;
          }
          if (source.type !== "vector") {
            continue;
          }
          source.url = "pmtiles://" + pmtilesHttpUrl;
          if ("tiles" in source) {
            delete source.tiles;
          }
        }
      }
      return style;
    }

    async function initMap() {
      const maplibreglGlobal = globalThis.maplibregl;
      const pmtilesGlobal = globalThis.pmtiles;
      if (!maplibreglGlobal || !pmtilesGlobal) {
        setMapStatus("Map scripts unavailable (MapLibre or PMTiles failed to load).");
        return;
      }

      const pmtilesHttpUrl = location.origin + "/demo/data.pmtiles";
      const protocol = new pmtilesGlobal.Protocol();
      maplibreglGlobal.addProtocol("pmtiles", protocol.tile);
      const archive = new pmtilesGlobal.PMTiles(pmtilesHttpUrl);
      protocol.add(archive);
      const initialStyleId = styleSelect.value || state.styleIds[0];
      const initialMapStyle = await buildMapStyle(initialStyleId);

      const map = new maplibreglGlobal.Map({
        container: "map",
        style: initialMapStyle,
        center: [10.7522, 59.9139],
        zoom: 4.5
      });
      map.addControl(new maplibreglGlobal.NavigationControl({ showCompass: true }), "top-right");

      map.on("load", async () => {
        const status = await fetchJson("/demo/status");
        setMapStatus(JSON.stringify({
          map: "ready",
          pmtilesEndpoint: "/demo/data.pmtiles",
          artifactBytesLive: status.body.artifactByteSizeLive
        }, null, 2));
      });
      map.on("error", (event) => {
        const message = event && event.error && event.error.message ? event.error.message : "Map render error";
        setMapStatus(JSON.stringify({ map: "error", message }, null, 2));
      });

      styleSelect.addEventListener("change", async () => {
        const selected = styleSelect.value || state.styleIds[0];
        try {
          setMapStatus("Applying style " + selected + "...");
          const nextStyle = await buildMapStyle(selected);
          map.setStyle(nextStyle);
          setMapStatus("Style applied: " + selected);
        } catch (error) {
          const message = error instanceof Error ? error.message : "failed to apply style";
          setMapStatus(JSON.stringify({ map: "style_error", styleId: selected, message }, null, 2));
        }
      });
    }

    async function runChecks() {
      const token = tokenInput.value.trim();
      const styleId = styleSelect.value || state.styleIds[0];

      const status = await fetchJson("/demo/status");
      statusEl.textContent = JSON.stringify(status, null, 2);

      const health = await fetchJson("/v1/health");
      const metadata = await fetchJson("/v1/tiles/metadata?access_token=" + encodeURIComponent(token));
      healthEl.textContent = JSON.stringify({ health, metadata }, null, 2);

      const tileResponse = await fetch("/v1/tiles/2/2/3.mvt?access_token=" + encodeURIComponent(token));
      const tileBytes = new Uint8Array(await tileResponse.arrayBuffer());
      const tilePreview = Array.from(tileBytes.slice(0, 24))
        .map((entry) => entry.toString(16).padStart(2, "0"))
        .join(" ");
      tileEl.textContent = JSON.stringify({
        status: tileResponse.status,
        headers: Object.fromEntries(tileResponse.headers.entries()),
        byteLength: tileBytes.byteLength,
        leadingBytesHex: tilePreview,
      }, null, 2);

      const style = await fetchJson("/v1/styles/" + encodeURIComponent(styleId) + "/style.json");
      const raster = await fetch("/v1/raster/" + encodeURIComponent(styleId) + "/2/2/3.png?access_token=" + encodeURIComponent(token));
      const rasterText = await raster.text();
      const staticMap = await fetch("/v1/static/" + encodeURIComponent(styleId) + "/10.7522,59.9139,5/640x360.png?access_token=" + encodeURIComponent(token));
      const staticText = await staticMap.text();
      styleEl.textContent = JSON.stringify({
        style,
        raster: {
          status: raster.status,
          headers: Object.fromEntries(raster.headers.entries()),
          bodyPreview: rasterText.slice(0, 200),
        },
        staticMap: {
          status: staticMap.status,
          headers: Object.fromEntries(staticMap.headers.entries()),
          bodyPreview: staticText.slice(0, 200),
        },
      }, null, 2);
    }

    document.getElementById("run").addEventListener("click", () => {
      void runChecks();
    });
    void initMap();
    void runChecks();
  </script>
</body>
</html>`;
}

function isTilePath(pathname: string): boolean {
  return /^\/(?:v1\/)?tiles\/\d+\/\d+\/\d+\.mvt$/.test(pathname);
}

function isMetadataPath(pathname: string): boolean {
  return pathname === "/v1/tiles/metadata" || pathname === "/tiles/metadata";
}

function isHealthPath(pathname: string): boolean {
  return pathname === "/v1/health" || pathname === "/health";
}

function isStylePath(pathname: string): boolean {
  return pathname.startsWith("/v1/styles") || pathname.startsWith("/styles") || pathname.startsWith("/v1/fonts") || pathname.startsWith("/fonts");
}

function isRasterPath(pathname: string): boolean {
  return pathname.startsWith("/v1/raster/") || pathname.startsWith("/raster/");
}

function isStaticPath(pathname: string): boolean {
  return pathname.startsWith("/v1/static/") || pathname.startsWith("/static/");
}

function isDocsPath(pathname: string): boolean {
  return pathname === "/docs" || pathname === "/docs/" || pathname === "/docs/openapi.json" || pathname === "/docs/openapi.json/" || pathname === "/docs/examples" || pathname === "/docs/examples/";
}

async function routeRequest(request: IncomingMessage, state: DemoBootstrapState): Promise<RoutedResponse> {
  const host = request.headers.host ?? "127.0.0.1";
  const url = new URL(request.url ?? "/", `http://${host}`);
  const pathname = url.pathname;
  const pathWithQuery = `${url.pathname}${url.search}`;
  const method = normalizeMethod(request.method);
  const headers = normalizeHeaders(request.headers);
  const query = normalizeQuery(url);

  if (pathname === "/" || pathname === "/demo" || pathname === "/demo/") {
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse(400, { error: "DEMO_BAD_REQUEST" });
    }
    const html = renderDemoHtml(state);
    return {
      status: 200,
      body: method === "HEAD" ? undefined : html,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(new TextEncoder().encode(html).byteLength),
        "cache-control": "no-store",
      },
    };
  }

  if (pathname === "/demo/status") {
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse(400, { error: "DEMO_BAD_REQUEST" });
    }
    const payload = JSON.stringify(await buildDemoStatus(state));
    return {
      status: 200,
      body: method === "HEAD" ? undefined : payload,
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(payload).byteLength),
        "cache-control": "no-store",
      },
    };
  }

  if (isMetadataPath(pathname)) {
    const response = await handleMetadataRequest({
      method,
      path: pathWithQuery,
      query,
      headers,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (isTilePath(pathname)) {
    const response = await handleTileRequest({
      method,
      path: pathWithQuery,
      query,
      headers,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (isHealthPath(pathname)) {
    const response = await handleHealthRequest({
      method,
      path: pathWithQuery,
      query,
      headers,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (isStylePath(pathname)) {
    const response = await handleStyleRequest({
      method,
      path: pathWithQuery,
      query,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (isRasterPath(pathname)) {
    const response = await handleRasterTileRequest({
      method,
      path: pathWithQuery,
      query,
      headers,
      clientIp: headers["x-forwarded-for"] ?? undefined,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (isStaticPath(pathname)) {
    const response = await handleStaticMapRequest({
      method,
      path: pathWithQuery,
      query,
      headers,
      clientIp: headers["x-forwarded-for"] ?? undefined,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (isDocsPath(pathname)) {
    if (pathname.startsWith("/docs/examples")) {
      const response = await docsExamplesRoute({ method, path: pathWithQuery });
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
      };
    }
    if (pathname.startsWith("/docs/openapi.json")) {
      const response = await docsOpenApiRoute({ method, path: pathWithQuery });
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
      };
    }
    const response = await docsIndexRoute({ method, path: pathWithQuery });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  return jsonResponse(404, { error: "ROUTE_NOT_FOUND", path: pathname });
}

async function main(): Promise<void> {
  const bootstrap = await bootstrapDemoData();
  const host = process.env.HOST?.trim() || "127.0.0.1";
  const portRaw = process.env.PORT?.trim() || "8787";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${portRaw}`);
  }

  const server = createServer(async (request, response) => {
    try {
      const handledPmtiles = await maybeHandleDemoPmtilesRequest(request, response, bootstrap);
      if (handledPmtiles) {
        return;
      }
      const routed = await routeRequest(request, bootstrap);
      sendResponse(response, routed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected error";
      sendResponse(response, jsonResponse(500, { error: "SERVER_ERROR", message }));
    }
  });

  server.listen(port, host, () => {
    console.log(`Demo server running at http://${host}:${port}/demo`);
    console.log(`PMTiles source: ${bootstrap.pmtilesLocation}`);
    console.log(`Artifact: ${bootstrap.artifactId}`);
    console.log(`Styles: ${bootstrap.styleIds.join(", ")}`);
    console.log(`Demo token: ${bootstrap.accessToken}`);
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : "unknown startup error";
  console.error(message);
  process.exitCode = 1;
});
