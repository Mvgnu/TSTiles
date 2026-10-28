import type { DocsGuideCodeExample, DocsGuidePage } from "../types";
import { escapeHtml, getUniversalHeaderCss, renderUniversalHeader } from "../../design-system/components";
import { getGlobalCss } from "../../design-system/styles";

function stripQueryToken(url: string): string {
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const [pathname, query = ""] = beforeHash.split("?");
  if (query.length === 0) {
    return url;
  }
  const filteredParams = query
    .split("&")
    .filter((entry) => entry.length > 0 && !entry.startsWith("access_token="));
  const nextQuery = filteredParams.length > 0 ? `?${filteredParams.join("&")}` : "";
  return `${pathname}${nextQuery}${hash}`;
}

function extractStyleUrlFromMapLibre(code: string): string | null {
  const match = /style:\s*"([^"]+)"/.exec(code);
  return match?.[1] ?? null;
}

function buildHeaderVariant(example: DocsGuideCodeExample): string | undefined {
  const code = example.code;
  if (!code.includes("access_token")) {
    return undefined;
  }
  if (code.includes("new maplibregl.Map({")) {
    const styleUrl = extractStyleUrlFromMapLibre(code);
    if (!styleUrl) {
      return undefined;
    }
    const headerStyleUrl = stripQueryToken(styleUrl);
    return [
      'const token = "YOUR_TOKEN";',
      "",
      "new maplibregl.Map({",
      '  container: "map",',
      `  style: "${headerStyleUrl}",`,
      "  transformRequest: (url) => ({",
      "    url,",
      '    headers: { Authorization: `Bearer ${token}` },',
      "  }),",
      "});",
    ].join("\n");
  }
  if (code.startsWith("curl ")) {
    const stripped = stripQueryToken(code);
    if (stripped === code) {
      return undefined;
    }
    return stripped.replace("curl ", 'curl -H "Authorization: Bearer YOUR_TOKEN" ');
  }
  if (code.startsWith("/v1/") || code.startsWith("http")) {
    return `curl -H "Authorization: Bearer YOUR_TOKEN" "${stripQueryToken(code)}"`;
  }
  return undefined;
}

function renderCodeExample(example: DocsGuideCodeExample): string {
  const headerVariant = buildHeaderVariant(example);
  return `
    <div
      class="ds-code-card"
      data-docs-code-card
      data-query-code="${escapeHtml(example.code)}"
      ${headerVariant ? `data-header-code="${escapeHtml(headerVariant)}"` : ""}
      data-preferred-mode="${headerVariant ? "query" : "single"}"
    >
      <div class="ds-code-meta">
        <span>${escapeHtml(example.label)}</span>
        <div class="code-actions">
          ${headerVariant ? `
            <div class="mode-toggle" role="tablist" aria-label="${escapeHtml(example.label)} auth mode">
              <button class="mode-button" type="button" data-docs-mode="query">Query token</button>
              <button class="mode-button" type="button" data-docs-mode="header">Header token</button>
            </div>
          ` : ""}
          <span>${escapeHtml(example.language)}</span>
          <button class="ds-button ds-button-secondary" type="button" data-docs-copy>Copy snippet</button>
        </div>
      </div>
      <pre><code data-docs-code>${escapeHtml(example.code)}</code></pre>
    </div>
  `;
}

function renderCodeExamples(section: DocsGuidePage["sections"][number]): string {
  if (!section.codeExamples || section.codeExamples.length === 0) {
    return "";
  }
  return section.codeExamples.map((example) => renderCodeExample(example)).join("");
}

