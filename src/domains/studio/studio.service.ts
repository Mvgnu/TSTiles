import { createStyleVersion, getStyle, listStyles, publishStyleVersion } from "../styles/styles.service";
import { isAuthorized } from "../control-plane/auth/admin-auth";
import { StudioError, StudioErrorCode, type StyleAdminDraft, type StudioStyleListItem } from "./types";
import { StyleError, StyleErrorCode, type StyleInput } from "../styles/types";

function assertAdmin(token?: string): void {
  if (!isAuthorized(token)) {
    throw new StudioError(StudioErrorCode.UNAUTHORIZED, "admin token is required");
  }
}

function assertNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new StudioError(StudioErrorCode.BAD_REQUEST, `${field} is required`);
  }
  return normalized;
}

function mapStyleError(error: unknown): never {
  if (error instanceof StudioError) {
    throw error;
  }
  if (error instanceof StyleError) {
    const details = error.details;
    if (error.code === StyleErrorCode.NOT_FOUND || error.code === StyleErrorCode.VERSION_NOT_FOUND) {
      throw new StudioError(StudioErrorCode.NOT_FOUND, details);
    }
    if (error.code === StyleErrorCode.PUBLISH_CONFLICT) {
      throw new StudioError(StudioErrorCode.CONFLICT, details);
    }
    if (error.code === StyleErrorCode.BAD_REQUEST || error.code === StyleErrorCode.INVALID_DOCUMENT) {
      throw new StudioError(StudioErrorCode.BAD_REQUEST, details);
    }
    throw new StudioError(StudioErrorCode.DEPENDENCY_FAILED, details);
  }
  if (error instanceof Error) {
    throw new StudioError(StudioErrorCode.DEPENDENCY_FAILED, error.message);
  }
  throw new StudioError(StudioErrorCode.DEPENDENCY_FAILED, "studio operation failed");
}

function buildDraftStyle(styleId: string): StyleAdminDraft | undefined {
  try {
    const records = listStyles();
    const record = records.find((item) => item.id === styleId);
    const versionId = record?.latestVersionId;
    if (!versionId) {
      return undefined;
    }
    const document = getStyle(styleId, versionId);
    return {
      styleId,
      versionId,
      document,
      previewUrl: `/v1/styles/${styleId}/style.json`,
    };
  } catch (error) {
    if (
      error instanceof StyleError
      && (error.code === StyleErrorCode.NOT_FOUND || error.code === StyleErrorCode.VERSION_NOT_FOUND)
    ) {
      return undefined;
    }
    mapStyleError(error);
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
    throw new StudioError(StudioErrorCode.NOT_FOUND, "style not found");
  }
  return draft;
}

export function updateStyleDraft(styleId: string, input: StyleInput, token?: string): StyleAdminDraft {
  assertAdmin(token);
  const normalizedStyleId = assertNonEmpty(styleId, "styleId");
  try {
    const version = createStyleVersion(normalizedStyleId, input);
    return {
      styleId: normalizedStyleId,
      versionId: version.id,
      document: version.document,
      previewUrl: `/v1/styles/${normalizedStyleId}/style.json`,
    };
  } catch (error) {
    mapStyleError(error);
  }
}

export function publishStyle(styleId: string, versionId: string, token?: string): StyleAdminDraft {
  assertAdmin(token);
  const normalizedStyleId = assertNonEmpty(styleId, "styleId");
  const normalizedVersionId = assertNonEmpty(versionId, "versionId");
  try {
    const version = publishStyleVersion(normalizedStyleId, normalizedVersionId);
    return {
      styleId: normalizedStyleId,
      versionId: version.id,
      document: version.document,
      previewUrl: `/v1/styles/${normalizedStyleId}/style.json`,
    };
  } catch (error) {
    mapStyleError(error);
  }
}
