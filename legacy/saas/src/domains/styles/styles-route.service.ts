import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getStyle,
  listStyles,
  resolveStyleAssets,
} from "./styles.service";
import { resolveArchiveProfile } from "../tile-resolver/tile-resolver.service";
import type { ResolvedArchiveProfile } from "../tile-resolver/types";
import { StyleError, StyleErrorCode, type StyleVersionId } from "./types";

type HttpMethod = "GET" | "HEAD" | "OPTIONS";

export interface StyleRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | string[] | undefined>>;
  readonly baseUrl?: string;
}

export interface StyleResponse {
  readonly status: number;
  readonly body?: Uint8Array | string;
  readonly headers: Record<string, string>;
}

function normalizeStyleRouteRequest(input: unknown): StyleRequest | null {
  if (!isRecord(input)) {
    return null;
  }
  if (typeof input.method !== "string" || typeof input.path !== "string") {
    return null;
  }
  if (input.baseUrl !== undefined && typeof input.baseUrl !== "string") {
    return null;
  }
  let query: StyleRequest["query"];
  if (input.query !== undefined) {
    if (!isRecord(input.query)) {
      return null;
    }
    const entries: Array<[string, string | string[] | undefined]> = [];
    for (const [key, value] of Object.entries(input.query)) {
      if (
        typeof value !== "string"
        && value !== undefined
        && !(Array.isArray(value) && value.every((entry) => typeof entry === "string"))
      ) {
        return null;
      }
      entries.push([key, value]);
    }
    query = Object.fromEntries(entries);
  }
  return {
    method: input.method as StyleRequest["method"],
    path: input.path,
    query,
    baseUrl: input.baseUrl,
  };
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

async function getPublishedStyle(styleId: string): Promise<{ styleId: string; document: ReturnType<typeof getStyle> extends Promise<infer T> ? T : never }> {
  const record = (await listStyles()).find((entry) => entry.id === styleId);
  if (!record || !record.publishedVersionId) {
    throwStyleRouteError(StyleErrorCode.NOT_FOUND, "Style not found");
  }
  return {
    styleId,
    document: await getStyle(styleId, record.publishedVersionId),
  };
}

const styleListRegex = /^\/(?:v1\/)?styles\/?$/;
const styleJsonRegex = /^\/(?:v1\/)?styles\/([^/]+)\/style\.json$/;
const spriteRegex = /^\/(?:v1\/)?styles\/([^/]+)\/sprites\/([^/]+)\.(png|json)$/;
const fontRegex = /^\/(?:v1\/)?fonts\/([^/]+)\/([^/]+)\.pbf$/;
const localStyleAssetRoot = resolve(process.cwd(), "assets/styles/seed");

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

function parseQueryValue(query: StyleRequest["query"], key: string): string | undefined {
  const raw = query?.[key];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const normalized = entry.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
    return undefined;
  }
  return typeof raw === "string" ? raw : undefined;
}

function resolveQuery(path: string, query: StyleRequest["query"]): Readonly<Record<string, string | string[] | undefined>> {
  const queryIndex = path.indexOf("?");
  if (queryIndex < 0) {
    return query ?? {};
  }
  const parsed = new URLSearchParams(path.slice(queryIndex + 1));
  const merged = new Map<string, string | string[] | undefined>();
  for (const [key, value] of parsed.entries()) {
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, value);
      continue;
    }
    if (Array.isArray(existing)) {
      merged.set(key, [...existing, value]);
      continue;
    }
    merged.set(key, [existing, value]);
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) {
      continue;
    }
    merged.set(key, value);
  }
  return Object.fromEntries(merged);
}

