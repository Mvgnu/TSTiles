import { randomUUID } from "node:crypto";
import type {
  StyleAssets,
  StyleDocument,
  StyleId,
  StyleTemplateConfig,
  StyleInput,
  StyleListItem,
  StyleVersion,
  StyleVersionId,
} from "./types";
import { StyleErrorCode, StyleError } from "./types";

interface InternalStyleRecord {
  name: string;
  versions: Map<StyleVersionId, StyleVersion>;
  latestVersionId: StyleVersionId | null;
  publishedVersionId: StyleVersionId | null;
  createdAt: string;
}

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
    return;
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

const styles = new Map<StyleId, InternalStyleRecord>();

function buildError(code: StyleErrorCode, message: string): StyleError {
  return new StyleError(code, message);
}

function normalizeStyleInput(input: unknown): StyleInput {
  if (!isRecord(input)) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "Invalid style document");
  }
  return input;
}

function cloneStyleDocument(document: StyleDocument): StyleDocument {
  try {
    const serialized = JSON.stringify(document);
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

function normalizeRequiredIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, `${field} must be non-empty`);
  }
  return normalized;
}

function normalizeOptionalVersionIdentifier(value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw buildError(StyleErrorCode.INVALID_DOCUMENT, "versionId must be non-empty");
  }
  return normalized;
}

export function buildDefaultStyleTemplate(config: StyleTemplateConfig): StyleDocument {
  const sourceName = config.sourceName?.trim() || "default";
  const tilesTemplate = config.tilesTemplate?.trim() || "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}";
  const spriteTemplate = config.spriteTemplate?.trim() || "/v1/styles/{styleId}/sprites/sprite";
  const glyphTemplate = config.glyphTemplate?.trim() || "/v1/fonts/{fontstack}/{range}.pbf";
  return {
    version: 8,
    sources: {
      [sourceName]: {
        type: "vector",
        tiles: [tilesTemplate],
      },
    },
    sprites: spriteTemplate,
    glyphs: glyphTemplate,
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

function getStyleRecord(styleId: string): InternalStyleRecord {
  const record = styles.get(styleId);
  if (!record) {
    throw buildError(StyleErrorCode.NOT_FOUND, "Style not found");
  }
  return record;
}

export function listStyles(): StyleListItem[] {
  return [...styles.entries()].map(([id, style]) => ({
    id,
    name: style.name,
    latestVersionId: style.latestVersionId,
    publishedVersionId: style.publishedVersionId ?? undefined,
  }));
}

function ensureVersionExists(record: InternalStyleRecord, versionId: string): StyleVersion {
  const version = record.versions.get(versionId);
  if (!version) {
    throw buildError(StyleErrorCode.VERSION_NOT_FOUND, "Style version not found");
  }
  return version;
}

export function getStyle(styleId: string, versionId?: string): StyleDocument {
  const normalizedStyleId = normalizeRequiredIdentifier(styleId, "styleId");
  const normalizedVersionId = normalizeOptionalVersionIdentifier(versionId);
  const record = getStyleRecord(normalizedStyleId);
  let targetVersion: string | null = record.latestVersionId;
  if (normalizedVersionId) {
    targetVersion = normalizedVersionId;
  } else if (record.publishedVersionId) {
    targetVersion = record.publishedVersionId;
  }
  if (!targetVersion) {
    throw buildError(StyleErrorCode.VERSION_NOT_FOUND, "No published style version");
  }
  const version = ensureVersionExists(record, targetVersion);
  return cloneStyleDocument(version.document);
}

export function createStyleVersion(styleId: string, input: unknown): StyleVersion {
  const normalizedStyleId = normalizeRequiredIdentifier(styleId, "styleId");
  const document = normalizeStyleInput(input);
  assertValidStyleDocument(document);
  const storedDocument = cloneStyleDocument(document);
  const existing = styles.get(normalizedStyleId);
  const createdAt = new Date().toISOString();
  const versionId = `${normalizedStyleId}-${randomUUID().slice(0, 8)}`;
  const version: StyleVersion = {
    id: versionId,
    styleId: normalizedStyleId,
    createdAt,
    document: storedDocument,
  };
  if (!existing) {
    styles.set(normalizedStyleId, {
      name: normalizedStyleId,
      versions: new Map([[versionId, version]]),
      latestVersionId: versionId,
      publishedVersionId: null,
      createdAt,
    });
    return cloneStyleVersion(version);
  }
  existing.versions.set(versionId, version);
  existing.latestVersionId = versionId;
  return cloneStyleVersion(version);
}

export function publishStyleVersion(styleId: string, versionId: string): StyleVersion {
  const normalizedStyleId = normalizeRequiredIdentifier(styleId, "styleId");
  const normalizedVersionId = normalizeRequiredIdentifier(versionId, "versionId");
  const record = getStyleRecord(normalizedStyleId);
  const version = ensureVersionExists(record, normalizedVersionId);
  // Re-validate at publish boundary to guard against storage/state corruption.
  assertValidStyleDocument(version.document);
  if (record.publishedVersionId === version.id) {
    throw buildError(StyleErrorCode.PUBLISH_CONFLICT, "Style version already published");
  }
  record.publishedVersionId = version.id;
  return cloneStyleVersion(version);
}

export function resolveStyleAssets(styleId: string, versionId?: string): StyleAssets {
  const normalizedStyleId = normalizeRequiredIdentifier(styleId, "styleId");
  const normalizedVersionId = normalizeOptionalVersionIdentifier(versionId);
  getStyle(normalizedStyleId, normalizedVersionId);
  const record = getStyleRecord(normalizedStyleId);
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
