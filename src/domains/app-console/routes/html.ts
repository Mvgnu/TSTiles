import type {
  AppConsoleBanner,
  AppConsolePage,
  AppConsoleSnippet,
  AppConsoleStat,
} from "../types";
import { escapeHtml } from "../../design-system/components";
import { renderAppConsoleClientScript } from "./app-console-client";
import { getAppConsoleCss } from "./app-console-css";
import { renderSettingsPageContent } from "./settings-html";

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "Pending webhook confirmation";
  }
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatStatus(value: string): string {
  return value.replace(/_/g, " ");
}

function formatStateLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function snippetCard(snippet: AppConsoleSnippet): string {
  return `
    <article class="ds-card snippet-card" data-snippet-card data-query-code="${escapeHtml(snippet.queryCode)}" data-header-code="${escapeHtml(snippet.headerCode)}" data-preferred-mode="${escapeHtml(snippet.preferredMode)}">
      <div class="card-head split">
        <div>
          <h3>${escapeHtml(snippet.title)}</h3>
          <p>${escapeHtml(snippet.description)}</p>
        </div>
        <div class="mode-toggle" role="tablist" aria-label="${escapeHtml(snippet.title)} auth mode">
          <button class="mode-button" type="button" data-snippet-mode="query">Query token</button>
          <button class="mode-button" type="button" data-snippet-mode="header">Header token</button>
        </div>
      </div>
      <pre class="code-block" data-snippet-code>${escapeHtml(snippet.queryCode)}</pre>
      <div class="card-actions">
        <button class="ds-button ds-button-secondary" type="button" data-copy-snippet>Copy snippet</button>
      </div>
    </article>
  `;
}

function renderSnippets(snippets: ReadonlyArray<AppConsoleSnippet>): string {
  if (snippets.length === 0) {
    return `
      <article class="ds-card empty-state">
        <h3>Integration snippets unavailable</h3>
        <p>Publish a style before copying style, raster, or static map integration URLs.</p>
        <a class="ds-button ds-button-secondary" href="/docs/styles">Open style documentation</a>
      </article>
    `;
  }
  return `
    <section class="stack section-stack">
      ${snippets.map((snippet) => snippetCard(snippet)).join("")}
    </section>
  `;
}

function renderBanners(banners: ReadonlyArray<AppConsoleBanner>): string {
  if (banners.length === 0) {
    return "";
  }
  return `
    <section class="stack">
      ${banners.map((banner) => `
        <article class="banner banner-${escapeHtml(banner.tone)}">
          <div>
            <strong>${escapeHtml(banner.title)}</strong>
            <p>${escapeHtml(banner.body)}</p>
          </div>
          ${banner.ctaHref && banner.ctaLabel ? `<a class="ds-button ds-button-secondary" href="${escapeHtml(banner.ctaHref)}">${escapeHtml(banner.ctaLabel)}</a>` : ""}
        </article>
      `).join("")}
    </section>
  `;
}

function statCard(stat: AppConsoleStat): string {
  const hrefOpen = stat.href ? `<a class="stat-card" href="${escapeHtml(stat.href)}">` : '<div class="stat-card">';
  const hrefClose = stat.href ? "</a>" : "</div>";
  return `
    ${hrefOpen}
      <div class="stat-label">${escapeHtml(stat.label)}</div>
      <div class="stat-value">${escapeHtml(stat.value)}</div>
      <div class="stat-detail">${escapeHtml(stat.detail)}</div>
    ${hrefClose}
  `;
}

function materializeStaticPreviewUrl(staticMapUrl: string): string | null {
  if (staticMapUrl.includes("{access_token}")) {
    return null;
  }
  return staticMapUrl
    .replace("{lon}", "10.7522")
    .replace("{lat}", "59.9139")
    .replace("{zoom}", "4.5")
    .replace("{width}", "960")
    .replace("{height}", "540");
}

function renderStylePreview(title: string, subtitle: string, staticMapUrl: string): string {
  const previewUrl = materializeStaticPreviewUrl(staticMapUrl);
  const previewBody = previewUrl
    ? `
      <div class="style-preview-frame" data-style-preview-frame>
        <img class="style-preview-image" src="${escapeHtml(previewUrl)}" alt="Static map preview of ${escapeHtml(title)}" loading="lazy" data-style-preview-image />
        <div class="style-preview-empty" data-style-preview-error hidden>
          <strong>Preview could not be loaded</strong>
          <p>The style remains published, but the static map endpoint did not return an image. Copy the URL below to inspect the request.</p>
        </div>
      </div>
    `
    : `
      <div class="style-preview-empty" data-style-preview-empty>
        <strong>Preview unavailable without a project token</strong>
        <p>This page does not expose project tokens. Copy the static map URL below and replace <code>{access_token}</code> in your own authenticated request.</p>
      </div>
    `;
  return `
    <div class="preview-map preview-map-large style-preview-card">
      <div class="style-preview-top">
        <strong>Static map preview</strong>
        <small>${escapeHtml(subtitle)}</small>
      </div>
      ${previewBody}
      <div class="style-preview-legend">
        <strong>${escapeHtml(title)}</strong>
        <div class="chip-row compact">
          <span class="chip chip-live">Published style</span>
          <span class="chip ${previewUrl ? "chip-live" : "chip-muted"}" data-style-preview-status>${previewUrl ? "Preview loaded from static endpoint" : "Preview not loaded"}</span>
        </div>
      </div>
    </div>
  `;
}

