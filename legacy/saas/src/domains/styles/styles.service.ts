import { randomUUID } from "node:crypto";
import { prisma } from "../../config/db";
import type {
  StyleAssets,
  StyleDocument,
  StyleTemplateConfig,
  StyleInput,
  StyleListItem,
  StyleVersion,
} from "./types";
import { StyleErrorCode, StyleError } from "./types";

// Replaced Map-based internal structures with Prisma integration

const TEMPLATED_TILE_PATH = /^\/?v1\/tiles\/\{z\}\/\{x\}\/\{y\}\.mvt(?:\?[^\s#]*)?$/;
const TILE_TOKEN_PATTERN = /(^|[&?])access_token=\{access_token\}(?:&|$)/;
const SPRITE_PATTERN = /^\/?v1\/styles\/\{style(?:Id|_id)\}\/sprites?(\/|$)/;
const GLYPH_PATTERN = /^\/?v1\/fonts\/\{fontstack\}\/\{range\}\.pbf$/;

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTemplateWithoutRawToken(value: string): boolean {
  const hasRawToken = value.includes("pk.") || value.includes("sk.");
  const hasCredentialQuery = /access_token=[^\s#]*/.test(value);
  return !hasRawToken && (!hasCredentialQuery || value.includes("{access_token}"));
}

function splitTileTemplateUrl(url: string): { readonly templatePath: string; readonly search: string } {
  const isAbsoluteUrl = url.startsWith("http://") || url.startsWith("https://");
  if (isAbsoluteUrl) {
    const parsed = new URL(url);
    return {
      templatePath: parsed.pathname,
      search: parsed.search,
    };
  }
  const separator = url.indexOf("?");
  if (separator < 0) {
    return {
      templatePath: url,
      search: "",
    };
  }
  return {
    templatePath: url.slice(0, separator),
    search: url.slice(separator),
  };
}

function validateSourceTileUrl(label: string, url: unknown): void {
  if (!isString(url)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, `${label} tile source must be a URL template`);
  }
  if (!isTemplateWithoutRawToken(url)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, `${label} tile source must not expose raw credentials`);
  }
  const { templatePath, search } = splitTileTemplateUrl(url);
  const fullPath = `${templatePath}${search}`;
  if (!TEMPLATED_TILE_PATH.test(fullPath)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, `${label} tile source must use the service tile template`);
  }
  if (!TILE_TOKEN_PATTERN.test(search)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, `${label} tile source must include {access_token} placeholder`);
  }
}

function validateSourceSourceObject(source: unknown, sourceName: string): void {
  if (sourceName.trim() === "") {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "style source names must be non-empty");
  }
  if (!isRecord(source)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, `style source ${sourceName} must be an object`);
  }
  const sourceUrl = source.url;
  const sourceTiles = source.tiles;

  if (sourceUrl !== undefined) {
    validateSourceTileUrl(`source ${sourceName}`, sourceUrl);
    return;
  }

  if (Array.isArray(sourceTiles)) {
    if (!sourceTiles.length) {
      throw buildError(StyleErrorCode.INVALID_DOCUMENT, `source ${sourceName} must include non-empty tile templates`);
    }
    for (const [index, tileUrl] of sourceTiles.entries()) {
      if (typeof tileUrl !== "string") {
        throw buildError(StyleErrorCode.INVALID_DOCUMENT, `source ${sourceName} tile ${index} must be a URL string`);
      }
      validateSourceTileUrl(`source ${sourceName}`, tileUrl);
    }
    return;
  }

  throw buildError(StyleErrorCode.INVALID_DOCUMENT, `source ${sourceName} must include url or tiles`);
}

function validateSourceObject(sources: Record<string, unknown>): void {
  if (Object.keys(sources).length === 0) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "Style JSON must include at least one source");
  }
  for (const [sourceName, source] of Object.entries(sources)) {
    validateSourceSourceObject(source, sourceName);
  }
}

