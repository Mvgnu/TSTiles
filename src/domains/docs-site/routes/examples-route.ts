import type { HttpMethod } from "../../../contracts/types";
import { getExamples } from "../docs-site.service";

interface ExamplesRequest {
  readonly method: HttpMethod;
  readonly path: string;
}

export interface ExamplesResponse {
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

export async function docsExamplesRoute(input: ExamplesRequest): Promise<ExamplesResponse> {
  if (!isExamplesPath(input.path)) {
    return {
      status: 404,
      body: bodyForMethod(input.method, JSON.stringify({ error: "DOCS_NOT_FOUND" })),
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
        "cache-control": "public, max-age=120",
      },
    };
  }
  if (input.method !== "GET" && input.method !== "HEAD") {
    return {
      status: 400,
      body: bodyForMethod(input.method, JSON.stringify({ error: "DOCS_BAD_REQUEST" })),
      headers: {
        ...corsHeaders("GET,HEAD,OPTIONS"),
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  const examples = getExamples();
  const serialized = JSON.stringify(examples);
  const contentLength = String(byteLengthUtf8(serialized));
  return {
    status: 200,
    body: input.method === "HEAD" ? undefined : serialized,
    headers: {
      ...corsHeaders("GET,HEAD,OPTIONS"),
      "content-type": "application/json",
      "cache-control": "public, max-age=120",
      "content-length": contentLength,
    },
  };
}