function renderDocsRuntimeScript(): string {
  return `
    <script>
      (function () {
        async function parseJson(response) {
          const text = await response.text();
          if (!text) {
            return {};
          }
          try {
            return JSON.parse(text);
          } catch (_error) {
            return {};
          }
        }

        async function copyText(value) {
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(value);
              return true;
            }
          } catch (_error) {
            // Fall through to the legacy copy path below.
          }
          const input = document.createElement("textarea");
          input.value = value;
          document.body.appendChild(input);
          input.select();
          const copied = document.execCommand("copy");
          document.body.removeChild(input);
          return copied;
        }

        function bindCodeCards() {
          Array.prototype.forEach.call(document.querySelectorAll("[data-docs-code-card]"), function (card) {
            const queryCode = card.getAttribute("data-query-code") || "";
            const headerCode = card.getAttribute("data-header-code");
            const codeNode = card.querySelector("[data-docs-code]");
            const buttons = card.querySelectorAll("[data-docs-mode]");
            const copyButton = card.querySelector("[data-docs-copy]");

            function setMode(mode) {
              if (!codeNode) {
                return;
              }
              codeNode.textContent = mode === "header" && headerCode ? headerCode : queryCode;
              Array.prototype.forEach.call(buttons, function (button) {
                button.classList.toggle("active", button.getAttribute("data-docs-mode") === mode);
              });
            }

            Array.prototype.forEach.call(buttons, function (button) {
              button.addEventListener("click", function () {
                const mode = button.getAttribute("data-docs-mode") === "header" ? "header" : "query";
                setMode(mode);
              });
            });

            if (copyButton) {
              copyButton.addEventListener("click", async function () {
                const value = codeNode ? codeNode.textContent || "" : "";
                const previous = copyButton.textContent;
                const copied = await copyText(value);
                copyButton.textContent = copied ? "Copied" : "Copy failed";
                window.setTimeout(function () {
                  copyButton.textContent = previous || "Copy snippet";
                }, 1200);
              });
            }

            setMode(headerCode ? "query" : "single");
          });
        }

        async function bindActionLinks() {
          let session = null;
          try {
            const response = await fetch("/app-api/session", {
              method: "GET",
              credentials: "same-origin"
            });
            session = response.ok ? await parseJson(response) : null;
          } catch (_error) {
            session = null;
          }
          Array.prototype.forEach.call(document.querySelectorAll("[data-docs-action]"), function (anchor) {
            const action = anchor.getAttribute("data-docs-action");
            if (!session) {
              if (action === "create-project" || action === "get-api-key") {
                anchor.setAttribute("href", "/sign-up?next=%2Fapp%2Fprojects%2Fnew");
              }
              if (action === "open-dashboard") {
                anchor.setAttribute("href", "/sign-in?next=%2Fapp");
              }
              return;
            }
            if (action === "create-project") {
              anchor.setAttribute("href", "/app/projects/new");
            } else if (action === "open-dashboard") {
              anchor.setAttribute("href", "/app");
            } else if (action === "get-api-key") {
              anchor.setAttribute("href", "/app/projects/new");
              anchor.textContent = "Issue API key";
            }
          });
        }

        bindCodeCards();
        void bindActionLinks();
      })();
    </script>
  `;
}

