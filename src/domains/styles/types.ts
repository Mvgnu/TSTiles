export type StyleId = string;
export type StyleVersionId = string;

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
