import {
  getStyle,
  listStyles,
  resolveStyleAssets,
} from "./styles.service";
import { StyleError, StyleErrorCode, type StyleVersionId } from "./types";

type HttpMethod = "GET" | "HEAD" | "OPTIONS";

export interface StyleRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | string[] | undefined>>;
}

export interface StyleResponse {
  readonly status: number;
  readonly body?: Uint8Array | string;
  readonly headers: Record<string, string>;
}

interface ParsedStylePath {
  readonly family:
    | "list"
    | "styleJson"
    | "sprite"
    | "glyphs";
  readonly styleId?: string;
  readonly versionId?: StyleVersionId;
  readonly name?: string;
}

function throwStyleRouteError(code: StyleErrorCode, details: string): never {
  throw new StyleError(code, details);
}

function getPublishedStyle(styleId: string): { styleId: string; document: ReturnType<typeof getStyle> } {
  const record = listStyles().find((entry) => entry.id === styleId);
  if (!record || !record.publishedVersionId) {
    throwStyleRouteError(StyleErrorCode.NOT_FOUND, "Style not found");
  }
  return {
    styleId,
    document: getStyle(styleId, record.publishedVersionId),
  };
}

const styleListRegex = /^\/(?:v1\/)?styles\/?$/;
const styleJsonRegex = /^\/(?:v1\/)?styles\/([^/]+)\/style\.json$/;
const spriteRegex = /^\/(?:v1\/)?styles\/([^/]+)\/sprites\/([^/]+)\.(png|json)$/;
const fontRegex = /^\/(?:v1\/)?fonts\/([^/]+)\/([^/]+)\.pbf$/;

function normalizePath(path: string): string {
  const queryIndex = path.indexOf("?");
  return queryIndex >= 0 ? path.slice(0, queryIndex) : path;
}

function buildCorsHeaders(): Record<string, string> {
  return {
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type",
    vary: "origin",
  };
}

function normalizePathSegment(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throwStyleRouteError(StyleErrorCode.BAD_REQUEST, field);
  }
  return trimmed;
}

function parseStylePath(path: string): ParsedStylePath {
  const normalized = normalizePath(path);
  if (styleListRegex.test(normalized)) {
    return { family: "list" };
  }
  const jsonMatch = styleJsonRegex.exec(normalized);
  if (jsonMatch && jsonMatch.length === 2) {
    try {
      return {
        family: "styleJson",
        styleId: normalizePathSegment(decodeURIComponent(jsonMatch[1] ?? ""), "styleId"),
      };
    } catch {
      throwStyleRouteError(StyleErrorCode.BAD_REQUEST, "style path");
    }
  }
  const spriteMatch = spriteRegex.exec(normalized);
  if (spriteMatch && spriteMatch.length === 4) {
    try {
      const styleId = normalizePathSegment(decodeURIComponent(spriteMatch[1] ?? ""), "styleId");
      const spriteName = normalizePathSegment(spriteMatch[2] ?? "", "spriteName");
      const spriteExt = normalizePathSegment(spriteMatch[3] ?? "", "spriteExt");
      return {
        family: "sprite",
        styleId,
        name: `${spriteName}.${spriteExt}`,
        versionId: undefined,
      };
    } catch {
      throwStyleRouteError(StyleErrorCode.BAD_REQUEST, "sprite path");
    }
  }
  const fontMatch = fontRegex.exec(normalized);
  if (fontMatch && fontMatch.length === 3) {
    try {
      return {
        family: "glyphs",
        styleId: "global-fonts",
        name: `${decodeURIComponent(fontMatch[1] ?? "")}/${fontMatch[2] ?? ""}`,
      };
    } catch {
      throwStyleRouteError(StyleErrorCode.BAD_REQUEST, "font path");
    }
  }
  throwStyleRouteError(StyleErrorCode.BAD_REQUEST, "path");
}