function renderUsageBreakdownCard(usage: AppConsolePage["shell"]["usageMonth"]): string {
  const total = usage.requestCount === 0 ? 1 : usage.requestCount;
  const breakdown = [
    { key: "tiles", value: usage.breakdown.tiles, className: "segment-tiles" },
    { key: "raster", value: usage.breakdown.raster, className: "segment-raster" },
    { key: "static", value: usage.breakdown.static, className: "segment-static" },
  ];
  return `
    <article class="ds-card">
      <div class="card-head split">
        <div>
          <h3>Monthly request usage</h3>
          <p>${formatNumber(usage.requestCount)} of ${formatNumber(usage.includedRequests)} included requests used.</p>
        </div>
        <div class="plan-chip">${Math.round(usage.percentOfIncludedRequests)}%</div>
      </div>
      <div class="usage-bar">
        ${breakdown.map((entry) => `
          <span class="usage-segment ${entry.className}" style="width:${(entry.value / total) * 100}%"></span>
        `).join("")}
      </div>
      <div class="usage-grid">
        ${breakdown.map((entry) => `
          <div class="usage-metric">
            <span>${escapeHtml(entry.key)}</span>
            <strong>${formatNumber(entry.value)}</strong>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}

function renderOverview(page: Extract<AppConsolePage, { slug: "overview" }>): string {
  const firstIntegration = page.bootstrap.firstIntegration;
  const onboardingStepCount = page.onboardingSteps.length;
  const onboardingCompletedCount = page.onboardingSteps.filter((step) => step.status === "complete").length;
  const integrationTarget = firstIntegration.readiness === "needs_style"
    ? {
      title: "Published style still needed",
      detail: "A project can already be created, but the shared style, raster, and static integration targets are still waiting on a published style.",
      checklist: [
        "Issue the first project token now so auth and usage tracking are ready.",
        "Publish at least one style so style, raster, and static map URLs become available.",
        "Return to quickstart once a published style exists to complete the browser path.",
      ],
      primaryHref: "/app/styles",
      primaryLabel: "Review styles",
      secondaryHref: firstIntegration.projectCreateHref,
      secondaryLabel: "Create project",
    }
    : {
      title: "First integration target",
      detail: "Complete one working map request before configuring the rest of the workspace.",
      checklist: [
        "Issue one project token and store it immediately. It will not be shown again.",
        "Load the published style URL in MapLibre, then keep raster and static URLs as fallbacks.",
        "Return here after the first successful request to review usage and billing state.",
      ],
      primaryHref: firstIntegration.projectCreateHref,
      primaryLabel: "Open project",
      secondaryHref: firstIntegration.quickstartHref,
      secondaryLabel: "Open quickstart",
    };
  const integrationStatus = firstIntegration.readiness === "needs_style"
    ? `
      <article class="ds-card">
        <div class="card-head split">
          <div>
            <h3>First integration status</h3>
            <p>Project creation is ready, but integration URLs remain unavailable until a style is published.</p>
          </div>
          <span class="plan-chip">needs style</span>
        </div>
        <div class="card-actions">
          <a class="ds-button ds-button-secondary" href="/app/styles">Review styles</a>
          <a class="ds-button ds-button-secondary" href="${escapeHtml(firstIntegration.projectCreateHref)}">Open project</a>
        </div>
      </article>
    `
    : `
      <article class="ds-card">
        <div class="card-head split">
          <div>
            <h3>First integration status</h3>
            <p>Published style, raster, and static map URLs are ready for the first map request.</p>
          </div>
          <span class="plan-chip">${escapeHtml(formatStateLabel(firstIntegration.readiness))}</span>
        </div>
        <div class="card-actions">
          <a class="ds-button ds-button-secondary" href="${escapeHtml(firstIntegration.projectCreateHref)}">Open project</a>
          <a class="ds-button ds-button-secondary" href="${escapeHtml(firstIntegration.quickstartHref)}">Open quickstart</a>
        </div>
      </article>
    `;
  const onboarding = page.bootstrap.onboarding.needsProjectSetup
    ? `
      <section class="two-column onboarding-layout">
        <article class="ds-card focus-card">
        <div class="card-head">
          <h3>Setup checklist</h3>
          <p>Complete these steps to create a project, issue a token, and make the first map request.</p>
          </div>
          <div class="split progress-head">
            <strong>Step ${onboardingCompletedCount + 1} of ${onboardingStepCount}</strong>
            <span class="subtle-text">${onboardingCompletedCount}/${onboardingStepCount} complete</span>
          </div>
          <div class="setup-progress" aria-hidden="true">
            <span class="setup-progress-fill" style="width:${(onboardingCompletedCount / onboardingStepCount) * 100}%"></span>
          </div>
          <div class="stack compact">
            ${page.onboardingSteps.map((step, index) => `
              <a class="setup-step setup-step-${escapeHtml(step.status)}" href="${escapeHtml(step.href ?? "/app")}">
                <span class="setup-step-index">${index + 1}</span>
                <div>
                  <strong>${escapeHtml(step.label)}</strong>
                  <p>${escapeHtml(step.detail)}</p>
                </div>
                <span class="chip">${escapeHtml(formatStateLabel(step.status))}</span>
              </a>
            `).join("")}
          </div>
          <div class="card-actions">
            <a class="ds-button ds-button-primary" href="/app/projects/new">Create first project</a>
            <a class="ds-button ds-button-secondary" href="/docs/quickstart">Open quickstart</a>
          </div>
        </article>
        <article class="ds-card">
          <div class="card-head">
            <h3>${escapeHtml(integrationTarget.title)}</h3>
            <p>${escapeHtml(integrationTarget.detail)}</p>
          </div>
          <div class="checklist">
            ${integrationTarget.checklist.map((item) => `<div class="check-item">${escapeHtml(item)}</div>`).join("")}
          </div>
          <div class="card-actions">
            <a class="ds-button ds-button-secondary" href="${escapeHtml(integrationTarget.primaryHref)}">${escapeHtml(integrationTarget.primaryLabel)}</a>
            <a class="ds-button ds-button-secondary" href="${escapeHtml(integrationTarget.secondaryHref)}">${escapeHtml(integrationTarget.secondaryLabel)}</a>
          </div>
        </article>
      </section>
    `
    : "";
  const quickProjects = page.bootstrap.projects.slice(0, 3);
  const statsSection = page.bootstrap.onboarding.needsProjectSetup
    ? ""
    : `
      <section class="stats-grid">
        ${page.stats.map((stat) => statCard(stat)).join("")}
      </section>
    `;
  return `
    ${statsSection}
    ${onboarding}
    <section class="two-column">
      ${renderUsageBreakdownCard(page.shell.usageMonth)}
      <article class="ds-card">
        <div class="card-head">
          <h3>Project shortcuts</h3>
          <p>Open a project to review access, keys, and recent request usage.</p>
        </div>
        ${quickProjects.length === 0 ? `
          <div class="empty-note">No projects yet. Start from the project creation flow.</div>
        ` : `
          <div class="stack compact">
            ${quickProjects.map((project) => `
              <a class="list-row" href="/app/projects/${encodeURIComponent(project.id)}">
                <div>
                  <strong>${escapeHtml(project.name)}</strong>
                  <span>${formatNumber(project.latestMonthUsage.requestCount)} month requests</span>
                </div>
                <span class="chip">${escapeHtml(project.planId)}</span>
              </a>
            `).join("")}
          </div>
        `}
      </article>
    </section>
    <section class="section-header">
      <div>
        <h2>First integration snippets</h2>
        <p>Keep the first render path obvious: style URL, raster fallback, and static map endpoint.</p>
      </div>
    </section>
    ${integrationStatus}
    ${renderSnippets(page.snippets)}
  `;
}

