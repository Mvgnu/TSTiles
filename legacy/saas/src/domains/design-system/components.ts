import type {
  BannerTone,
  ButtonSize,
  ButtonVariant,
  CardVariant,
  CodeSnippetRecord,
  InputType,
} from "./types";

/** Escape untrusted text before placing it in an HTML string. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stableFieldId(name: string): string {
  let hash = 2166136261;
  for (const character of name) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  const readableName = name.trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "field";
  return `ds-input-${readableName}-${(hash >>> 0).toString(36)}`;
}

export type UniversalHeaderActiveItem = "product" | "pricing" | "docs" | "sign-in" | "sign-up";

/** Shared public navigation. Operational shells intentionally use their own navigation. */
export function getUniversalHeaderCss(): string {
  return `
    .ds-skip-link {
      position: fixed;
      inset-block-start: var(--sp-2);
      inset-inline-start: var(--sp-2);
      z-index: 1000;
      translate: 0 -160%;
      border: 2px solid var(--accent);
      border-radius: var(--rad-1);
      background: var(--bg);
      color: var(--ink);
      padding: var(--sp-2) var(--sp-3);
      font-weight: 600;
      transition: translate var(--motion-fast);
    }
    .ds-skip-link:focus { translate: 0; }
    .universal-header {
      position: sticky;
      inset-block-start: 0;
      z-index: 20;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
    }
    .universal-nav {
      width: min(100%, var(--container-max));
      min-width: 0;
      min-height: 60px;
      margin-inline: auto;
      padding: var(--sp-3) clamp(var(--sp-4), 4vw, var(--sp-5));
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--sp-2) var(--sp-5);
    }
    .universal-brand {
      color: var(--ink);
      flex: 0 0 auto;
      font-weight: 650;
      letter-spacing: -0.015em;
      text-decoration: none;
    }
    .universal-brand::before {
      content: "";
      display: inline-block;
      width: 0.55em;
      height: 0.55em;
      margin-inline-end: var(--sp-2);
      border: 2px solid var(--accent);
      border-radius: 50% 50% 50% 0;
      rotate: -45deg;
    }
    .universal-nav-links {
      display: flex;
      flex: 0 1 auto;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      min-width: 0;
      gap: var(--sp-1);
    }
    .universal-nav-links a {
      border-radius: var(--rad-1);
      color: var(--ink-2);
      font-size: 0.875rem;
      font-weight: 550;
      padding: var(--sp-2) var(--sp-3);
      text-decoration: none;
      transition: background-color var(--motion-fast), color var(--motion-fast);
    }
    .universal-nav-links a:hover { background: var(--surface-2); color: var(--ink); }
    .universal-nav-links a[data-active="true"] {
      background: var(--surface-2);
      color: var(--accent);
      box-shadow: inset 0 -2px 0 var(--accent);
    }
    @media (max-width: 42rem) {
      .universal-nav { align-items: flex-start; }
      .universal-nav-links { justify-content: flex-start; width: 100%; }
    }
  `;
}

export function renderUniversalHeader(activeItem?: UniversalHeaderActiveItem): string {
  const links: ReadonlyArray<{ readonly id: UniversalHeaderActiveItem; readonly label: string; readonly href: string }> = [
    { id: "product", label: "Product", href: "/" },
    { id: "pricing", label: "Pricing", href: "/pricing" },
    { id: "docs", label: "Docs", href: "/docs" },
    { id: "sign-in", label: "Sign in", href: "/sign-in" },
    { id: "sign-up", label: "Start free", href: "/sign-up" },
  ];
  return `
    <a class="ds-skip-link" href="#main-content">Skip to main content</a>
    <header class="universal-header">
      <div class="universal-nav">
        <a class="universal-brand" href="/">Tileserver</a>
        <nav class="universal-nav-links" aria-label="Primary">
          ${links.map((link) => `<a href="${escapeHtml(link.href)}"${activeItem === link.id ? ' data-active="true" aria-current="page"' : ""}>${escapeHtml(link.label)}</a>`).join("")}
        </nav>
      </div>
    </header>
  `;
}

