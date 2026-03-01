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

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function docsOpenApiRoute(input: OpenApiRequest): Promise<OpenApiResponse> {
  if (!isOpenApiPath(input.path)) {
    return {
      status: 404,
      body: JSON.stringify({ error: "DOCS_NOT_FOUND" }),
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  if (input.method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "application/json",
        "cache-control": "public, max-age=60",
      },
    };
  }
  if (input.method !== "GET" && input.method !== "HEAD") {
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
  const openApi = getOpenApiJson();
  const serialized = JSON.stringify(openApi);
  const contentLength = String(byteLengthUtf8(serialized));
  return {
    status: 200,
    body: input.method === "HEAD" ? undefined : serialized,
    headers: {
      ...corsHeaders("GET,HEAD,OPTIONS"),
      "content-type": "application/json",
      "cache-control": "public, max-age=60",
      "content-length": contentLength,
    },
  };
}
