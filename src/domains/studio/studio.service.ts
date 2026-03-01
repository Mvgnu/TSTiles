import { createStyleVersion, getStyle, listStyles, publishStyleVersion } from "../styles/styles.service";
import { isAuthorized } from "../control-plane/auth/admin-auth";
import type { StyleAdminDraft, StudioStyleListItem } from "./types";
import type { StyleInput } from "../styles/types";

function styleErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const withCode = error as Error & { code?: unknown };
  if (typeof withCode.code === "string" && withCode.code.length > 0) {
    return withCode.code;
  }
  const [code] = error.message.split(":");
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

function assertAdmin(token?: string): void {
  if (!isAuthorized(token)) {
    throw new Error("STUDIO_UNAUTHORIZED");
  }
}

function assertNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`STUDIO_BAD_REQUEST:${field}`);
  }
  return normalized;
}

function buildDraftStyle(styleId: string): StyleAdminDraft | undefined {
  try {
    const document = getStyle(styleId);
    const records = listStyles();
    const record = records.find((item) => item.id === styleId);
    const versionId = record?.latestVersionId ?? "draft";
    return {
      styleId,
      versionId,
      document,
      previewUrl: `/v1/styles/${styleId}/style.json`,
    };
  } catch (error) {
    if (styleErrorCode(error) === "STYLE_NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
}

export function listStylesAdmin(token?: string): StudioStyleListItem[] {
  assertAdmin(token);
  return listStyles().map((style) => ({
    id: style.id,
    name: style.name,
    latestVersionId: style.latestVersionId,
    publishedVersionId: style.publishedVersionId,
    isDraft: style.latestVersionId !== style.publishedVersionId,
  }));
}

export function getStyleDraft(styleId: string, token?: string): StyleAdminDraft {
  assertAdmin(token);
  const normalizedStyleId = assertNonEmpty(styleId, "styleId");
  const draft = buildDraftStyle(normalizedStyleId);
  if (!draft) {
    throw new Error("STYLE_NOT_FOUND");
  }
  return draft;
}

export function updateStyleDraft(styleId: string, input: StyleInput, token?: string): StyleAdminDraft {
  assertAdmin(token);
  const normalizedStyleId = assertNonEmpty(styleId, "styleId");
  const version = createStyleVersion(normalizedStyleId, input);
  return {
    styleId: normalizedStyleId,
    versionId: version.id,
    document: version.document,
    previewUrl: `/v1/styles/${normalizedStyleId}/style.json`,
  };
}

export function publishStyle(styleId: string, versionId: string, token?: string): StyleAdminDraft {
  assertAdmin(token);
  const normalizedStyleId = assertNonEmpty(styleId, "styleId");
  const normalizedVersionId = assertNonEmpty(versionId, "versionId");
  const version = publishStyleVersion(normalizedStyleId, normalizedVersionId);
  return {
    styleId: normalizedStyleId,
    versionId: version.id,
    document: version.document,
    previewUrl: `/v1/styles/${normalizedStyleId}/style.json`,
  };
}