function renderProjects(page: Extract<AppConsolePage, { slug: "projects" }>): string {
  if (page.bootstrap.projects.length === 0) {
    return `
      <article class="ds-card focus-card">
        <div class="card-head">
          <h3>No projects yet</h3>
          <p>Create a first project to unlock tokens, usage tracking, and snippets.</p>
        </div>
        <div class="card-actions">
          <a class="ds-button ds-button-primary" href="/app/projects/new">Create project</a>
          <a class="ds-button ds-button-secondary" href="/docs/quickstart">Read quickstart</a>
        </div>
      </article>
    `;
  }
  return `
    <section class="section-header split">
      <div>
        <h2>Workspace projects</h2>
        <p>Review access policy, key status, and recent request usage for each project.</p>
      </div>
      <a class="ds-button ds-button-primary" href="/app/projects/new">Create project</a>
    </section>
    <section class="stack section-stack">
      ${page.bootstrap.projects.map((project) => `
        <article class="ds-card">
          <div class="card-head split">
            <div>
              <h3>${escapeHtml(project.name)}</h3>
              <p>${project.allowedOrigins.length} allowed origins · ${project.lastKeyRotationAt ? `last rotated ${escapeHtml(formatDate(project.lastKeyRotationAt))}` : "no key rotation yet"}</p>
            </div>
            <div class="stack compact align-end">
              <span class="plan-chip">${escapeHtml(project.planId)}</span>
              <span class="subtle-text">${formatNumber(project.latestMonthUsage.requestCount)} month requests</span>
            </div>
          </div>
          <div class="chip-row">
            <span class="chip ${project.allowedEndpoints.tiles ? "chip-live" : "chip-muted"}">tiles</span>
            <span class="chip ${project.allowedEndpoints.raster ? "chip-live" : "chip-muted"}">raster</span>
            <span class="chip ${project.allowedEndpoints.staticMaps ? "chip-live" : "chip-muted"}">static</span>
          </div>
          <div class="two-column compact-grid">
            <div class="metric-card">
              <span>Day</span>
              <strong>${formatNumber(project.latestDayUsage.requestCount)}</strong>
            </div>
            <div class="metric-card">
              <span>Month</span>
              <strong>${formatNumber(project.latestMonthUsage.requestCount)}</strong>
            </div>
          </div>
          <div class="card-actions wrap">
            <a class="ds-button ds-button-secondary" href="/app/projects/${encodeURIComponent(project.id)}">Open project</a>
            <a class="ds-button ds-button-secondary" href="/app/projects/${encodeURIComponent(project.id)}/usage">Usage</a>
            <button class="ds-button ds-button-secondary" type="button" data-rotate-endpoint="/app-api/projects/${encodeURIComponent(project.id)}/keys/rotate" data-result-target="rotate-result-${escapeHtml(project.id)}">Rotate key</button>
          </div>
          <div id="rotate-result-${escapeHtml(project.id)}" class="stack compact"></div>
        </article>
      `).join("")}
    </section>
  `;
}