function encodeJsonError(code: string): string {
  return JSON.stringify({ error: code });
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function handleStyleRequest(input: StyleRequest): Promise<StyleResponse> {
  const method = input.method;
  try {
    if (method === "OPTIONS") {
      parseStylePath(input.path);
      return {
        status: 204,
        headers: {
          ...buildCorsHeaders(),
          "cache-control": "public, max-age=60",
        },
      };
    }
    if (method !== "GET" && method !== "HEAD") {
      return {
        status: 400,
        body: encodeJsonError("STYLE_BAD_REQUEST"),
        headers: {
          ...buildCorsHeaders(),
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      };
    }

    const parsed = parseStylePath(input.path);
    if (parsed.family === "list") {
      const published = listStyles().filter((entry) => entry.publishedVersionId);
      const body = JSON.stringify(published);
      const contentLength = String(byteLengthUtf8(body));
      return {
        status: 200,
        body: method === "HEAD" ? undefined : body,
        headers: {
          ...buildCorsHeaders(),
          "content-type": "application/json",
          "content-length": contentLength,
          "cache-control": "public, max-age=120",
          "x-style-count": String(published.length),
        },
      };
    }

    if (parsed.family === "styleJson") {
      const styleId = parsed.styleId ?? "";
      const { document: style } = getPublishedStyle(styleId);
      const body = JSON.stringify(style);
      const contentLength = String(byteLengthUtf8(body));
      return {
        status: 200,
        body: method === "HEAD" ? undefined : body,
        headers: {
          ...buildCorsHeaders(),
          "content-type": "application/json",
          "content-length": contentLength,
          "cache-control": "public, max-age=300",
          "x-style-id": styleId,
        },
      };
    }

    if (parsed.family === "sprite") {
      const styleId = parsed.styleId ?? "";
      getPublishedStyle(styleId);
      const isJson = (parsed.name?.endsWith(".json") ?? false);
      const payload: Uint8Array | string = isJson
        ? JSON.stringify({ sprites: "placeholder", name: parsed.name, styleId })
        : new Uint8Array([0x50, 0x4e, 0x47]);
      const contentLength = typeof payload === "string"
        ? String(byteLengthUtf8(payload))
        : String(payload.byteLength);
      return {
        status: 200,
        body: method === "HEAD" ? undefined : payload,
        headers: {
          ...buildCorsHeaders(),
          "content-type": isJson ? "application/json" : "image/png",
          "content-length": contentLength,
          "cache-control": "public, max-age=3600",
          "x-style-id": styleId,
          "x-style-version": resolveStyleAssets(styleId).versionId,
        },
      };
    }

    if (parsed.family === "glyphs") {
      const body = new TextEncoder().encode("glyph");
      return {
        status: 200,
        body: method === "HEAD" ? undefined : body,
        headers: {
          ...buildCorsHeaders(),
          "content-type": "application/octet-stream",
          "content-length": String(body.byteLength),
          "cache-control": "public, max-age=3600",
          "x-font-stack": parsed.name ?? "default",
        },
      };
    }
  } catch (error) {
    if (
      error instanceof StyleError
      && (error.code === StyleErrorCode.NOT_FOUND || error.code === StyleErrorCode.VERSION_NOT_FOUND)
    ) {
      return {
        status: 404,
        body: encodeJsonError("STYLE_NOT_FOUND"),
        headers: {
          ...buildCorsHeaders(),
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      };
    }
    if (
      error instanceof StyleError
      && (error.code === StyleErrorCode.BAD_REQUEST || error.code === StyleErrorCode.INVALID_DOCUMENT)
    ) {
      return {
        status: 400,
        body: encodeJsonError("STYLE_BAD_REQUEST"),
        headers: {
          ...buildCorsHeaders(),
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      };
    }
  }
  return {
    status: 500,
    body: encodeJsonError("STYLE_ROUTE_FAILED"),
    headers: {
      ...buildCorsHeaders(),
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  };
}