export function renderDocsGuideHtml(page: DocsGuidePage): string {
  const nav = page.nav.map((item) => `
    <a class="nav-item${item.slug === page.slug ? " active" : ""}" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>
  `).join("");
  const sections = page.sections.map((section) => `
    <section class="ds-card section" id="${escapeHtml(section.id)}">
      <h2>${escapeHtml(section.title)}</h2>
      <p>${escapeHtml(section.body)}</p>
      ${section.callout ? `<div class="callout">${escapeHtml(section.callout)}</div>` : ""}
      ${renderCodeExamples(section)}
    </section>
  `).join("");
  const ctas = page.ctas.map((cta) => `
    <a class="ds-button docs-hero-button" href="${escapeHtml(cta.href)}"${cta.action ? ` data-docs-action="${escapeHtml(cta.action)}"` : ""}>${escapeHtml(cta.label)}</a>
  `).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)} | Tileserver Docs</title>
  <style>
    ${getGlobalCss()}
    ${getUniversalHeaderCss()}
    :root {
      --panel: var(--surface);
      --accent: var(--accent);
      --accent-soft: rgba(79, 70, 229, 0.08);
      --terrain: var(--success);
      --danger: var(--danger);
      --shadow: 0 12px 30px rgba(0, 0, 0, 0.04);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --panel: var(--surface-2);
        --shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
      }
    }
    .shell {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      min-height: 100vh;
    }
    .sidebar {
      border-right: 1px solid var(--line);
      padding: 28px 20px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.52), rgba(255,255,255,0.18)),
        repeating-linear-gradient(0deg, transparent, transparent 27px, rgba(31,43,51,0.03) 28px);
      position: sticky;
      top: 73px;
      height: calc(100vh - 73px);
      overflow: auto;
      display: grid;
      align-content: start;
      gap: 18px;
    }
    .eyebrow {
      font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--terrain);
      margin-bottom: 10px;
    }
    .sidebar h1 {
      margin: 0 0 8px;
      font-size: 24px;
      line-height: 1.1;
    }
    .sidebar p {
      margin: 0;
      color: var(--muted);
      line-height: 1.5;
    }
    .nav {
      display: grid;
      gap: 8px;
    }
    .nav-item {
      text-decoration: none;
      color: var(--ink-2);
      padding: 8px 12px;
      border-radius: var(--rad-1);
      font-size: 14px;
      font-weight: 500;
      transition: all var(--motion-fast);
      display: block;
    }
    .nav-item:hover {
      background: var(--surface-2);
      color: var(--ink);
    }
    .nav-item.active {
      background: rgba(79, 70, 229, 0.08);
      color: var(--accent);
    }
    .action-panel {
      border-radius: 16px;
      border: 1px solid rgba(31,95,139,0.18);
      background: rgba(31,95,139,0.08);
      padding: 16px;
      display: grid;
      gap: 10px;
    }
    .action-grid {
      display: grid;
      gap: 10px;
    }
    /* Legacy action-link styles refactored in favor of ds-button secondary */
    main {
      padding: 36px;
      display: grid;
      gap: 18px;
    }
    .hero {
      background:
        linear-gradient(135deg, rgba(31,95,139,0.12), rgba(79,116,93,0.1)),
        var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 20px 40px var(--shadow);
    }
    .hero h2 {
      margin: 0 0 10px;
      font-size: 34px;
      line-height: 1;
    }
    .hero p {
      max-width: 760px;
      margin: 0;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.6;
    }
    .cta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 20px;
    }
    .docs-hero-button {
      background: rgba(255,255,255,0.82);
      border: 1px solid rgba(28,39,48,0.16);
      color: #111111;
      font-weight: 750;
      box-shadow: 0 10px 20px rgba(20,32,41,0.08);
    }
    .docs-hero-button:hover {
      background: #111111;
      border-color: #111111;
      color: #ffffff;
    }
    .docs-hero-button:focus-visible {
      color: #111111;
    }
    .cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 14px;
      border-radius: var(--rad-2);
      text-decoration: none;
      font-weight: 700;
      background: var(--accent);
      color: var(--accent-fg);
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 16px 34px var(--shadow);
    }
    .section {
      padding: 22px;
    }
    .section h2 {
      margin: 0 0 8px;
      font-size: 24px;
    }
    .section p {
      margin: 0;
      color: var(--muted);
      line-height: 1.7;
      white-space: pre-line;
    }
    .callout {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 12px;
      background: rgba(159,95,67,0.08);
      border: 1px solid rgba(159,95,67,0.18);
      color: var(--danger);
      font-weight: 600;
    }
    .code-card {
      margin-top: 16px;
      overflow: hidden;
      border-radius: var(--rad-2);
      border: 1px solid var(--border);
      background: var(--code-bg);
      color: var(--code-ink);
    }
    .code-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      font-family: "JetBrains Mono", "SFMono-Regular", monospace;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .code-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }
    .mode-toggle {
      display: inline-flex;
      gap: 8px;
    }
    .mode-button,
    .copy-button {
      border: 1px solid var(--border-strong);
      border-radius: var(--rad-2);
      padding: 6px 10px;
      background: var(--surface-2);
      color: var(--ink-2);
      cursor: pointer;
      font: inherit;
      transition: all var(--motion-fast);
    }
    .mode-button.active {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: var(--accent);
    }
    pre {
      margin: 0;
      padding: 16px;
      overflow: auto;
      font-family: "JetBrains Mono", "SFMono-Regular", monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    .docs-footer {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      color: var(--muted);
      padding: 0 0 20px;
    }
    .docs-footer a {
      color: inherit;
    }
    @media (max-width: 920px) {
      .shell {
        grid-template-columns: 1fr;
      }
      .sidebar {
        position: static;
        height: auto;
        overflow: visible;
        border-right: none;
        border-bottom: 1px solid var(--line);
      }
      main {
        padding: 20px;
      }
      .hero h2 {
        font-size: 28px;
      }
    }
  </style>
</head>
<body>
  ${renderUniversalHeader("docs")}
  <div class="shell">
    <aside class="sidebar">
      <div>
        <div class="eyebrow">Docs Experience</div>
        <h1>Tileserver Docs</h1>
        <p>Public integration guides for styles, tiles, raster, and static maps.</p>
      </div>
      <div class="action-panel">
        <div class="eyebrow">App Actions</div>
        <p>Move directly from docs into project creation, dashboard navigation, or key issuance flows.</p>
        <div class="action-grid" style="display: grid; gap: 8px;">
          <a class="ds-button ds-button-secondary" style="width: 100%; justify-content: center;" data-docs-action="create-project" href="/sign-up?next=%2Fapp%2Fprojects%2Fnew">Create project</a>
          <a class="ds-button ds-button-secondary" style="width: 100%; justify-content: center;" data-docs-action="open-dashboard" href="/sign-in?next=%2Fapp">Open dashboard</a>
          <a class="ds-button ds-button-secondary" style="width: 100%; justify-content: center;" data-docs-action="get-api-key" href="/sign-up?next=%2Fapp%2Fprojects%2Fnew">Get API key</a>
        </div>
      </div>
      <nav class="nav">${nav}</nav>
    </aside>
    <main>
      <section class="hero">
        <div class="eyebrow">Guide</div>
        <h2>${escapeHtml(page.title)}</h2>
        <p>${escapeHtml(page.summary)}</p>
        <div class="cta-row">${ctas}</div>
      </section>
      ${sections}
      <footer class="docs-footer">
        <a href="/legal/terms">Terms</a>
        <a href="/legal/privacy">Privacy</a>
        <a href="/legal/dpa">DPA</a>
        <a href="/legal/acceptable-use">Acceptable Use</a>
        <a href="/security">Security</a>
        <a href="/status">Status</a>
        <a href="mailto:security@tstiles.com?subject=Security%20report">Security contact</a>
      </footer>
    </main>
  </div>
  ${renderDocsRuntimeScript()}
</body>
</html>`;
}