export function renderButton(
  label: string,
  variant: ButtonVariant = "primary",
  options: {
    readonly size?: ButtonSize;
    readonly disabled?: boolean;
    readonly loading?: boolean;
    readonly type?: "button" | "submit" | "reset";
    readonly id?: string;
    readonly className?: string;
    readonly ariaLabel?: string;
  } = {},
): string {
  const disabled = options.disabled === true || options.loading === true;
  const idAttribute = options.id ? ` id="${escapeHtml(options.id)}"` : "";
  const ariaLabel = options.ariaLabel ? ` aria-label="${escapeHtml(options.ariaLabel)}"` : "";
  const busy = options.loading ? ' aria-busy="true"' : "";
  const extraClass = options.className ? ` ${escapeHtml(options.className)}` : "";
  return `
    <button${idAttribute} type="${options.type ?? "button"}"${disabled ? " disabled" : ""}${ariaLabel}${busy} class="ds-button ds-button-${variant} ds-button-${options.size ?? "md"}${extraClass}">
      <span>${escapeHtml(options.loading ? "Loading…" : label)}</span>
    </button>
  `;
}

export function renderInput(
  label: string,
  name: string,
  options: {
    readonly type?: InputType;
    readonly value?: string;
    readonly placeholder?: string;
    readonly hint?: string;
    readonly error?: string;
    readonly required?: boolean;
    readonly id?: string;
    readonly disabled?: boolean;
  } = {},
): string {
  const id = options.id ?? stableFieldId(name);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const descriptions = [options.hint ? hintId : "", options.error ? errorId : ""].filter(Boolean);
  const describedBy = descriptions.length > 0 ? ` aria-describedby="${descriptions.map(escapeHtml).join(" ")}"` : "";
  return `
    <div class="ds-form-field">
      <label for="${escapeHtml(id)}" class="ds-label">${escapeHtml(label)}${options.required ? '<span aria-hidden="true"> *</span>' : ""}</label>
      <input type="${options.type ?? "text"}" id="${escapeHtml(id)}" name="${escapeHtml(name)}"${options.value !== undefined ? ` value="${escapeHtml(options.value)}"` : ""}${options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : ""}${options.required ? " required" : ""}${options.disabled ? " disabled" : ""}${options.error ? ' aria-invalid="true"' : ""}${describedBy} class="ds-input${options.error ? " ds-input-error" : ""}">
      ${options.hint ? `<span id="${escapeHtml(hintId)}" class="ds-hint">${escapeHtml(options.hint)}</span>` : ""}
      ${options.error ? `<span id="${escapeHtml(errorId)}" class="ds-error-text" role="alert">${escapeHtml(options.error)}</span>` : ""}
    </div>
  `;
}

/** Header, body, and footer slots are trusted HTML authored by server templates. */
export function renderCard(
  bodyHtml: string,
  variant: CardVariant = "flat",
  options: { readonly headerHtml?: string; readonly footerHtml?: string; readonly id?: string; readonly className?: string } = {},
): string {
  const idAttribute = options.id ? ` id="${escapeHtml(options.id)}"` : "";
  const classes = ["ds-card", variant === "outlined" ? "ds-card-outlined" : "", options.className ?? ""].filter(Boolean).join(" ");
  return `
    <div${idAttribute} class="${escapeHtml(classes)}">
      ${options.headerHtml ? `<div class="ds-card-header">${options.headerHtml}</div>` : ""}
      <div class="ds-card-body">${bodyHtml}</div>
      ${options.footerHtml ? `<div class="ds-card-footer">${options.footerHtml}</div>` : ""}
    </div>
  `;
}

export function renderBanner(
  message: string,
  tone: BannerTone = "info",
  options: { readonly actionHtml?: string; readonly dismissable?: boolean; readonly id?: string } = {},
): string {
  const idAttribute = options.id ? ` id="${escapeHtml(options.id)}"` : "";
  const dismissButton = options.dismissable
    ? '<button class="ds-banner-close" type="button" aria-label="Dismiss message" onclick="this.parentElement.remove()">Close</button>'
    : "";
  return `
    <div${idAttribute} class="ds-banner ds-banner-${tone}" role="${tone === "danger" ? "alert" : "status"}" aria-live="${tone === "danger" ? "assertive" : "polite"}">
      <div class="ds-banner-content">${escapeHtml(message)}</div>
      ${options.actionHtml ? `<div class="ds-banner-action">${options.actionHtml}</div>` : ""}
      ${dismissButton}
    </div>
  `;
}

export function renderCodeCard(snippet: CodeSnippetRecord): string {
  return `
    <div class="ds-code-card">
      <div class="ds-code-meta">
        <span>${escapeHtml(snippet.label)}</span>
        <span>${escapeHtml(snippet.language)}</span>
        <button class="ds-button ds-button-secondary ds-button-sm" type="button" aria-label="Copy ${escapeHtml(snippet.label)}" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.textContent || '')">Copy</button>
      </div>
      <pre><code>${escapeHtml(snippet.code)}</code></pre>
    </div>
  `;
}
