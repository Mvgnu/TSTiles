import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import type { HttpMethod, DeliverySignal } from "../contracts/types";
import { CONTRACT_SCHEMA_VERSION } from "../contracts/types";
import { loadConfig } from "../config/load-config";
import { prisma } from "../config/db";
import { handleHealthRequest, handleMetadataRequest, handleTileRequest } from "../domains/tile-api/tile-api.service";
import { handleRasterTileRequest, handleStaticMapRequest } from "../domains/raster-api/raster-api.service";
import { recordDeliverySignal } from "../domains/metering/metering.service";
import { evaluateTileSLOs } from "../domains/observability/observability.service";
import { handleStyleRequest } from "../domains/styles/styles-route.service";
import { adminListArtifactsRoute } from "../domains/control-plane/routes/admin-artifacts-route";
import { adminPromoteArtifactRoute } from "../domains/control-plane/routes/admin-promote-route";
import { adminRollbackArtifactRoute } from "../domains/control-plane/routes/admin-rollback-route";
import { adminIngestRoute } from "../domains/control-plane/routes/admin-ingest-route";
import { adminCreateProjectRoute } from "../domains/control-plane/routes/admin-create-project-route";
import { adminRotateApiKeyRoute } from "../domains/control-plane/routes/admin-rotate-api-key-route";
import { adminProjectUsageRoute } from "../domains/control-plane/routes/admin-project-usage-route";
import { adminCreateStyleVersionRoute } from "../domains/control-plane/routes/admin-create-style-version-route";
import { adminPublishStyleVersionRoute } from "../domains/control-plane/routes/admin-publish-style-version-route";
import { adminListAuditEventsRoute } from "../domains/control-plane/routes/admin-audit-events-route";
import { adminListJobsRoute } from "../domains/control-plane/routes/admin-jobs-route";
import { controlPlaneHealthRoute } from "../domains/control-plane/routes/health-route";
import { createObjectStore } from "../domains/storage/storage.service";
import { docsExamplesRoute } from "../domains/docs-site/routes/examples-route";
import { docsIndexRoute } from "../domains/docs-site/routes/docs-index-route";
import { docsOpenApiRoute } from "../domains/docs-site/routes/openapi-route";
import { billingSummaryRoute } from "../domains/billing-sync/routes/billing-route";
import { billingCheckoutRoute } from "../domains/billing-sync/routes/checkout-route";
import { billingPortalRoute } from "../domains/billing-sync/routes/portal-route";
import { stripeWebhookRoute } from "../domains/billing-sync/routes/webhook-route";
import { customerConsoleBootstrapRoute } from "../domains/customer-console/routes/bootstrap-route";
import { customerConsoleProjectRoute } from "../domains/customer-console/routes/project-route";
import { customerConsoleProjectsRoute } from "../domains/customer-console/routes/projects-route";
import { customerConsoleSettingsRoute } from "../domains/customer-console/routes/settings-route";
import { customerConsoleStylesRoute } from "../domains/customer-console/routes/styles-route";
import { customerConsoleMembershipsRoute } from "../domains/customer-console/routes/memberships-route";
import { customerConsoleWorkspaceRoute } from "../domains/customer-console/routes/workspace-route";
import { customerConsoleSecurityRoute } from "../domains/customer-console/routes/security-route";
import { customerConsoleNotificationsRoute } from "../domains/customer-console/routes/notifications-route";
import { identityDemoSignInRoute } from "../domains/identity/routes/demo-sign-in-route";
import { identityDemoSignOutRoute } from "../domains/identity/routes/demo-sign-out-route";
import { identitySessionRoute } from "../domains/identity/routes/session-route";
import { authFlowsRoute } from "../domains/auth-flows/routes";
import { marketingSiteRoute } from "../domains/marketing-site/routes/site-route";
import { appConsoleRoute } from "../domains/app-console/routes/app-route";
import { bootstrapDemoData, type DemoBootstrapState } from "./demo-bootstrap";

interface RoutedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body?: string | Uint8Array;
}

type ExtendedHttpMethod = HttpMethod | "POST" | "PATCH";
type AuthHttpMethod = "GET" | "POST" | "HEAD" | "OPTIONS";

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

