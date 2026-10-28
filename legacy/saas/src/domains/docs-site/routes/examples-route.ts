import type { HttpMethod } from "../../../contracts/types";
import { getDocsGuidePage, getExamples } from "../docs-site.service";
import { renderDocsGuideHtml } from "./html";

interface ExamplesRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
}

export interface ExamplesResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHeaders(value: unknown): ExamplesRequest["headers"] | null {
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

function normalizeExamplesRequest(input: unknown): ExamplesRequest | null {
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

function normalizePath(path: string): string {
  const [withoutQuery] = path.split("?");
  return withoutQuery || "/";
}

function isExamplesPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/docs/examples" || normalized === "/docs/examples/";
}

function bodyForMethod(method: HttpMethod, body: string): string | undefined {
  if (method === "HEAD") {
    return undefined;
  }
  return body;
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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

export async function docsExamplesRoute(input: ExamplesRequest): Promise<ExamplesResponse> {
  const request = normalizeExamplesRequest(input);
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
  if (!isExamplesPath(request.path)) {
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
        "cache-control": "public, max-age=120",
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
  if (acceptsHtml(request.headers)) {
    const html = renderDocsGuideHtml(await getDocsGuidePage("examples"));
    const contentLength = String(byteLengthUtf8(html));
    return {
      status: 200,
      body: bodyForMethod(request.method, html),
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=120",
        "content-length": contentLength,
      },
    };
  }
  const examples = await getExamples();
  const serialized = JSON.stringify(examples);
  const contentLength = String(byteLengthUtf8(serialized));
  return {
    status: 200,
    body: request.method === "HEAD" ? undefined : serialized,
    headers: {
      ...corsHeaders("GET,HEAD,OPTIONS"),
      "content-type": "application/json",
      "cache-control": "public, max-age=120",
      "content-length": contentLength,
    },
  };
}
