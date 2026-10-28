import type { SystemTheme } from "./types";

export const DefaultTheme: SystemTheme = {
  bg: "#FFFFFF",
  surface: "#FAFAFA",
  surface2: "#F4F4F5",
  border: "#E5E5E5",
  borderStrong: "#8A8F98",
  ink: "#111111",
  ink2: "#374151",
  muted: "#6B7280",
  accent: "#4F46E5",
  accentHover: "#4338CA",
  accentFg: "#FFFFFF",
  success: "#16A34A",
  warn: "#D97706",
  danger: "#DC2626",
  codeBg: "#F4F4F5",
  codeInk: "#111111",
};

export const DarkTheme: SystemTheme = {
  bg: "#0B0B0C",
  surface: "#141416",
  surface2: "#1A1A1D",
  border: "#303036",
  borderStrong: "#62626C",
  ink: "#F2F2F2",
  ink2: "#D4D4D8",
  muted: "#A1A1AA",
  accent: "#818CF8",
  accentHover: "#A5B4FC",
  accentFg: "#111827",
  success: "#22C55E",
  warn: "#F59E0B",
  danger: "#EF4444",
  codeBg: "#141416",
  codeInk: "#F2F2F2",
};

export function getDesignTokens(): SystemTheme {
  return DefaultTheme;
}