function validateSpriteTemplate(sprites: unknown): void {
  if (!isString(sprites)) {
    return;
  }
  if (!isTemplateWithoutRawToken(sprites)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "sprites URL must not contain raw credentials");
  }
  if (!SPRITE_PATTERN.test(sprites)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "sprites URL must be service template placeholder");
  }
}

function validateGlyphTemplate(glyphs: unknown): void {
  if (!isString(glyphs)) {
    return;
  }
  if (!isTemplateWithoutRawToken(glyphs)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "glyphs URL must not contain raw credentials");
  }
  if (!GLYPH_PATTERN.test(glyphs)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "glyphs URL must be service template placeholder");
  }
}

// Styles map removed in favor of SQLite Prisma models.

function buildError(code: StyleErrorCode, message: string): StyleError {
  return new StyleError(code, message);
}

function normalizeStyleInput(input: unknown): StyleInput {
  if (!isRecord(input)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "Invalid style document");
  }
  return input;
}

function normalizeStoredSource(source: unknown): Record<string, unknown> | unknown {
  if (!isRecord(source)) {
    return source;
  }
  const normalized: Record<string, unknown> = { ...source };
  const tileTemplate = normalized.url;
  if (typeof tileTemplate === "string") {
    normalized.tiles = [tileTemplate];
    delete normalized.url;
  }
  return normalized;
}

function normalizeStoredStyleDocument(document: StyleInput): StyleDocument {
  const normalized: Record<string, unknown> = {
    ...document,
  };
  if (!isRecord(document.sources)) {
    return normalized as StyleDocument;
  }
  const sources: Record<string, unknown> = {};
  for (const [sourceName, source] of Object.entries(document.sources)) {
    sources[sourceName] = normalizeStoredSource(source);
  }
  normalized.sources = sources;
  return normalized as StyleDocument;
}

function cloneStyleDocument(document: StyleDocument): StyleDocument {
  try {
    const serialized = JSON.stringify(normalizeStoredStyleDocument(document));
    const parsed = JSON.parse(serialized) as unknown;
    const normalized = normalizeStyleInput(parsed);
    assertValidStyleDocument(normalized);
    return normalized;
  } catch (error) {
    if (error instanceof StyleError) {
      throw error;
    }
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "Style document must be serializable JSON");
  }
}

function cloneStyleVersion(version: StyleVersion): StyleVersion {
  return {
    ...version,
    document: cloneStyleDocument(version.document),
  };
}

function parseStoredStyleDocument(raw: string): StyleDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "stored style document is invalid");
  }
  const normalized = normalizeStyleInput(parsed);
  assertValidStyleDocument(normalized);
  return cloneStyleDocument(normalized);
}

function normalizeRequiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, `${field} must be non-empty`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, `${field} must be non-empty`);
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized.includes("..")) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, `${field} contains unsupported path characters`);
  }
  return normalized;
}

function normalizeOptionalVersionIdentifier(value?: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "versionId must be non-empty");
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "versionId must be non-empty");
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized.includes("..")) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "versionId contains unsupported path characters");
  }
  return normalized;
}

export function buildDefaultStyleTemplate(config: StyleTemplateConfig): StyleDocument {
  if (!isRecord(config)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "style template config must be an object");
  }
  const { sourceName, tilesTemplate, spriteTemplate, glyphTemplate } = config;
  normalizeRequiredIdentifier(config.styleId, "styleId");
  if (sourceName !== undefined && typeof sourceName !== "string") {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "sourceName must be a string");
  }
  if (tilesTemplate !== undefined && typeof tilesTemplate !== "string") {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "tilesTemplate must be a string");
  }
  if (spriteTemplate !== undefined && typeof spriteTemplate !== "string") {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "spriteTemplate must be a string");
  }
  if (glyphTemplate !== undefined && typeof glyphTemplate !== "string") {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "glyphTemplate must be a string");
  }
  const normalizedSourceName = sourceName?.trim() || "default";
  const normalizedTilesTemplate = tilesTemplate?.trim() || "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}";
  const normalizedSpriteTemplate = spriteTemplate?.trim() || "/v1/styles/{styleId}/sprites/sprite";
  const normalizedGlyphTemplate = glyphTemplate?.trim() || "/v1/fonts/{fontstack}/{range}.pbf";
  return {
    version: 8,
    sources: {
      [normalizedSourceName]: {
        type: "vector",
        tiles: [normalizedTilesTemplate],
      },
    },
    sprites: normalizedSpriteTemplate,
    glyphs: normalizedGlyphTemplate,
    layers: [],
  };
}

