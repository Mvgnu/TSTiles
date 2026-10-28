export interface CodeSnippetRecord {
  readonly label: string;
  readonly language: string;
  readonly code: string;
}

export interface SystemTheme {
  readonly bg: string;
  readonly surface: string;
  readonly surface2: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly ink: string;
  readonly ink2: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentHover: string;
  readonly accentFg: string;
  readonly success: string;
  readonly warn: string;
  readonly danger: string;
  readonly codeBg: string;
  readonly codeInk: string;
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";
export type InputType = "text" | "email" | "password" | "number" | "search" | "url";
export type BannerTone = "info" | "success" | "warn" | "danger";
export type CardVariant = "flat" | "outlined";