function pickAccessToken(query: StyleRequest["query"]): string | undefined {
  const candidate = parseQueryValue(query, "access_token") ?? parseQueryValue(query, "token");
  const normalized = candidate?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

async function materializePublicStyleDocument(
  styleId: string,
  document: ReturnType<typeof getStyle> extends Promise<infer U> ? U : ReturnType<typeof getStyle>,
  baseUrl?: string,
  archiveProfile?: ResolvedArchiveProfile | null,
): Promise<Record<string, unknown>> {
  const publicDocument = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
  const spriteValue = publicDocument.sprite;
  const internalSpritesTemplate = publicDocument.sprites;
  const assets = await resolveStyleAssets(styleId);
  const currentGlyphs = publicDocument.glyphs;

  if (
    (typeof internalSpritesTemplate === "string" && typeof spriteValue !== "string")
    || (typeof spriteValue === "string" && spriteValue.startsWith("/"))
    || (typeof spriteValue === "string" && spriteValue.includes("basemaps-assets/sprites/"))
  ) {
    publicDocument.sprite = absolutizePublicUrl(baseUrl, assets.spritePng.replace(/\.png$/u, ""));
  }
  if (
    currentGlyphs === undefined
    || (typeof currentGlyphs === "string" && currentGlyphs.startsWith("/"))
    || (typeof currentGlyphs === "string" && currentGlyphs.includes("basemaps-assets/fonts/"))
  ) {
    publicDocument.glyphs = absolutizePublicUrl(baseUrl, assets.glyphs);
  }
  const sources = publicDocument.sources;
  if (isRecord(sources)) {
    for (const sourceValue of Object.values(sources)) {
      if (!isRecord(sourceValue)) {
        continue;
      }
      if (Array.isArray(sourceValue.tiles)) {
        sourceValue.tiles = sourceValue.tiles.map((tileUrl) => (
          typeof tileUrl === "string" ? absolutizePublicUrl(baseUrl, tileUrl) : tileUrl
        ));
      }
      if (typeof sourceValue.url === "string") {
        sourceValue.url = absolutizePublicUrl(baseUrl, sourceValue.url);
      }
      if (sourceValue.type === "vector" && archiveProfile) {
        if (typeof sourceValue.minzoom !== "number") {
          sourceValue.minzoom = archiveProfile.minZoom;
        }
        if (typeof sourceValue.maxzoom !== "number") {
          sourceValue.maxzoom = archiveProfile.maxZoom;
        }
      }
    }
  }
  delete publicDocument.sprites;
  return publicDocument;
}

async function encodeStyleDocumentResponse(
  styleId: string,
  document: ReturnType<typeof getStyle> extends Promise<infer V> ? V : never,
  baseUrl?: string,
  archiveProfile?: ResolvedArchiveProfile | null,
  accessToken?: string,
): Promise<string> {
  const materialized = await materializePublicStyleDocument(styleId, document, baseUrl, archiveProfile);
  const serialized = JSON.stringify(materialized);
  if (accessToken) {
    return serialized.replace(/\{access_token\}/g, encodeURIComponent(accessToken));
  }
  return serialized
    .replace(/([?&])access_token=\{access_token\}(&?)/g, (_match, prefix: string, suffix: string) => {
      if (prefix === "?" && suffix === "&") {
        return "?";
      }
      if (prefix === "&" && suffix === "&") {
        return "&";
      }
      return "";
    })
    .replace(/\?"/g, "\"")
    .replace(/\?&/g, "?")
    .replace(/&&/g, "&");
}

function styleResponseCacheControl(): string {
  return "public, max-age=300";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePublicBaseUrl(baseUrl: string): string {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin;
    }
  } catch {
    if (baseUrl.startsWith("/")) {
      return "";
    }
  }
  return "";
}