function renderProjectNew(page: Extract<AppConsolePage, { slug: "project-new" }>): string {
  return `
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>Create project</h2>
          <p>Choose which sites and map endpoints can use this project's access token. Plan limits come from the workspace.</p>
        </div>
        <form class="stack" data-project-create-form>
          <label class="field">
            <span>Project name</span>
            <input name="name" type="text" placeholder="Production web map" required />
          </label>
          <label class="field">
            <span>Allowed origins</span>
            <textarea name="allowedOrigins" rows="5" placeholder="https://maps.example.com&#10;https://preview.example.com"></textarea>
          </label>
          <div class="field">
            <span>Endpoint groups</span>
            <label class="check"><input name="tiles" type="checkbox" checked /> Vector tiles</label>
            <label class="check"><input name="raster" type="checkbox" checked /> Raster tiles</label>
            <label class="check"><input name="staticMaps" type="checkbox" checked /> Static maps</label>
          </div>
          <div class="card-actions">
            <button class="ds-button ds-button-primary" type="submit">Create project</button>
            <span class="subtle-text">Token will be shown once after creation and will not be shown again.</span>
          </div>
          <p class="subtle-text" data-form-status></p>
        </form>
      </article>
      <article class="ds-card">
        <div class="card-head">
          <h2>After creation</h2>
          <p>After creation, copy the one-time token before leaving the result card, then open the project or quickstart.</p>
        </div>
        <div class="preview-map">
          <span>Workspace plan</span>
          <strong>${escapeHtml(page.shell.billing.planId)}</strong>
          <small>${escapeHtml(formatStatus(page.shell.billing.subscriptionStatus))}</small>
        </div>
        ${page.seedSnippets.length > 0 ? `
          <div class="stack compact">
            <h3>Style-driven preview URLs</h3>
            ${page.seedSnippets.slice(0, 2).map((snippet) => snippetCard(snippet)).join("")}
          </div>
        ` : `
          <div class="empty-note">No style has been published yet. You can still create the project, but integration URLs will remain unavailable.</div>
        `}
      </article>
    </section>
    <section id="project-create-result" class="stack"></section>
  `;
}

function renderProjectDetail(page: Extract<AppConsolePage, { slug: "project-detail" }>): string {
  const detail = page.detail;
  const allowedOrigins = detail.project.allowedOrigins.join("\n");
  const dayUsage = detail.project.latestDayUsage;
  const monthUsage = detail.project.latestMonthUsage;
  return `
    <section class="section-header split">
      <div>
        <h2>${escapeHtml(detail.project.name)}</h2>
        <p>Review allowed origins, endpoint access, key status, and request usage.</p>
      </div>
      <div class="stack compact align-end">
        <span class="plan-chip">${escapeHtml(detail.project.planId)}</span>
        <a class="ds-button ds-button-secondary" href="/app/projects/${encodeURIComponent(detail.project.id)}/usage">Open usage</a>
      </div>
    </section>
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h3>Project settings</h3>
          <p>You can update allowed origins and endpoint access. Request limits come from the workspace plan.</p>
        </div>
        <form class="stack" data-project-update-form data-project-endpoint="/app-api/projects/${encodeURIComponent(detail.project.id)}">
          <label class="field">
            <span>Project name</span>
            <input name="name" type="text" value="${escapeHtml(detail.project.name)}" required />
          </label>
          <label class="field">
            <span>Allowed origins</span>
            <textarea name="allowedOrigins" rows="5">${escapeHtml(allowedOrigins)}</textarea>
          </label>
          <div class="field">
            <span>Endpoint groups</span>
            <label class="check"><input name="tiles" type="checkbox" ${detail.project.allowedEndpoints.tiles ? "checked" : ""} /> Vector tiles</label>
            <label class="check"><input name="raster" type="checkbox" ${detail.project.allowedEndpoints.raster ? "checked" : ""} /> Raster tiles</label>
            <label class="check"><input name="staticMaps" type="checkbox" ${detail.project.allowedEndpoints.staticMaps ? "checked" : ""} /> Static maps</label>
          </div>
          <div class="card-actions">
            <button class="ds-button ds-button-primary" type="submit">Save settings</button>
            <p class="subtle-text" data-form-status></p>
          </div>
        </form>
      </article>
      <article class="ds-card">
        <div class="card-head">
          <h3>Key management</h3>
          <p>Raw key material is never redisplayed. Rotation invalidates the previous key immediately.</p>
        </div>
        <div class="stack compact">
          ${detail.keys.map((key) => `
            <div class="list-row">
              <div>
                <strong>${escapeHtml(key.keyId)}</strong>
                <span>${escapeHtml(formatDate(key.createdAt))}</span>
              </div>
              <span class="chip ${key.revoked ? "chip-muted" : "chip-live"}">${key.revoked ? "revoked" : "active"}</span>
            </div>
          `).join("")}
        </div>
        <div class="card-actions">
          <button class="ds-button ds-button-danger" type="button" data-rotate-endpoint="/app-api/projects/${encodeURIComponent(detail.project.id)}/keys/rotate" data-result-target="detail-rotate-result">Rotate key</button>
        </div>
        <div id="detail-rotate-result" class="stack"></div>
      </article>
    </section>
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head split">
          <div>
            <h3>Usage snapshot</h3>
            <p>Keep the quota question visible next to project settings and key controls.</p>
          </div>
          <a class="ds-button ds-button-secondary" href="/app/projects/${encodeURIComponent(detail.project.id)}/usage">Open full usage</a>
        </div>
        <div class="compact-grid">
          <div class="metric-card">
            <span>Latest day</span>
            <strong>${formatNumber(dayUsage.requestCount)}</strong>
            <small class="subtle-text">${Math.round(dayUsage.percentOfIncludedRequests)}% of included allowance</small>
          </div>
          <div class="metric-card">
            <span>Latest month</span>
            <strong>${formatNumber(monthUsage.requestCount)}</strong>
            <small class="subtle-text">${Math.round(monthUsage.percentOfIncludedRequests)}% of included allowance</small>
          </div>
        </div>
        <div class="metric-stack">
          <div class="metric-card">
            <span>Allowed origins</span>
            <strong>${formatNumber(detail.project.allowedOrigins.length)}</strong>
          </div>
          <div class="metric-card">
            <span>Workspace plan</span>
            <strong>${escapeHtml(detail.project.planId)}</strong>
          </div>
        </div>
      </article>
      <article class="ds-card">
        <div class="card-head">
          <h3>Endpoint coverage</h3>
          <p>Check which map endpoints this project's token can access before debugging an integration.</p>
        </div>
        <div class="chip-row">
          <span class="chip ${detail.project.allowedEndpoints.tiles ? "chip-live" : "chip-muted"}">tiles</span>
          <span class="chip ${detail.project.allowedEndpoints.raster ? "chip-live" : "chip-muted"}">raster</span>
          <span class="chip ${detail.project.allowedEndpoints.staticMaps ? "chip-live" : "chip-muted"}">static</span>
        </div>
        <div class="checklist">
          <div class="check-item">Latest rotation ${detail.project.lastKeyRotationAt ? escapeHtml(formatDate(detail.project.lastKeyRotationAt)) : "not yet issued"}</div>
          <div class="check-item">Status follows workspace billing state: ${escapeHtml(formatStatus(page.shell.billing.subscriptionStatus))}</div>
        </div>
      </article>
    </section>
    <section class="section-header">
      <div>
        <h2>Quickstart snippets</h2>
        <p>Keep the integration path next to project configuration so token changes are visible immediately.</p>
      </div>
    </section>
    ${renderSnippets(page.snippets)}
  `;
}

