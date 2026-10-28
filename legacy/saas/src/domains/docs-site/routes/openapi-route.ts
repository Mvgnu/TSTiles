import type { HttpMethod } from "../../../contracts/types";
import { getOpenApiJson } from "../docs-site.service";

interface OpenApiRequest {
  readonly method: HttpMethod;
  readonly path: string;
}

export interface OpenApiResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOpenApiRequest(input: unknown): OpenApiRequest | null {
  if (!isRecord(input)) {
    return null;
  }
  if (typeof input.method !== "string" || typeof input.path !== "string") {
    return null;
  }
  return {
    method: input.method as HttpMethod,
    path: input.path,
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

function isOpenApiPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/docs/openapi.json" || normalized === "/docs/openapi.json/";
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

export async function docsOpenApiRoute(input: OpenApiRequest): Promise<OpenApiResponse> {
  const request = normalizeOpenApiRequest(input);
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
  if (!isOpenApiPath(request.path)) {
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
        "cache-control": "public, max-age=60",
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
  const openApi = getOpenApiJson();
  const serialized = JSON.stringify(openApi);
  const contentLength = String(byteLengthUtf8(serialized));
  return {
    status: 200,
    body: request.method === "HEAD" ? undefined : serialized,
    headers: {
      ...corsHeaders("GET,HEAD,OPTIONS"),
      "content-type": "application/json",
      "cache-control": "public, max-age=60",
      "content-length": contentLength,
    },
  };
}
