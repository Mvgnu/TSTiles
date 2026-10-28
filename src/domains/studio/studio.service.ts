import { createStyleVersion, getStyle, listStyles, publishStyleVersion } from "../styles/styles.service";
import { isAuthorized } from "../control-plane/auth/admin-auth";
import { StudioError, StudioErrorCode, type StyleAdminDraft, type StudioStyleListItem } from "./types";
import { StyleError, StyleErrorCode, type StyleInput } from "../styles/types";

async function assertAdmin(token?: unknown): Promise<void> {
  if (!(await isAuthorized(token))) {
    throw new StudioError(StudioErrorCode.UNAUTHORIZED, "admin token is required");
  }
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new StudioError(StudioErrorCode.BAD_REQUEST, `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new StudioError(StudioErrorCode.BAD_REQUEST, `${field} is required`);
  }
  if (
    normalized.includes("/")
    || normalized.includes("\\")
    || normalized === "."
    || normalized === ".."
    || normalized.includes("..")
  ) {
    throw new StudioError(StudioErrorCode.BAD_REQUEST, `${field} contains unsupported path characters`);
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

function buildPreviewUrl(document: StyleAdminDraft["document"]): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(document))}`;
}

async function buildDraftStyle(styleId: string): Promise<StyleAdminDraft | undefined> {
  try {
    const records = await listStyles();
    const record = records.find((item) => item.id === styleId);
    const versionId = record?.latestVersionId;
    if (!versionId) {
      return undefined;
    }
    const document = await getStyle(styleId, versionId);
    return {
      styleId,
      versionId,
      document,
      previewUrl: buildPreviewUrl(document),
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

export async function listStylesAdmin(token?: string): Promise<StudioStyleListItem[]> {
  await assertAdmin(token);
  return (await listStyles()).map((style) => ({
    id: style.id,
    name: style.name,
    latestVersionId: style.latestVersionId,
    publishedVersionId: style.publishedVersionId,
    isDraft: style.latestVersionId !== style.publishedVersionId,
  }));
}

export async function getStyleDraft(styleId: string, token?: string): Promise<StyleAdminDraft> {
  await assertAdmin(token);
  const normalizedStyleId = assertNonEmpty(styleId, "styleId");
  const draft = await buildDraftStyle(normalizedStyleId);
  if (!draft) {
    throw new StudioError(StudioErrorCode.NOT_FOUND, "style not found");
  }
  return draft;
}

export async function updateStyleDraft(styleId: string, input: StyleInput, token?: string): Promise<StyleAdminDraft> {
  await assertAdmin(token);
  const normalizedStyleId = assertNonEmpty(styleId, "styleId");
  try {
    const version = await createStyleVersion(normalizedStyleId, input);
    return {
      styleId: normalizedStyleId,
      versionId: version.id,
      document: version.document,
      previewUrl: buildPreviewUrl(version.document),
    };
  } catch (error) {
    mapStyleError(error);
  }
}

export async function publishStyle(styleId: string, versionId: string, token?: string): Promise<StyleAdminDraft> {
  await assertAdmin(token);
  const normalizedStyleId = assertNonEmpty(styleId, "styleId");
  const normalizedVersionId = assertNonEmpty(versionId, "versionId");
  try {
    const version = await publishStyleVersion(normalizedStyleId, normalizedVersionId);
    return {
      styleId: normalizedStyleId,
      versionId: version.id,
      document: version.document,
      previewUrl: buildPreviewUrl(version.document),
    };
  } catch (error) {
    mapStyleError(error);
  }
}