function renderProjectUsage(page: Extract<AppConsolePage, { slug: "project-usage" }>): string {
  const usage = page.usage;
  const total = usage.requestCount === 0 ? 1 : usage.requestCount;
  const breakdown = [
    { label: "tiles", value: usage.breakdown.tiles, className: "segment-tiles" },
    { label: "raster", value: usage.breakdown.raster, className: "segment-raster" },
    { label: "static", value: usage.breakdown.static, className: "segment-static" },
  ];
  return `
    <section class="section-header split">
      <div>
        <h2>${escapeHtml(page.detail.project.name)} usage</h2>
        <p>Answer the quota question directly with day and month windows.</p>
      </div>
      <div class="mode-toggle">
        <a class="mode-link ${page.window === "day" ? "active" : ""}" href="/app/projects/${encodeURIComponent(page.detail.project.id)}/usage?window=day">Day</a>
        <a class="mode-link ${page.window === "month" ? "active" : ""}" href="/app/projects/${encodeURIComponent(page.detail.project.id)}/usage?window=month">Month</a>
      </div>
    </section>
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head split">
          <div>
            <h3>${page.window === "day" ? "Daily" : "Monthly"} request volume</h3>
            <p>${formatNumber(usage.requestCount)} requests. ${Math.round(usage.percentOfIncludedRequests)}% of included allowance for the workspace plan.</p>
          </div>
          <span class="plan-chip">${escapeHtml(page.detail.project.planId)}</span>
        </div>
        <div class="usage-bar large">
          ${breakdown.map((entry) => `
            <span class="usage-segment ${entry.className}" style="width:${(entry.value / total) * 100}%"></span>
          `).join("")}
        </div>
        <div class="usage-grid">
          ${breakdown.map((entry) => `
            <div class="usage-metric">
              <span>${escapeHtml(entry.label)}</span>
              <strong>${formatNumber(entry.value)}</strong>
            </div>
          `).join("")}
        </div>
      </article>
      <article class="ds-card">
        <div class="card-head">
          <h3>Allowance context</h3>
          <p>Compare this project's requests with the allowance included in the workspace plan.</p>
        </div>
        <div class="metric-stack">
          <div class="metric-card">
            <span>Included</span>
            <strong>${formatNumber(usage.includedRequests)}</strong>
          </div>
          <div class="metric-card">
            <span>Used</span>
            <strong>${formatNumber(usage.requestCount)}</strong>
          </div>
          <div class="metric-card">
            <span>Workspace status</span>
            <strong>${escapeHtml(formatStatus(page.shell.billing.subscriptionStatus))}</strong>
          </div>
        </div>
        ${page.shell.billing.planId === "free" ? `
          <div class="card-actions">
            <a class="ds-button ds-button-primary" href="/app/billing">Upgrade in Stripe</a>
          </div>
        ` : ""}
      </article>
    </section>
  `;
}