function assertValidStyleDocument(document: StyleInput): asserts document is StyleDocument {
  const version = document.version;
  const sources = document.sources;
  if (typeof version !== "number" || version < 8) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "Style JSON must include mapbox version");
  }
  if (!isRecord(sources)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "Style JSON must include a sources object");
  }
  const serialized = JSON.stringify(document);
  if (serialized.includes("pk.") || serialized.includes("sk.")) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "Style JSON must not contain raw credentials");
  }
  validateSourceObject(sources);
  validateSpriteTemplate(document.sprites);
  validateGlyphTemplate(document.glyphs);
}

export function validateStyleDocument(style: unknown): {
  readonly valid: boolean;
  readonly reason?: string;
} {
  try {
    const normalized = normalizeStyleInput(style);
    assertValidStyleDocument(normalized);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : "Invalid style document",
    };
  }
}

async function getStyleRecord(styleId: string) {
  const record = await prisma.style.findUnique({
    where: { id: styleId },
    include: { versions: true },
  });
  if (!record) {
    throw buildError(StyleErrorCode.NOT_FOUND, "Style not found");
  }
  const normalized = normalizeStoredStyleRecord(record);
  if (!normalized) {
    throw buildError(StyleErrorCode.NOT_FOUND, "Style not found");
  }
  return normalized;
}

function normalizeStyleListItemRow(value: unknown): StyleListItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const latestVersionId = value.latestVersionId;
  const publishedVersionId = value.publishedVersionId;
  if (id.length === 0 || name.length === 0) {
    return null;
  }
  if (latestVersionId !== null && typeof latestVersionId !== "string") {
    return null;
  }
  if (publishedVersionId !== null && publishedVersionId !== undefined && typeof publishedVersionId !== "string") {
    return null;
  }
  return {
    id,
    name,
    latestVersionId,
    publishedVersionId: publishedVersionId ?? undefined,
  };
}

function normalizeStoredStyleRecord(
  value: unknown,
): { readonly id: string; readonly name: string; readonly latestVersionId: string | null; readonly publishedVersionId: string | null } | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const latestVersionId = value.latestVersionId;
  const publishedVersionId = value.publishedVersionId;
  if (id.length === 0 || name.length === 0) {
    return null;
  }
  if (latestVersionId !== null && typeof latestVersionId !== "string") {
    return null;
  }
  if (publishedVersionId !== null && typeof publishedVersionId !== "string") {
    return null;
  }
  return {
    id,
    name,
    latestVersionId,
    publishedVersionId,
  };
}

export async function listStyles(): Promise<StyleListItem[]> {
  const records = await prisma.style.findMany({
    orderBy: [
      { createdAt: "desc" },
      { id: "asc" },
    ],
  });
  return records
    .map((style) => normalizeStyleListItemRow(style))
    .filter((style): style is StyleListItem => style !== null);
}

async function ensureVersionExists(styleId: string, versionId: string): Promise<StyleVersion> {
  const version = await prisma.styleVersion.findUnique({
    where: { id: versionId },
  });
  if (!version || version.styleId !== styleId) {
    throw buildError(StyleErrorCode.VERSION_NOT_FOUND, "Style version not found");
  }
  return {
    id: version.id,
    styleId: version.styleId,
    createdAt: version.createdAt,
    document: parseStoredStyleDocument(version.document),
  };
}

