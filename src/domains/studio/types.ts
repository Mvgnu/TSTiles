import type { StyleInput, StyleListItem, StyleVersion } from "../styles/types";

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