function renderStyles(page: Extract<AppConsolePage, { slug: "styles" }>): string {
  if (page.bootstrap.styles.length === 0) {
    return `
      <article class="ds-card empty-state">
        <h3>No published styles</h3>
        <p>No style has been published to this workspace. Publish one before using style, raster, or static map URLs.</p>
        <a class="ds-button ds-button-secondary" href="/docs/styles">Open style docs</a>
      </article>
    `;
  }
  return `
    <section class="section-header">
      <div>
        <h2>Published styles</h2>
        <p>These are the published integration targets exposed to customer projects.</p>
      </div>
    </section>
    <section class="stack section-stack">
      ${page.bootstrap.styles.map((style) => `
        <article class="ds-card">
          <div class="card-head split">
            <div>
              <h3>${escapeHtml(style.name)}</h3>
              <p>Published version ${escapeHtml(style.publishedVersionId ?? "n/a")}</p>
            </div>
            <a class="ds-button ds-button-secondary" href="/app/styles/${encodeURIComponent(style.id)}">Open style</a>
          </div>
          ${renderStylePreview(style.name, style.publishedVersionId ?? "Published version", style.staticMapUrl)}
          <div class="metric-stack">
            <div class="metric-card">
              <span>Style JSON</span>
              <strong>${escapeHtml(style.styleUrl)}</strong>
            </div>
            <div class="metric-card">
              <span>Raster example</span>
              <strong>${escapeHtml(style.rasterTileUrl)}</strong>
            </div>
            <div class="metric-card">
              <span>Static example</span>
              <strong>${escapeHtml(style.staticMapUrl)}</strong>
            </div>
          </div>
          <div class="stack compact">
            <div class="field inline-field">
              <input type="text" readonly value="${escapeHtml(style.styleUrl)}" />
              <button class="ds-button ds-button-secondary" type="button" data-copy-value="${escapeHtml(style.styleUrl)}">Copy style URL</button>
            </div>
            <div class="field inline-field">
              <input type="text" readonly value="${escapeHtml(style.rasterTileUrl)}" />
              <button class="ds-button ds-button-secondary" type="button" data-copy-value="${escapeHtml(style.rasterTileUrl)}">Copy raster URL</button>
            </div>
            <div class="field inline-field">
              <input type="text" readonly value="${escapeHtml(style.staticMapUrl)}" />
              <button class="ds-button ds-button-secondary" type="button" data-copy-value="${escapeHtml(style.staticMapUrl)}">Copy static URL</button>
            </div>
          </div>
        </article>
      `).join("")}
    </section>
  `;
}

function renderStyleDetail(page: Extract<AppConsolePage, { slug: "style-detail" }>): string {
  return `
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>${escapeHtml(page.detail.style.name)}</h2>
          <p>Published style detail with direct URLs for style JSON, raster tiles, and static maps.</p>
        </div>
        ${renderStylePreview(page.detail.style.name, page.detail.style.id, page.detail.style.staticMapUrl)}
        <div class="metric-stack">
          <div class="metric-card">
            <span>Style JSON</span>
            <strong>${escapeHtml(page.detail.style.styleUrl)}</strong>
          </div>
          <div class="metric-card">
            <span>Raster URL</span>
            <strong>${escapeHtml(page.detail.style.rasterTileUrl)}</strong>
          </div>
          <div class="metric-card">
            <span>Static URL</span>
            <strong>${escapeHtml(page.detail.style.staticMapUrl)}</strong>
          </div>
        </div>
        <div class="stack compact">
          <div class="field inline-field">
            <input type="text" readonly value="${escapeHtml(page.detail.style.styleUrl)}" />
            <button class="ds-button ds-button-secondary" type="button" data-copy-value="${escapeHtml(page.detail.style.styleUrl)}">Copy style URL</button>
          </div>
          <div class="field inline-field">
            <input type="text" readonly value="${escapeHtml(page.detail.style.rasterTileUrl)}" />
            <button class="ds-button ds-button-secondary" type="button" data-copy-value="${escapeHtml(page.detail.style.rasterTileUrl)}">Copy raster URL</button>
          </div>
          <div class="field inline-field">
            <input type="text" readonly value="${escapeHtml(page.detail.style.staticMapUrl)}" />
            <button class="ds-button ds-button-secondary" type="button" data-copy-value="${escapeHtml(page.detail.style.staticMapUrl)}">Copy static URL</button>
          </div>
        </div>
      </article>
      <article class="ds-card">
        <div class="card-head">
          <h2>Integration hints</h2>
          <p>Browser clients should prefer query-token auth when preflight complexity is a concern.</p>
        </div>
        <div class="checklist">
          <div class="check-item">Use style JSON directly in MapLibre.</div>
          <div class="check-item">Use raster or static map URLs when the client only needs an image.</div>
          <div class="check-item">Copy snippets with placeholder tokens, then swap to the real project key.</div>
        </div>
      </article>
    </section>
    ${renderSnippets(page.snippets)}
  `;
}