export async function getStyle(styleId: string, versionId?: string): Promise<StyleDocument> {
  const normalizedStyleId = normalizeRequiredIdentifier(styleId, "styleId");
  const normalizedVersionId = normalizeOptionalVersionIdentifier(versionId);
  const record = await getStyleRecord(normalizedStyleId);
  let targetVersion: string | null = record.latestVersionId;
  if (normalizedVersionId) {
    targetVersion = normalizedVersionId;
  } else if (record.publishedVersionId) {
    targetVersion = record.publishedVersionId;
  }
  if (!targetVersion) {
    throw buildError(StyleErrorCode.VERSION_NOT_FOUND, "No published style version");
  }
  const version = await ensureVersionExists(normalizedStyleId, targetVersion);
  return cloneStyleDocument(version.document);
}

export async function createStyleVersion(styleId: string, input: unknown): Promise<StyleVersion> {
  const normalizedStyleId = normalizeRequiredIdentifier(styleId, "styleId");
  const document = normalizeStyleInput(input);
  assertValidStyleDocument(document);
  const storedDocument = cloneStyleDocument(document);
  const createdAt = new Date().toISOString();
  const versionId = `${normalizedStyleId}-${randomUUID().slice(0, 8)}`;
  
  const versionData = {
    id: versionId,
    styleId: normalizedStyleId,
    createdAt,
    document: JSON.stringify(storedDocument),
  };

  const createdVersion = await prisma.$transaction(async (transaction) => {
    await transaction.style.upsert({
      where: { id: normalizedStyleId },
      update: {},
      create: {
        id: normalizedStyleId,
        name: normalizedStyleId,
        createdAt,
      },
    });
    const versionCount = await transaction.styleVersion.count({ where: { styleId: normalizedStyleId } });
    const version = await transaction.styleVersion.create({
      data: {
        ...versionData,
        version: versionCount + 1,
      },
    });
    await transaction.style.update({
      where: { id: normalizedStyleId },
      data: { latestVersionId: versionId },
    });
    return version;
  });

  return {
    id: createdVersion.id,
    styleId: createdVersion.styleId,
    createdAt: createdVersion.createdAt,
    document: storedDocument,
  };
}

export async function publishStyleVersion(styleId: string, versionId: string): Promise<StyleVersion> {
  const normalizedStyleId = normalizeRequiredIdentifier(styleId, "styleId");
  const normalizedVersionId = normalizeRequiredIdentifier(versionId, "versionId");
  const record = await getStyleRecord(normalizedStyleId);
  const version = await ensureVersionExists(normalizedStyleId, normalizedVersionId);
  assertValidStyleDocument(version.document);
  
  if (record.publishedVersionId === version.id) {
    throw buildError(StyleErrorCode.PUBLISH_CONFLICT, "Style version already published");
  }
  
  await prisma.style.update({
    where: { id: normalizedStyleId },
    data: { publishedVersionId: version.id },
  });
  
  return cloneStyleVersion(version);
}

export async function resolveStyleAssets(styleId: string, versionId?: string): Promise<StyleAssets> {
  const normalizedStyleId = normalizeRequiredIdentifier(styleId, "styleId");
  const normalizedVersionId = normalizeOptionalVersionIdentifier(versionId);
  await getStyle(normalizedStyleId, normalizedVersionId); // validate existence
  const record = await getStyleRecord(normalizedStyleId);
  const resolvedVersionId = normalizedVersionId ?? record.publishedVersionId ?? record.latestVersionId;
  if (!resolvedVersionId) {
    throw buildError(StyleErrorCode.VERSION_NOT_FOUND, "No style version");
  }
  return {
    styleId: normalizedStyleId,
    versionId: resolvedVersionId,
    spritePng: `/v1/styles/${normalizedStyleId}/sprites/sprite.png`,
    spriteJson: `/v1/styles/${normalizedStyleId}/sprites/sprite.json`,
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
  };
}