function absolutizePublicUrl(baseUrl: string | undefined, value: string): string {
  if (!baseUrl || value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  if (!value.startsWith("/")) {
    return value;
  }
  return `${normalizePublicBaseUrl(baseUrl).replace(/\/+$/u, "")}${value}`;
}

function resolveSpriteVariant(styleId: string): string {
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

function resolveSpriteAssetFile(styleId: string, spriteAssetName: string): string {
  const variant = resolveSpriteVariant(styleId);
  const resolvedAssetName = spriteAssetName.replace(/^sprite/u, variant);
  return resolve(localStyleAssetRoot, "sprites", resolvedAssetName);
}

function resolveGlyphAssetFile(fontRequestName: string): string {
  const separator = fontRequestName.lastIndexOf("/");
  if (separator <= 0 || separator >= fontRequestName.length - 1) {
    throwStyleRouteError(StyleErrorCode.BAD_REQUEST, "font path");
  }
  const fontstack = fontRequestName.slice(0, separator);
  const range = fontRequestName.slice(separator + 1);
  return resolve(localStyleAssetRoot, "fonts", fontstack, `${range}.pbf`);
}

async function readStaticAsset(filePath: string): Promise<Uint8Array> {
  try {
    return await readFile(filePath);
  } catch {
    throwStyleRouteError(StyleErrorCode.NOT_FOUND, "asset");
  }
}

async function resolveStaticAssetLength(filePath: string): Promise<string> {
  try {
    const metadata = await stat(filePath);
    return String(metadata.size);
  } catch {
    throwStyleRouteError(StyleErrorCode.NOT_FOUND, "asset");
  }
}

function normalizePathSegment(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throwStyleRouteError(StyleErrorCode.BAD_REQUEST, field);
  }
  if (trimmed === "." || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
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
      const fontstack = normalizePathSegment(decodeURIComponent(fontMatch[1] ?? ""), "fontstack");
      const range = normalizePathSegment(fontMatch[2] ?? "", "range");
      return {
        family: "glyphs",
        styleId: "global-fonts",
        name: `${fontstack}/${range}`,
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

function bodyForMethod(method: HttpMethod, body: string): string | undefined {
  if (method === "HEAD") {
    return undefined;
  }
  return body;
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function handleStyleRequest(input: StyleRequest): Promise<StyleResponse> {
  const request = normalizeStyleRouteRequest(input);
  if (!request) {
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
  const method = request.method;
  const query = resolveQuery(request.path, request.query);
  try {
    if (method === "OPTIONS") {
      parseStylePath(request.path);
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
        body: bodyForMethod(method, encodeJsonError("STYLE_BAD_REQUEST")),
        headers: {
          ...buildCorsHeaders(),
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      };
    }

    const parsed = parseStylePath(request.path);
    if (parsed.family === "list") {
      const published = (await listStyles()).filter((entry) => entry.publishedVersionId);
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
      const { document: style } = await getPublishedStyle(styleId);
      const accessToken = pickAccessToken(query);
      let archiveProfile: ResolvedArchiveProfile | null = null;
      try {
        archiveProfile = await resolveArchiveProfile();
      } catch {
        archiveProfile = null;
      }
      const body = await encodeStyleDocumentResponse(styleId, style, request.baseUrl, archiveProfile, accessToken);
      const contentLength = String(byteLengthUtf8(body));
      return {
        status: 200,
        body: method === "HEAD" ? undefined : body,
        headers: {
          ...buildCorsHeaders(),
          "content-type": "application/json",
          "content-length": contentLength,
          "cache-control": styleResponseCacheControl(),
          "x-style-id": styleId,
        },
      };
    }

    if (parsed.family === "sprite") {
      const styleId = parsed.styleId ?? "";
      await getPublishedStyle(styleId);
      const filePath = resolveSpriteAssetFile(styleId, parsed.name ?? "sprite.json");
      const body = method === "HEAD" ? undefined : await readStaticAsset(filePath);
      const contentLength = await resolveStaticAssetLength(filePath);
      const contentType = (parsed.name?.endsWith(".json") ?? false) ? "application/json" : "image/png";
      return {
        status: 200,
        body,
        headers: {
          ...buildCorsHeaders(),
          "content-type": contentType,
          "content-length": contentLength,
          "cache-control": "public, max-age=3600",
          "x-style-id": styleId,
          "x-style-version": (await resolveStyleAssets(styleId)).versionId,
        },
      };
    }

    if (parsed.family === "glyphs") {
      const filePath = resolveGlyphAssetFile(parsed.name ?? "");
      const body = method === "HEAD" ? undefined : await readStaticAsset(filePath);
      const contentLength = await resolveStaticAssetLength(filePath);
      return {
        status: 200,
        body,
        headers: {
          ...buildCorsHeaders(),
          "content-type": "application/x-protobuf",
          "content-length": contentLength,
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
        body: bodyForMethod(method, encodeJsonError("STYLE_NOT_FOUND")),
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
        body: bodyForMethod(method, encodeJsonError("STYLE_BAD_REQUEST")),
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
    body: bodyForMethod(method, encodeJsonError("STYLE_ROUTE_FAILED")),
    headers: {
      ...buildCorsHeaders(),
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  };
}