function renderBilling(page: Extract<AppConsolePage, { slug: "billing" }>): string {
  const billing = page.bootstrap.billing;
  const usage = page.bootstrap.usageMonth;
  const mirror = page.mirrorState;
  const upgradeIntent = page.primaryAction.endpoint === "/billing/checkout" && page.checkoutIntentPlanId
    ? `
      <article class="banner banner-info">
        <div>
          <strong>Checkout handoff ready</strong>
          <p>This page was opened from pricing or signup with an upgrade intent. Hosted Stripe Checkout will open automatically for plan ${escapeHtml(page.checkoutIntentPlanId)}.</p>
        </div>
      </article>
    `
    : "";
  const checkoutStatusMessage = page.checkoutStatus === "success"
    ? `<article class="banner banner-info"><div><strong>Checkout started</strong><p>Stripe redirected back to billing. The mirrored plan state updates after webhook confirmation.</p></div></article>`
    : page.checkoutStatus === "cancel"
      ? `<article class="banner banner-warning"><div><strong>Checkout canceled</strong><p>No plan change has been applied. You can reopen Checkout whenever you are ready.</p></div></article>`
      : "";
  return `
    ${upgradeIntent}
    ${checkoutStatusMessage}
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head split">
          <div>
            <h2>Stripe-managed billing</h2>
            <p>Plan changes, renewals, cancellations, and payment method updates happen in Stripe. The app only reflects mirrored state.</p>
          </div>
          <span class="plan-chip">${escapeHtml(billing.planId)}</span>
        </div>
        <article class="banner banner-${escapeHtml(page.stateSummary.tone)}">
          <div>
            <strong>${escapeHtml(page.stateSummary.title)}</strong>
            <p>${escapeHtml(page.stateSummary.body)}</p>
          </div>
        </article>
        <div class="metric-stack">
          <div class="metric-card">
            <span>Status</span>
            <strong>${escapeHtml(formatStatus(billing.subscriptionStatus))}</strong>
          </div>
          <div class="metric-card">
            <span>Billing email</span>
            <strong>${escapeHtml(billing.billingEmail ?? "Not synced yet")}</strong>
          </div>
          <div class="metric-card">
            <span>${escapeHtml(page.stateSummary.periodLabel)}</span>
            <strong>${escapeHtml(formatDate(billing.currentPeriodEnd))}</strong>
          </div>
          <div class="metric-card">
            <span>Included monthly requests</span>
            <strong>${formatNumber(page.plan.freeAllowancePerMonth)}</strong>
          </div>
          <div class="metric-card">
            <span>Last Stripe sync</span>
            <strong>${escapeHtml(mirror.lastWebhookAtLabel)}</strong>
          </div>
        </div>
        <p class="billing-action-guidance" id="billing-action-guidance">
          ${page.primaryAction.endpoint === "/billing/checkout"
            ? `Continue to Stripe Checkout for the ${escapeHtml(formatStateLabel(page.primaryAction.planId ?? "pro"))} plan. The plan changes only after Stripe confirms checkout.`
            : `Continue to the Stripe Customer Portal for the ${escapeHtml(formatStateLabel(billing.planId))} plan. Changes appear here after Stripe sends a webhook.`}
        </p>
        <div class="card-actions wrap">
          ${page.primaryAction.endpoint === "/billing/checkout"
            ? `<button class="ds-button ${page.primaryAction.appearance === "ghost" ? "ds-button-secondary" : "ds-button-primary"}" type="button" aria-describedby="billing-action-guidance" data-billing-endpoint="${escapeHtml(page.primaryAction.endpoint)}" data-billing-plan="${escapeHtml(page.primaryAction.planId ?? "pro")}" ${page.primaryAction.autoOpen ? 'data-billing-auto-open="true"' : ""}>${escapeHtml(page.primaryAction.label)}</button>`
            : `<button class="ds-button ${page.primaryAction.appearance === "ghost" ? "ds-button-secondary" : "ds-button-primary"}" type="button" aria-describedby="billing-action-guidance" data-portal-endpoint="${escapeHtml(page.primaryAction.endpoint)}">${escapeHtml(page.primaryAction.label)}</button>`}
        </div>
        <p class="subtle-text" id="billing-status" aria-live="polite"></p>
      </article>
      ${renderUsageBreakdownCard(usage)}
    </section>
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h3>Mirrored Stripe state</h3>
          <p>Keep the Stripe-linked references and sync freshness visible before opening Checkout or the Customer Portal.</p>
        </div>
        <div class="metric-stack">
          <div class="metric-card">
            <span>Mirror status</span>
            <strong>${escapeHtml(mirror.syncStatusLabel)}</strong>
          </div>
          <div class="metric-card">
            <span>Stripe customer reference</span>
            <strong>${escapeHtml(mirror.customerReference)}</strong>
          </div>
          <div class="metric-card">
            <span>Stripe subscription reference</span>
            <strong>${escapeHtml(mirror.subscriptionReference)}</strong>
          </div>
        </div>
        <div class="checklist">
          <div class="check-item">${escapeHtml(mirror.syncGuidance)}</div>
        </div>
      </article>
      <article class="ds-card">
        <div class="card-head">
          <h3>Billing rules</h3>
          <p>The workspace plan changes only after Stripe confirms the transition by webhook.</p>
        </div>
        <div class="checklist">
          <div class="check-item">Checkout creates a Stripe-hosted session and returns a hosted URL.</div>
          <div class="check-item">Customer Portal handles subscription management and payment methods.</div>
          <div class="check-item">The primary CTA changes with Stripe state: upgrade, portal recovery, resume, or routine management.</div>
        </div>
      </article>
    </section>
  `;
}

