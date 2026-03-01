import type { StyleInput, StyleListItem, StyleVersion } from "../styles/types";

export const enum StudioErrorCode {
  UNAUTHORIZED = "STUDIO_UNAUTHORIZED",
  BAD_REQUEST = "STUDIO_BAD_REQUEST",
  NOT_FOUND = "STUDIO_NOT_FOUND",
  CONFLICT = "STUDIO_CONFLICT",
  DEPENDENCY_FAILED = "STUDIO_DEPENDENCY_FAILED",
}

export class StudioError extends Error {
  public readonly code: StudioErrorCode;
  public readonly details: string;

  public constructor(code: StudioErrorCode, details: string) {
    super(`${code}:${details}`);
    this.code = code;
    this.details = details;
    this.name = "StudioError";
  }
}

export interface StyleAdminDraft {
  readonly styleId: string;
  readonly versionId: string;
  readonly document: StyleVersion["document"];
  readonly previewUrl: string;
}

export type StyleDraftRecord = StyleAdminDraft;

export interface StudioStyleListItem extends StyleListItem {
  readonly isDraft: boolean;
}

export type StudioStylePayload = StyleInput | StyleVersion["document"];