export function getGlobalCss(theme: SystemTheme = DefaultTheme): string {
  return `
    :root {
      color-scheme: light dark;
      --bg: ${theme.bg};
      --surface: ${theme.surface};
      --surface-2: ${theme.surface2};
      --border: ${theme.border};
      --border-strong: ${theme.borderStrong};
      --ink: ${theme.ink};
      --ink-2: ${theme.ink2};
      --muted: ${theme.muted};
      --accent: ${theme.accent};
      --accent-hover: ${theme.accentHover};
      --accent-fg: ${theme.accentFg};
      --success: ${theme.success};
      --warn: ${theme.warn};
      --danger: ${theme.danger};
      --code-bg: ${theme.codeBg};
      --code-ink: ${theme.codeInk};

      /* Compatibility aliases consumed by the existing surfaces. */
      --paper: var(--bg);
      --line: var(--border);
      --blue: var(--accent);
      --green: var(--success);
      --rust: var(--danger);

      --fs-xs: 0.75rem;
      --fs-sm: 0.875rem;
      --fs-base: 1rem;
      --fs-lg: 1.125rem;
      --fs-xl: 1.5rem;
      --fs-2xl: 2rem;
      --fs-3xl: 3rem;
      --sp-1: 0.25rem;
      --sp-2: 0.5rem;
      --sp-3: 0.75rem;
      --sp-4: 1rem;
      --sp-5: 1.5rem;
      --sp-6: 2rem;
      --sp-7: 3rem;
      --sp-8: 4rem;
      --rad-1: 4px;
      --rad-2: 8px;
      --rad-3: 12px;
      --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.08);
      --motion-fast: 120ms cubic-bezier(0.4, 0, 0.2, 1);
      --motion-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
      --container-max: 75rem;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: ${DarkTheme.bg};
        --surface: ${DarkTheme.surface};
        --surface-2: ${DarkTheme.surface2};
        --border: ${DarkTheme.border};
        --border-strong: ${DarkTheme.borderStrong};
        --ink: ${DarkTheme.ink};
        --ink-2: ${DarkTheme.ink2};
        --muted: ${DarkTheme.muted};
        --accent: ${DarkTheme.accent};
        --accent-hover: ${DarkTheme.accentHover};
        --accent-fg: ${DarkTheme.accentFg};
        --success: ${DarkTheme.success};
        --warn: ${DarkTheme.warn};
        --danger: ${DarkTheme.danger};
        --code-bg: ${DarkTheme.codeBg};
        --code-ink: ${DarkTheme.codeInk};
      }
    }

    @media (prefers-reduced-motion: reduce) {
      :root { --motion-fast: 0ms; --motion-base: 0ms; }
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 0ms !important;
      }
    }

    *, *::before, *::after { box-sizing: border-box; }
    html, body { min-width: 0; max-width: 100%; }
    :where(main, section, article, aside, header, footer, nav, div) { min-width: 0; }
    :where(img, video) { max-width: 100%; height: auto; }
    :where(svg, canvas) { max-width: 100%; }

    :where(a, button, input, textarea, select, [tabindex]):focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink-2);
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: var(--fs-base);
      line-height: 1.5;
      overflow-wrap: break-word;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-block: 0 var(--sp-2);
      color: var(--ink);
      font-weight: 600;
      line-height: 1.2;
      text-wrap: balance;
    }
    h1 { font-size: clamp(2rem, 5vw, 3rem); letter-spacing: -0.025em; }
    h2 { font-size: clamp(1.5rem, 3vw, 2rem); letter-spacing: -0.015em; }
    h3 { font-size: var(--fs-lg); }
    h4 { font-size: var(--fs-base); }
    p { margin-block: 0 var(--sp-4); color: var(--ink-2); }
    a { color: var(--accent); text-underline-offset: 0.18em; }
    a:hover { color: var(--accent-hover); }
    button, input, select, textarea {
      max-width: 100%;
      font: inherit;
      font-size: max(0.875rem, 14px) !important;
    }
    code, pre {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace;
      font-size: var(--fs-sm);
    }
    pre {
      max-width: 100%;
      margin: 0;
      overflow-x: auto;
      overscroll-behavior-inline: contain;
    }
    pre code { display: block; min-width: max-content; }
    :not(pre) > code { overflow-wrap: anywhere; }

    .fs-xs { font-size: var(--fs-xs); }
    .fs-sm { font-size: var(--fs-sm); }
    .fs-base { font-size: var(--fs-base); }
    .fs-lg { font-size: var(--fs-lg); }
    .fs-xl { font-size: var(--fs-xl); }
    .fs-2xl { font-size: var(--fs-2xl); }
    .fs-3xl { font-size: var(--fs-3xl); }
    .w-full { width: 100%; }
    .container {
      width: min(100%, var(--container-max));
      margin-inline: auto;
      padding-inline: clamp(var(--sp-4), 4vw, var(--sp-5));
    }

    .ds-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--sp-2);
      min-height: 2.5rem;
      max-width: 100%;
      padding: 0.625rem 1rem;
      border: 1px solid transparent;
      border-radius: var(--rad-2);
      background: transparent;
      color: var(--ink);
      cursor: pointer;
      font-family: inherit;
      font-size: var(--fs-sm);
      font-weight: 600;
      line-height: 1.25;
      text-align: center;
      text-decoration: none;
      white-space: normal;
      transition: background-color var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast);
    }
    .ds-button-sm { min-height: 2rem; padding: 0.4rem 0.75rem; }
    .ds-button-md { min-height: 2.5rem; }
    .ds-button:disabled { opacity: 0.55; cursor: not-allowed; }
    .ds-button-primary { background: var(--accent); color: var(--accent-fg); }
    .ds-button-primary:hover:not(:disabled) { background: var(--accent-hover); color: var(--accent-fg); }
    .ds-button-secondary { border-color: var(--border-strong); background: var(--bg); color: var(--ink); }
    .ds-button-secondary:hover:not(:disabled) { background: var(--surface-2); color: var(--ink); }
    .ds-button-ghost { color: var(--ink-2); }
    .ds-button-ghost:hover:not(:disabled) { background: var(--surface-2); color: var(--ink); }
    .ds-button-danger { background: var(--danger); color: #FFFFFF; }
    .ds-button-danger:hover:not(:disabled) { filter: brightness(0.9); color: #FFFFFF; }

    .ds-form-field { display: grid; gap: var(--sp-1); margin-block-end: var(--sp-4); min-width: 0; }
    .ds-label { color: var(--ink); font-size: var(--fs-sm); font-weight: 550; }
    .ds-input, .ds-textarea, .ds-select {
      width: 100%;
      min-height: 2.75rem;
      padding: 0.625rem 0.75rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--rad-1);
      background: var(--bg);
      color: var(--ink);
      transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
    }
    .ds-input-error, .ds-textarea-error, .ds-select-error { border-color: var(--danger); }
    .ds-hint, .ds-error-text { font-size: var(--fs-sm); }
    .ds-hint { color: var(--muted); }
    .ds-error-text { color: var(--danger); }

    .ds-card {
      min-width: 0;
      max-width: 100%;
      padding: clamp(var(--sp-4), 3vw, var(--sp-5));
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--surface);
      box-shadow: var(--shadow-1);
    }
    .ds-card-outlined { border-color: var(--border-strong); background: var(--bg); box-shadow: none; }
    .ds-card-header { margin-block-end: var(--sp-4); padding-block-end: var(--sp-3); border-bottom: 1px solid var(--border); }
    .ds-card-footer { margin-block-start: var(--sp-4); padding-block-start: var(--sp-3); border-top: 1px solid var(--border); }

    .ds-banner {
      display: flex;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: var(--sp-3);
      margin-block-end: var(--sp-4);
      padding: var(--sp-3) var(--sp-4);
      border: 1px solid var(--border-strong);
      border-inline-start-width: 3px;
      border-radius: var(--rad-2);
      background: var(--surface);
      color: var(--ink-2);
      font-size: var(--fs-sm);
    }
    .ds-banner-content { flex: 1 1 16rem; }
    .ds-banner-info { border-inline-start-color: var(--accent); }
    .ds-banner-success { border-inline-start-color: var(--success); }
    .ds-banner-warn { border-inline-start-color: var(--warn); }
    .ds-banner-danger { border-inline-start-color: var(--danger); }
    .ds-banner-close { margin-inline-start: auto; }

    .ds-code-card {
      min-width: 0;
      max-width: 100%;
      margin-block-end: var(--sp-4);
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--code-bg);
      color: var(--code-ink);
    }
    .ds-code-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--sp-2) var(--sp-3);
      padding: var(--sp-2) var(--sp-3);
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      color: var(--muted);
      font-family: "JetBrains Mono", monospace;
      font-size: var(--fs-sm);
    }
    .ds-code-meta > :last-child { margin-inline-start: auto; }
    .ds-code-card pre { padding: var(--sp-4); }

    .ds-table {
      display: block;
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      border-collapse: collapse;
      color: var(--ink-2);
      font-size: var(--fs-sm);
      text-align: left;
    }
    .ds-table thead, .ds-table tbody { display: table; width: 100%; min-width: 36rem; table-layout: auto; }
    .ds-table th, .ds-table td { padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); }
    .ds-table th { background: var(--surface); color: var(--ink); font-weight: 600; }
    .ds-table tr:last-child td { border-bottom: 0; }
    .ds-tabs { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
    .ds-stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: var(--sp-4); }

    @media (max-width: 40rem) {
      .ds-button { width: 100%; }
      .ds-code-meta > :last-child { margin-inline-start: 0; }
    }
  `;
}
