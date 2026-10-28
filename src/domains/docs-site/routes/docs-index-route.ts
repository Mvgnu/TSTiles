import type { HttpMethod } from "../../../contracts/types";
import { getDocsGuidePage, getDocsIndex } from "../docs-site.service";
import type { DocsGuideSlug } from "../types";
import { renderDocsGuideHtml } from "./html";

interface DocsRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
}

export interface DocsResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHeaders(value: unknown): DocsRequest["headers"] | null {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return null;
  }
  const headers: Record<string, string | undefined> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" && entry !== undefined) {
      return null;
    }
    headers[key] = entry;
  }
  return headers;
}

function normalizeDocsRequest(input: unknown): DocsRequest | null {
  if (!isRecord(input)) {
    return null;
  }
  if (typeof input.method !== "string" || typeof input.path !== "string") {
    return null;
  }
  const headers = normalizeHeaders(input.headers);
  if (headers === null) {
    return null;
  }
  return {
    method: input.method as HttpMethod,
    path: input.path,
    headers,
  };
}

function corsHeaders(allowedMethods: string): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": allowedMethods,
    "access-control-allow-headers": "authorization,content-type",
    vary: "origin",
  };
}

function parseBody(body: unknown): string {
  return JSON.stringify(body);
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizePath(path: string): string {
  const [withoutQuery] = path.split("?");
  return withoutQuery || "/";
}

function isDocsIndexPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/docs" || normalized === "/docs/" || normalized.startsWith("/docs/");
}

function bodyForMethod(method: HttpMethod, body: string): string | undefined {
  if (method === "HEAD") {
    return undefined;
  }
  return body;
}

function docsGuideSlug(path: string): DocsGuideSlug | null {
  const normalized = normalizePath(path);
  const matched = /^\/docs\/([^/]+)\/?$/.exec(normalized);
  if (!matched?.[1]) {
    return null;
  }
  let segment: string;
  try {
    segment = decodeURIComponent(matched[1]);
  } catch {
    return null;
  }
  if (
    segment === "quickstart"
    || segment === "authentication"
    || segment === "maplibre"
    || segment === "raster"
    || segment === "static-maps"
    || segment === "styles"
    || segment === "api"
  ) {
    return segment;
  }
  return null;
}

function acceptsHtml(headers: Readonly<Record<string, string | undefined>> | undefined): boolean {
  let accept = headers?.accept;
  if (typeof accept !== "string" && headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === "accept") {
        accept = value;
        break;
      }
    }
  }
  const normalized = (accept ?? "").toLowerCase();
  return normalized.includes("text/html") || normalized.includes("application/xhtml+xml");
}

export async function docsIndexRoute(input: DocsRequest): Promise<DocsResponse> {
  const request = normalizeDocsRequest(input);
  if (!request) {
    return {
      status: 400,
      body: JSON.stringify({ error: "DOCS_BAD_REQUEST" }),
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  if (!isDocsIndexPath(request.path)) {
    return {
      status: 404,
      body: bodyForMethod(request.method, JSON.stringify({ error: "DOCS_NOT_FOUND" })),
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  if (request.method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
      },
    };
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return {
      status: 400,
      body: bodyForMethod(request.method, JSON.stringify({ error: "DOCS_BAD_REQUEST" })),
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  const guideSlug = docsGuideSlug(request.path);
  if (guideSlug) {
    const guide = await getDocsGuidePage(guideSlug);
    if (acceptsHtml(request.headers)) {
      const html = renderDocsGuideHtml(guide);
      const contentLength = String(byteLengthUtf8(html));
      return {
        status: 200,
        body: bodyForMethod(request.method, html),
        headers: {
          ...corsHeaders("GET,HEAD,OPTIONS"),
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          "content-length": contentLength,
        },
      };
    }
    const serialized = parseBody(guide);
    const contentLength = String(byteLengthUtf8(serialized));
    return {
      status: 200,
      body: bodyForMethod(request.method, serialized),
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
        "content-length": contentLength,
      },
    };
  }
  if (normalizePath(request.path).startsWith("/docs/")) {
    return {
      status: 404,
      body: bodyForMethod(request.method, JSON.stringify({ error: "DOCS_NOT_FOUND" })),
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  if (acceptsHtml(request.headers)) {
    const html = renderDocsGuideHtml(await getDocsGuidePage("index"));
    const contentLength = String(byteLengthUtf8(html));
    return {
      status: 200,
      body: bodyForMethod(request.method, html),
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
        "content-length": contentLength,
      },
    };
  }
  const index = getDocsIndex();
  const serialized = parseBody(index);
  const contentLength = String(byteLengthUtf8(serialized));
  return {
    status: 200,
    body: request.method === "HEAD" ? undefined : serialized,
    headers: {
      ...corsHeaders("GET,HEAD,OPTIONS"),
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "content-length": contentLength,
    },
  };
}