function renderPageContent(page: AppConsolePage): string {
  switch (page.slug) {
    case "overview":
      return renderOverview(page);
    case "projects":
      return renderProjects(page);
    case "project-new":
      return renderProjectNew(page);
    case "project-detail":
      return renderProjectDetail(page);
    case "project-usage":
      return renderProjectUsage(page);
    case "styles":
      return renderStyles(page);
    case "style-detail":
      return renderStyleDetail(page);
    case "billing":
      return renderBilling(page);
    case "settings":
    case "settings-members":
    case "settings-security":
    case "settings-security-mfa":
    case "settings-security-password":
    case "settings-account":
    case "settings-account-export":
    case "settings-account-delete":
    case "notifications":
      return renderSettingsPageContent(page);
  }
}

function renderPrimaryNavigation(page: AppConsolePage, label: string): string {
  return `
    <nav class="nav" aria-label="${escapeHtml(label)}">
      ${page.shell.navigation.map((item) => `
        <a class="${item.active ? "active" : ""}" href="${escapeHtml(item.href)}"${item.active ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>
      `).join("")}
    </nav>
  `;
}

function renderSupportNavigation(): string {
  return `
    <details class="support-menu">
      <summary>Help, status, and legal</summary>
      <nav class="support-links" aria-label="Help, status, and legal">
        <a href="/docs/quickstart">Quickstart</a>
        <a href="/pricing">Pricing</a>
        <a href="/security">Security</a>
        <a href="/status">Service status</a>
        <a href="/legal/terms">Terms</a>
        <a href="/legal/privacy">Privacy</a>
        <a href="/legal/dpa">Data processing agreement</a>
        <a href="/legal/acceptable-use">Acceptable use</a>
        <a href="/">Public map preview</a>
      </nav>
    </details>
  `;
}

function renderWorkspaceSummary(page: AppConsolePage): string {
  const shell = page.shell;
  return `
    <div class="workspace-block">
      <strong>${escapeHtml(shell.workspace.name)}</strong>
      <span>${escapeHtml(shell.currentUser.email)}</span>
      <small>${escapeHtml(formatStateLabel(shell.currentMembership.role))} · ${escapeHtml(formatStateLabel(shell.billing.planId))} plan</small>
    </div>
  `;
}

function renderUsageSummary(page: AppConsolePage): string {
  return `
    <div class="sidebar-usage">
      <span>Current month</span>
      <strong>${formatNumber(page.shell.usageMonth.requestCount)} requests</strong>
      <small>${Math.round(page.shell.usageMonth.percentOfIncludedRequests)}% of included allowance</small>
    </div>
  `;
}

function renderSignOut(): string {
  return `
    <form class="sign-out-form" action="/sign-out" method="post">
      <button class="ds-button ds-button-secondary w-full" type="submit">Sign out</button>
    </form>
  `;
}

export function renderAppConsoleHtml(page: AppConsolePage): string {
  const shell = page.shell;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)} | Tileserver App</title>
  <style>
    ${getAppConsoleCss()}
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="mobile-header">
    <div class="mobile-header-row">
      <a class="brand" href="/app">Tileserver</a>
      <details class="mobile-menu">
        <summary class="ds-button ds-button-secondary">Menu</summary>
        <div class="mobile-menu-panel">
          ${renderWorkspaceSummary(page)}
          ${renderPrimaryNavigation(page, "Workspace")}
          ${renderUsageSummary(page)}
          ${renderSupportNavigation()}
          ${renderSignOut()}
        </div>
      </details>
    </div>
  </header>
  <div class="app-shell">
    <aside class="sidebar" aria-label="Workspace navigation">
      <a class="brand" href="/app">Tileserver</a>
      ${renderWorkspaceSummary(page)}
      ${renderPrimaryNavigation(page, "Workspace")}
      ${renderUsageSummary(page)}
      ${renderSupportNavigation()}
      ${renderSignOut()}
    </aside>
    <main id="main-content" tabindex="-1">
      <section class="topbar">
        <div class="stack compact">
          <p class="page-kicker">Customer console</p>
          <h1>${escapeHtml(page.title)}</h1>
          <p>${escapeHtml(page.description)}</p>
        </div>
        <div class="stack compact align-end">
          <span class="plan-chip">${escapeHtml(shell.billing.planId)}</span>
          <span class="subtle-text">${escapeHtml(formatStatus(shell.billing.subscriptionStatus))}</span>
        </div>
      </section>
      ${renderBanners(shell.statusBanners)}
      ${renderPageContent(page)}
    </main>
  </div>
  <div class="modal-shell" data-rotate-confirm-dialog aria-hidden="true" hidden>
    <article class="modal-card" role="dialog" aria-modal="true" aria-labelledby="rotate-confirm-title">
      <div class="card-head">
        <h2 id="rotate-confirm-title">Confirm key rotation</h2>
        <p>Rotate this project key only if the current token is compromised or you are intentionally reissuing credentials. The previous token will stop working immediately, and the new token will only be shown once.</p>
      </div>
      <div class="checklist">
        <div class="check-item">The old key is revoked immediately.</div>
        <div class="check-item">The replacement token must be copied before closing the result card.</div>
        <div class="check-item">Open quickstart after rotation if browser snippets need to be updated.</div>
      </div>
      <div class="modal-actions">
        <button class="ds-button ds-button-secondary" type="button" data-rotate-cancel>Keep current key</button>
        <button class="ds-button ds-button-danger" type="button" data-rotate-confirm>Rotate key now</button>
      </div>
      <button class="ds-button ds-button-secondary" type="button" data-rotate-close>Close</button>
    </article>
  </div>
  ${renderAppConsoleClientScript()}
</body>
</html>`;
}