function normalizeMethod(method: string | undefined): ExtendedHttpMethod {
  return ((method ?? "GET").toUpperCase() as unknown) as ExtendedHttpMethod;
}

function isPublicHttpMethod(method: ExtendedHttpMethod): method is HttpMethod {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function isAuthHttpMethod(method: ExtendedHttpMethod): method is AuthHttpMethod {
  return method === "GET" || method === "POST" || method === "HEAD" || method === "OPTIONS";
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

function resolveRequestBaseUrl(headers: Record<string, string | undefined>): string {
  const forwardedProto = headers["x-forwarded-proto"]?.split(",")[0]?.trim();
  const protocol = forwardedProto && forwardedProto.length > 0 ? forwardedProto : "http";
  const host = headers.host && headers.host.length > 0 ? headers.host : "127.0.0.1:8787";
  return `${protocol}://${host}`;
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

type RequestBodyMode = "json" | "text";

async function readRequestBody(request: IncomingMessage, mode: RequestBodyMode): Promise<unknown> {
  const method = (request.method ?? "GET").toUpperCase();
  if (method !== "POST" && method !== "PATCH" && method !== "PUT") {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(new TextEncoder().encode(chunk));
      continue;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const rawText = new TextDecoder().decode(body);
  if (rawText.length === 0) {
    return undefined;
  }
  if (mode === "text") {
    return rawText;
  }
  const normalized = rawText.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  const contentTypeRaw = request.headers["content-type"];
  const contentType = Array.isArray(contentTypeRaw) ? contentTypeRaw[0] : contentTypeRaw;
  if (contentType?.toLowerCase().includes("application/x-www-form-urlencoded")) {
    const formBody: Record<string, string> = {};
    const params = new URLSearchParams(normalized);
    for (const [key, value] of params.entries()) {
      formBody[key] = value;
    }
    return formBody;
  }
  return JSON.parse(normalized) as unknown;
}

function shouldReadRawBody(urlValue: string | undefined): boolean {
  if (!urlValue) {
    return false;
  }
  const parsed = new URL(urlValue, "http://127.0.0.1");
  return parsed.pathname === "/webhooks/stripe" || parsed.pathname === "/webhooks/stripe/";
}

function isDemoPmtilesPath(pathname: string): boolean {
  return pathname === "/demo/data.pmtiles";
}

type ByteRangeParse =
  | { readonly kind: "ok"; readonly range: ByteRange }
  | { readonly kind: "invalid" }
  | { readonly kind: "too-large" };

function parseSingleRangeHeader(input: string, totalBytes: number, maxRangeBytes: number): ByteRangeParse {
  const normalized = input.trim();
  if (!normalized.startsWith("bytes=")) {
    return { kind: "invalid" };
  }
  const rangesPart = normalized.slice("bytes=".length).trim();
  if (rangesPart.includes(",")) {
    return { kind: "invalid" };
  }
  const [startRaw, endRaw] = rangesPart.split("-", 2);
  if (startRaw === undefined || endRaw === undefined) {
    return { kind: "invalid" };
  }
  if (startRaw.length === 0 && endRaw.length === 0) {
    return { kind: "invalid" };
  }
  let parsed: ByteRange;
  if (startRaw.length === 0) {
    const suffixLength = Number(endRaw);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return { kind: "invalid" };
    }
    const boundedSuffix = Math.min(suffixLength, totalBytes);
    parsed = {
      start: totalBytes - boundedSuffix,
      end: totalBytes - 1,
    };
  } else {
    const start = Number(startRaw);
    if (!Number.isInteger(start) || start < 0 || start >= totalBytes) {
      return { kind: "invalid" };
    }
    if (endRaw.length === 0) {
      parsed = {
        start,
        end: totalBytes - 1,
      };
    } else {
      const end = Number(endRaw);
      if (!Number.isInteger(end) || end < start) {
        return { kind: "invalid" };
      }
      parsed = {
        start,
        end: Math.min(end, totalBytes - 1),
      };
    }
  }
  // Cap any single range to the configured maxRangeBytes so a malicious or
  // naïve client cannot force the server to allocate multi-GB buffers off a
  // single Range header against the planet PMTiles file.
  if (parsed.end - parsed.start + 1 > maxRangeBytes) {
    return { kind: "too-large" };
  }
  return { kind: "ok", range: parsed };
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
  const maxRangeBytes = Math.max(config.tileDeliveryPolicy.maxRangeBytes, 1);
  const parsedRange = rangeHeader
    ? parseSingleRangeHeader(rangeHeader, size, maxRangeBytes)
    : undefined;
  if (parsedRange?.kind === "invalid") {
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
  if (parsedRange?.kind === "too-large") {
    sendResponse(response, {
      status: 416,
      body: JSON.stringify({
        error: "RANGE_TOO_LARGE",
        maxRangeBytes,
      }),
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
        "content-range": `bytes */${size}`,
      },
    });
    return true;
  }
  const range = parsedRange?.kind === "ok" ? parsedRange.range : undefined;

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
      // Stop streaming if the client has aborted; otherwise we'd keep reading
      // 134 GB worth of chunks into memory for nobody.
      if (response.writableEnded || response.destroyed || request.destroyed) {
        return true;
      }
      const end = Math.min(start + chunkSize - 1, size - 1);
      const chunk = await store.getRange({
        key: state.artifactKey,
        start,
        end,
      });
      const flushed = response.write(Buffer.from(chunk.bytes));
      if (!flushed) {
        // Honor backpressure: wait for the kernel/socket buffer to drain
        // before queueing another multi-MB chunk in node's internal buffer.
        await new Promise<void>((resolve, reject) => {
          const onDrain = (): void => {
            response.off("drain", onDrain);
            response.off("close", onClose);
            response.off("error", onError);
            resolve();
          };
          const onClose = (): void => {
            response.off("drain", onDrain);
            response.off("close", onClose);
            response.off("error", onError);
            resolve();
          };
          const onError = (error: unknown): void => {
            response.off("drain", onDrain);
            response.off("close", onClose);
            response.off("error", onError);
            reject(error instanceof Error ? error : new Error("write error"));
          };
          response.once("drain", onDrain);
          response.once("close", onClose);
          response.once("error", onError);
        });
      }
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
    artifactAvailable: state.artifactAvailable,
    pmtilesLocation: state.pmtilesLocation,
    pmtilesLocalPath: state.pmtilesLocalPath,
    styleHttpEndpoint: "/v1/styles/{styleId}/style.json",
    tileHttpEndpoint: "/v1/tiles/{z}/{x}/{y}.mvt",
    styles: state.styleIds,
    token: state.accessToken,
  };
}

function renderDemoHtml(state: DemoBootstrapState): string {
  const stateJson = JSON.stringify({
    styleIds: state.styleIds,
    defaultToken: state.accessToken,
  });
  const artifactNotice = state.artifactAvailable
    ? ""
    : `
    <section class="panel warning-panel">
      <h3>PMTiles source unavailable</h3>
      <p>The demo shell is running without a readable PMTiles artifact. Public docs, pricing, auth, and app surfaces remain available, but tile delivery routes will return not-found until a source is configured.</p>
    </section>
  `;
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
    .warning-panel {
      border-color: rgba(150, 90, 66, 0.32);
      background: rgba(255, 245, 236, 0.96);
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
    ${artifactNotice}
    <section class="panel">
      <h1>Tileserver E2E Demo</h1>
      <p>This page runs live requests through your local server routes using the external PMTiles artifact.</p>
      <div class="links">
        <a href="/docs" target="_blank" rel="noreferrer">/docs</a>
        <a href="/docs/openapi.json" target="_blank" rel="noreferrer">/docs/openapi.json</a>
        <a href="/docs/examples" target="_blank" rel="noreferrer">/docs/examples</a>
        <a href="/demo/status" target="_blank" rel="noreferrer">/demo/status</a>
      </div>
    </section>
    <section class="panel">
      <h3>Map</h3>
      <p>Interactive map reads style JSON and vector tile bytes through <code>/v1/styles</code> and <code>/v1/tiles</code>.</p>
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

    async function buildMapStyle(styleId, token) {
      const response = await fetch(
        "/v1/styles/" + encodeURIComponent(styleId) + "/style.json?access_token=" + encodeURIComponent(token)
      );
      if (!response.ok) {
        throw new Error("style fetch failed: " + response.status);
      }
      const style = await response.json();
      if (!style || typeof style !== "object") {
        throw new Error("style payload invalid");
      }
      const spriteVariant = spriteVariantForStyleId(styleId);
      style.glyphs = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
      style.sprite = "https://protomaps.github.io/basemaps-assets/sprites/v4/" + spriteVariant;
      return style;
    }

    async function initMap() {
      const maplibreglGlobal = globalThis.maplibregl;
      if (!maplibreglGlobal) {
        setMapStatus("Map script unavailable (MapLibre failed to load).");
        return;
      }

      const initialStyleId = styleSelect.value || state.styleIds[0];
      const initialMapStyle = await buildMapStyle(initialStyleId, tokenInput.value.trim());

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
          styleEndpoint: "/v1/styles/" + encodeURIComponent(initialStyleId) + "/style.json",
          tileEndpoint: "/v1/tiles/{z}/{x}/{y}.mvt",
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
          const nextStyle = await buildMapStyle(selected, tokenInput.value.trim());
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

function extractArtifactVersionFromCacheKey(cacheKey: string | undefined): string {
  if (typeof cacheKey !== "string" || cacheKey.length === 0) {
    return "unknown";
  }
  const separator = cacheKey.indexOf(":");
  if (separator <= 0) {
    return "unknown";
  }
  return cacheKey.slice(0, separator);
}

function emitDeliveryTelemetry(input: {
  readonly tilePath: string;
  readonly responseHeaders: Record<string, string>;
  readonly responseBody: string | Uint8Array | undefined;
  readonly statusCode: number;
  readonly normalizedMethod: "GET" | "HEAD" | "OPTIONS";
  readonly latencyMs: number;
  readonly receivedAt: string;
}): void {
  const responseBytes = (() => {
    if (input.responseBody === undefined) {
      const headerLength = input.responseHeaders["content-length"];
      const parsed = headerLength ? Number(headerLength) : 0;
      return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    }
    if (typeof input.responseBody === "string") {
      return new TextEncoder().encode(input.responseBody).byteLength;
    }
    return input.responseBody.byteLength;
  })();
  const artifactVersion = extractArtifactVersionFromCacheKey(input.responseHeaders["x-tile-cache-key"]);
  const signal: DeliverySignal = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    artifactVersion,
    tilePath: input.tilePath,
    cacheStatus: "miss",
    originRead: true,
    responseBytes,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    statusCode: input.statusCode,
    normalizedMethod: input.normalizedMethod,
    receivedAt: input.receivedAt,
  };
  try {
    recordDeliverySignal(signal);
  } catch {
    // Telemetry must never break the request path.
  }
  if (artifactVersion !== "unknown") {
    try {
      evaluateTileSLOs(signal);
    } catch {
      // SLO classification must never break the request path.
    }
  }
}

function isTelemetryPath(pathname: string): boolean {
  return /^\/(?:v1\/)?tiles\/\d+\/\d+\/\d+\.mvt$/.test(pathname)
    || pathname === "/v1/tiles/metadata"
    || pathname === "/tiles/metadata"
    || pathname.startsWith("/v1/raster/")
    || pathname.startsWith("/raster/")
    || pathname.startsWith("/v1/static/")
    || pathname.startsWith("/static/");
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
  return pathname === "/docs" || pathname === "/docs/" || pathname.startsWith("/docs/");
}

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname === "/admin/" || pathname.startsWith("/admin/");
}

function extractAdminToken(headers: Readonly<Record<string, string | undefined>>): string {
  const authorization = headers.authorization;
  if (typeof authorization === "string") {
    const trimmed = authorization.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      return trimmed.slice("bearer ".length).trim();
    }
    if (trimmed.toLowerCase().startsWith("session ")) {
      return trimmed.slice("session ".length).trim();
    }
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  const xSessionToken = headers["x-session-token"];
  if (typeof xSessionToken === "string" && xSessionToken.trim().length > 0) {
    return xSessionToken.trim();
  }
  const cookieHeader = headers.cookie;
  if (typeof cookieHeader === "string") {
    const cookies = cookieHeader.split(";");
    for (const cookie of cookies) {
      const [rawKey, ...rest] = cookie.trim().split("=");
      if (rawKey === "ops_session") {
        const value = rest.join("=").trim();
        if (value.length > 0) {
          return value;
        }
      }
    }
  }
  return "";
}

function adminRouteResponse(response: { status: number; body: unknown; headers: Record<string, string> }): RoutedResponse {
  if (response.body === undefined || response.body === null) {
    return {
      status: response.status,
      headers: response.headers,
      body: undefined,
    };
  }
  const payload = typeof response.body === "string" ? response.body : JSON.stringify(response.body);
  return {
    status: response.status,
    headers: response.headers,
    body: payload,
  };
}

async function routeAdminRequest(
  pathname: string,
  method: ExtendedHttpMethod,
  headers: Readonly<Record<string, string | undefined>>,
  query: Readonly<Record<string, string | string[] | undefined>>,
  body: unknown,
): Promise<RoutedResponse> {
  if (method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "authorization,content-type",
        "cache-control": "no-store",
      },
    };
  }
  const token = extractAdminToken(headers);

  if (pathname === "/admin/health") {
    if (method !== "GET" && method !== "HEAD") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    const result = await controlPlaneHealthRoute(token);
    const routed = adminRouteResponse(result);
    return method === "HEAD" ? { ...routed, body: undefined } : routed;
  }

  if (pathname === "/admin/artifacts") {
    if (method !== "GET") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    return adminRouteResponse(await adminListArtifactsRoute(token));
  }

  if (pathname === "/admin/audit-events") {
    if (method !== "GET") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    const limit = typeof query.limit === "string" ? query.limit : undefined;
    return adminRouteResponse(await adminListAuditEventsRoute(token, { limit }));
  }

  if (pathname === "/admin/jobs") {
    if (method !== "GET") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    const limit = typeof query.limit === "string" ? query.limit : undefined;
    return adminRouteResponse(await adminListJobsRoute(token, { limit }));
  }

  if (pathname === "/admin/ingest") {
    if (method !== "POST") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    return adminRouteResponse(await adminIngestRoute(token));
  }

  if (pathname === "/admin/artifacts/rollback") {
    if (method !== "POST") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    return adminRouteResponse(await adminRollbackArtifactRoute(token));
  }

  const promoteMatch = pathname.match(/^\/admin\/artifacts\/([^/]+)\/promote$/);
  if (promoteMatch) {
    if (method !== "POST") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    return adminRouteResponse(await adminPromoteArtifactRoute(token, decodeURIComponent(promoteMatch[1])));
  }

  if (pathname === "/admin/projects") {
    if (method !== "POST") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    return adminRouteResponse(await adminCreateProjectRoute(token, body));
  }

  const rotateKeyMatch = pathname.match(/^\/admin\/projects\/([^/]+)\/keys\/rotate$/);
  if (rotateKeyMatch) {
    if (method !== "POST") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    return adminRouteResponse(await adminRotateApiKeyRoute(decodeURIComponent(rotateKeyMatch[1]), token));
  }

  const projectUsageMatch = pathname.match(/^\/admin\/projects\/([^/]+)\/usage$/);
  if (projectUsageMatch) {
    if (method !== "GET") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    const window = typeof query.window === "string" ? query.window : "";
    return adminRouteResponse(
      await adminProjectUsageRoute(decodeURIComponent(projectUsageMatch[1]), window, token),
    );
  }

  const styleVersionsMatch = pathname.match(/^\/admin\/styles\/([^/]+)\/versions$/);
  if (styleVersionsMatch) {
    if (method !== "POST") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    return adminRouteResponse(
      await adminCreateStyleVersionRoute(decodeURIComponent(styleVersionsMatch[1]), body, token),
    );
  }

  const stylePublishMatch = pathname.match(/^\/admin\/styles\/([^/]+)\/publish\/([^/]+)$/);
  if (stylePublishMatch) {
    if (method !== "POST") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }
    return adminRouteResponse(
      await adminPublishStyleVersionRoute(
        decodeURIComponent(stylePublishMatch[1]),
        decodeURIComponent(stylePublishMatch[2]),
        token,
      ),
    );
  }

  return jsonResponse(404, { error: "ADMIN_ROUTE_NOT_FOUND", path: pathname });
}

