export type StyleId = string;
export type StyleVersionId = string;

export const enum StyleErrorCode {
  NOT_FOUND = "STYLE_NOT_FOUND",
  VERSION_NOT_FOUND = "STYLE_VERSION_NOT_FOUND",
  INVALID_DOCUMENT = "STYLE_INVALID_DOCUMENT",
  PUBLISH_CONFLICT = "STYLE_PUBLISH_CONFLICT",
  BAD_REQUEST = "STYLE_BAD_REQUEST",
}

export class StyleError extends Error {
  public readonly code: StyleErrorCode;
  public readonly details: string;

  public constructor(code: StyleErrorCode, details: string) {
    super(`${code}:${details}`);
    this.code = code;
    this.details = details;
    this.name = "StyleError";
  }
}

export interface StyleDocument {
  readonly version: 8 | number;
  readonly sources: Record<string, unknown>;
  readonly layers?: unknown[];
  readonly glyphs?: string;
  readonly sprites?: string;
  [key: string]: unknown;
}

export interface StyleVersion {
  readonly id: StyleVersionId;
  readonly styleId: StyleId;
  readonly createdAt: string;
  readonly document: StyleDocument;
}

export interface StyleRecord {
  readonly id: StyleId;
  readonly name: string;
  readonly latestVersionId: StyleVersionId | null;
  readonly publishedVersionId: StyleVersionId | null;
  readonly createdAt: string;
}

export interface StyleTemplateConfig {
  readonly styleId: StyleId;
  readonly sourceName?: string;
  readonly tilesTemplate?: string;
  readonly spriteTemplate?: string;
  readonly glyphTemplate?: string;
}

export interface StyleAssets {
  readonly styleId: StyleId;
  readonly versionId: StyleVersionId;
  readonly spritePng: string;
  readonly spriteJson: string;
  readonly glyphs: string;
}

export interface StyleValidation {
  readonly valid: boolean;
  readonly reason?: string;
}

export interface StyleListItem {
  readonly id: StyleId;
  readonly name: string;
  readonly latestVersionId: StyleVersionId | null;
  readonly publishedVersionId?: StyleVersionId;
}

export type StyleInput = Record<string, unknown>;