function isAppConsolePath(pathname: string): boolean {
  return pathname === "/app" || pathname === "/app/" || pathname.startsWith("/app/");
}

async function routeRequest(request: IncomingMessage, state: DemoBootstrapState, body?: unknown): Promise<RoutedResponse> {
  const host = request.headers.host ?? "127.0.0.1";
  const url = new URL(request.url ?? "/", `http://${host}`);
  const pathname = url.pathname;
  const pathWithQuery = `${url.pathname}${url.search}`;
  const method = normalizeMethod(request.method);
  const headers = normalizeHeaders(request.headers);
  const query = normalizeQuery(url);

  if (
    pathname === "/sign-in"
    || pathname === "/sign-in/"
    || pathname === "/sign-up"
    || pathname === "/sign-up/"
    || pathname === "/forgot-password"
    || pathname === "/forgot-password/"
    || pathname === "/sign-out"
    || pathname === "/sign-out/"
    || pathname.startsWith("/verify-email")
    || pathname.startsWith("/reset-password/")
    || pathname.startsWith("/magic-link/")
    || pathname.startsWith("/accept-invite/")
  ) {
    if (!isAuthHttpMethod(method)) {
      return jsonResponse(400, { error: "BAD_REQUEST" });
    }
    const response = await authFlowsRoute({
      method,
      path: pathWithQuery,
      query,
      headers,
      body,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (
    pathname === "/"
    || pathname === "/pricing"
    || pathname === "/pricing/"
    || pathname === "/security"
    || pathname === "/security/"
    || pathname === "/status"
    || pathname === "/status/"
    || pathname.startsWith("/legal/")
  ) {
    if (!isPublicHttpMethod(method)) {
      return jsonResponse(400, { error: "BAD_REQUEST" });
    }
    const response = await marketingSiteRoute({
      method,
      path: pathWithQuery,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (isAppConsolePath(pathname)) {
    if (!isPublicHttpMethod(method)) {
      return jsonResponse(400, { error: "BAD_REQUEST" });
    }
    const response = await appConsoleRoute({
      method,
      path: pathWithQuery,
      headers,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/demo" || pathname === "/demo/") {
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
    if (!isPublicHttpMethod(method)) {
      return jsonResponse(400, { error: "BAD_REQUEST" });
    }
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
    if (!isPublicHttpMethod(method)) {
      return jsonResponse(400, { error: "BAD_REQUEST" });
    }
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
    if (!isPublicHttpMethod(method)) {
      return jsonResponse(400, { error: "BAD_REQUEST" });
    }
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
    if (!isPublicHttpMethod(method)) {
      return jsonResponse(400, { error: "BAD_REQUEST" });
    }
    const response = await handleStyleRequest({
      method,
      path: pathWithQuery,
      query,
      baseUrl: resolveRequestBaseUrl(headers),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (isRasterPath(pathname)) {
    if (!isPublicHttpMethod(method)) {
      return jsonResponse(400, { error: "BAD_REQUEST" });
    }
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
    if (!isPublicHttpMethod(method)) {
      return jsonResponse(400, { error: "BAD_REQUEST" });
    }
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
    if (!isPublicHttpMethod(method)) {
      return jsonResponse(400, { error: "BAD_REQUEST" });
    }
    if (pathname.startsWith("/docs/examples")) {
      const response = await docsExamplesRoute({ method, path: pathWithQuery, headers });
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
    const response = await docsIndexRoute({ method, path: pathWithQuery, headers });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (isAdminPath(pathname)) {
    return await routeAdminRequest(pathname, method, headers, query, body);
  }

  if (pathname === "/app-api/session" || pathname === "/app-api/session/") {
    const response = await identitySessionRoute({
      method,
      path: pathWithQuery,
      headers,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/auth/demo/sign-in" || pathname === "/auth/demo/sign-in/") {
    const response = await identityDemoSignInRoute({
      method,
      path: pathWithQuery,
      body,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/auth/demo/sign-out" || pathname === "/auth/demo/sign-out/") {
    const response = await identityDemoSignOutRoute({
      method,
      path: pathWithQuery,
      headers,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/app-api/bootstrap" || pathname === "/app-api/bootstrap/") {
    const response = await customerConsoleBootstrapRoute({
      method,
      path: pathWithQuery,
      headers,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/app-api/projects" || pathname === "/app-api/projects/") {
    const response = await customerConsoleProjectsRoute({
      method,
      path: pathWithQuery,
      headers,
      body,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/app-api/settings" || pathname === "/app-api/settings/") {
    const response = await customerConsoleSettingsRoute({
      method,
      path: pathWithQuery,
      headers,
      body,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/app-api/styles" || pathname === "/app-api/styles/" || pathname.startsWith("/app-api/styles/")) {
    const response = await customerConsoleStylesRoute({
      method,
      path: pathWithQuery,
      headers,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname.startsWith("/app-api/projects/")) {
    const response = await customerConsoleProjectRoute({
      method,
      path: pathWithQuery,
      headers,
      body,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/app-api/memberships" || pathname === "/app-api/memberships/" || pathname.startsWith("/app-api/memberships/")) {
    const response = await customerConsoleMembershipsRoute({
      method,
      path: pathWithQuery,
      headers,
      body,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname.startsWith("/app-api/workspace/")) {
    const response = await customerConsoleWorkspaceRoute({
      method,
      path: pathWithQuery,
      headers,
      body,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname.startsWith("/app-api/security/")) {
    const response = await customerConsoleSecurityRoute({
      method,
      path: pathWithQuery,
      headers,
      body,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/app-api/notifications" || pathname === "/app-api/notifications/") {
    const response = await customerConsoleNotificationsRoute({
      method,
      path: pathWithQuery,
      headers,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/app-api/billing" || pathname === "/app-api/billing/") {
    const response = await billingSummaryRoute({
      method,
      path: pathWithQuery,
      headers,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/billing/checkout" || pathname === "/billing/checkout/") {
    const response = await billingCheckoutRoute({
      method,
      path: pathWithQuery,
      headers,
      body,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/billing/portal" || pathname === "/billing/portal/") {
    const response = await billingPortalRoute({
      method,
      path: pathWithQuery,
      headers,
      body,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }

  if (pathname === "/webhooks/stripe" || pathname === "/webhooks/stripe/") {
    const response = await stripeWebhookRoute({
      method,
      path: pathWithQuery,
      headers,
      body,
    });
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
    const receivedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    try {
      const handledPmtiles = await maybeHandleDemoPmtilesRequest(request, response, bootstrap);
      if (handledPmtiles) {
        return;
      }
      const requestBody = await readRequestBody(request, shouldReadRawBody(request.url) ? "text" : "json");
      const routed = await routeRequest(request, bootstrap, requestBody);
      sendResponse(response, routed);
      const requestHost = request.headers.host ?? "127.0.0.1";
      const url = new URL(request.url ?? "/", `http://${requestHost}`);
      if (isTelemetryPath(url.pathname)) {
        const method = (request.method ?? "GET").toUpperCase();
        if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
          emitDeliveryTelemetry({
            tilePath: `${url.pathname}${url.search}`,
            responseHeaders: routed.headers,
            responseBody: routed.body,
            statusCode: routed.status,
            normalizedMethod: method,
            latencyMs: Date.now() - startedAtMs,
            receivedAt,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected error";
      sendResponse(response, jsonResponse(500, { error: "SERVER_ERROR", message }));
    }
  });

  server.listen(port, host, () => {
    console.log(`Local server running at http://${host}:${port}/`);
    console.log(`PMTiles source: ${bootstrap.pmtilesLocation}`);
    console.log(`Artifact: ${bootstrap.artifactId}${bootstrap.artifactAvailable ? "" : " (unavailable; shell-only mode)"}`);
    console.log(`Styles: ${bootstrap.styleIds.join(", ")}`);
    console.log(`Preview token: ${bootstrap.accessToken}`);
  });

  let shuttingDown = false;
  const SHUTDOWN_GRACE_MS = 30_000;

  async function shutdown(reason: "SIGTERM" | "SIGINT" | "uncaught"): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${reason}; starting graceful shutdown.`);
    const closeServer = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    const drainTimeout = new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), SHUTDOWN_GRACE_MS);
      timer.unref();
    });
    try {
      await Promise.race([closeServer, drainTimeout]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "shutdown error";
      console.error(`Server close failed: ${message}`);
    }
    try {
      await prisma.$disconnect();
    } catch (error) {
      const message = error instanceof Error ? error.message : "prisma disconnect error";
      console.error(`Prisma disconnect failed: ${message}`);
    }
    process.exitCode = 0;
    console.log("Graceful shutdown complete.");
  }

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : "unknown startup error";
  console.error(message);
  process.exitCode = 1;
});
