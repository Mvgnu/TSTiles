import { getGlobalCss } from "../../design-system/styles";
import type {
  AdminConsolePage,
  AdminConsoleSignInPage,
} from "../types";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(isoString: unknown): string {
  if (typeof isoString !== "string") {
    return "N/A";
  }
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
  } catch {
    return "N/A";
  }
}

function renderOverview(page: Extract<AdminConsolePage, { slug: "overview" }>): string {
  return `
    <section class="ds-stat-grid" style="grid-template-columns: repeat(4, 1fr); display: grid; gap: 16px; margin-bottom: 24px;">
      <article class="ds-card">
        <span class="subtle-text">Total Artifacts</span>
        <strong style="font-size: 24px; display: block; margin-top: 4px;">${page.counts.artifacts}</strong>
      </article>
      <article class="ds-card">
        <span class="subtle-text">Total Projects</span>
        <strong style="font-size: 24px; display: block; margin-top: 4px;">${page.counts.projects}</strong>
      </article>
      <article class="ds-card">
        <span class="subtle-text">Active Jobs</span>
        <strong style="font-size: 24px; display: block; margin-top: 4px;">${page.counts.activeJobs}</strong>
      </article>
      <article class="ds-card">
        <span class="subtle-text">Recent Audit Logs</span>
        <strong style="font-size: 24px; display: block; margin-top: 4px;">${page.counts.recentAuditEvents}</strong>
      </article>
    </section>

    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>Quick Actions</h2>
          <p>Common operational shortcuts. Mutating actions require confirmation reason.</p>
        </div>
        <div class="stack" style="margin-top: 16px; gap: 12px;">
          <a class="ds-button ds-button-secondary ds-button-sm" href="/ops/ingest">Trigger OSM Ingest</a>
          <button class="ds-button ds-button-secondary ds-button-sm" type="button" data-modal-trigger="promote-latest">Promote Latest Artifact</button>
          <a class="ds-button ds-button-secondary ds-button-sm" href="/ops/audit">Open Audit Logs</a>
        </div>
      </article>

      <article class="ds-card">
        <div class="card-head">
          <h2>Operational Checklist</h2>
          <p>Verify global system parameters are green.</p>
        </div>
        <div class="checklist" style="margin-top: 16px;">
          <div class="check-item">Object Storage Mode is configured for persistence.</div>
          <div class="check-item">Brevo Transactional Email credentials verified.</div>
          <div class="check-item">Stripe mirrred billing webhook active.</div>
        </div>
      </article>
    </section>
  `;
}

function renderArtifacts(page: Extract<AdminConsolePage, { slug: "artifacts" }>): string {
  const activeId = page.activeVersionId;
  return `
    ${activeId ? `
      <article class="ds-card focus-card" style="margin-bottom: 24px;">
        <div class="card-head split">
          <div>
            <span class="chip success">Active Artifact</span>
            <h3 style="margin-top: 8px;">Version: ${escapeHtml(activeId)}</h3>
            <p>This dataset version is currently serving all customer /v1/tiles/* vector tile requests.</p>
          </div>
          <button class="ds-button ds-button-danger ds-button-ghost ds-button-sm" data-modal-trigger="rollback" type="button">Rollback Active Artifact</button>
        </div>
      </article>
    ` : `
      <article class="ds-card focus-card" style="margin-bottom: 24px; border-color: var(--danger);">
        <div class="card-head">
          <span class="chip danger">No Active Artifact</span>
          <h3 style="margin-top: 8px;">Vector tile service is currently offline</h3>
          <p>Promote a pmtiles vector dataset from the catalog below to restore the tileserver endpoint.</p>
        </div>
      </article>
    `}

    <article class="ds-card">
      <div class="card-head">
        <h2>PMTiles Catalog</h2>
        <p>List of all ingested vector map artifacts available on local storage or S3 compatible store.</p>
      </div>
      <table class="ds-table" style="margin-top: 16px;">
        <thead>
          <tr>
            <th>Version ID</th>
            <th>Expected Checksum</th>
            <th>Size (Bytes)</th>
            <th>Ingested At</th>
            <th style="text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${page.artifacts.length === 0 ? `
            <tr><td colspan="5" style="text-align: center; color: var(--muted); padding: 24px;">No ingested artifacts found. Use Ingest page to download one.</td></tr>
          ` : page.artifacts.map((art) => `
            <tr>
              <td><code>${escapeHtml(art.id)}</code></td>
              <td><code style="font-size: 11px;">${escapeHtml(art.checksum)}</code></td>
              <td>${art.byteSize ? art.byteSize.toLocaleString() : "N/A"}</td>
              <td>${formatDate(art.createdAt)}</td>
              <td style="text-align: right;">
                ${art.id === activeId ? `
                  <span class="chip success">Active</span>
                ` : `
                  <button class="ds-button ds-button-primary ds-button-sm" data-modal-trigger="promote-${escapeHtml(art.id)}" type="button">Promote</button>
                `}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function renderIngest(page: Extract<AdminConsolePage, { slug: "ingest" }>): string {
  return `
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>Trigger OSM Ingest</h2>
          <p>Initiate an asynchronous pipeline download from Planet OSM or Geofabrik. Requires a sha256 checksum.</p>
        </div>
        <form class="stack" data-ingest-trigger-form data-ingest-endpoint="/ops/ingest/start" style="margin-top: 16px;">
          <label class="field">
            <span>Snapshot ID / Dataset Version</span>
            <input name="snapshotId" type="text" placeholder="2026-05-27" required autocomplete="off" />
          </label>
          <label class="field">
            <span>Source URL (.pmtiles or .osm.pbf link)</span>
            <input name="sourceUrl" type="url" placeholder="https://example.com/map.pmtiles" required autocomplete="off" />
          </label>
          <label class="field">
            <span>Expected SHA-256 Checksum</span>
            <input name="expectedChecksum" type="text" placeholder="a1b2c3d4..." required autocomplete="off" />
          </label>
          <label class="field">
            <span>Confirmation Reason (Required, ≥ 8 chars)</span>
            <input name="reason" type="text" placeholder="Scheduled source refresh for production tiles" required autocomplete="off" />
          </label>
          <div class="card-actions">
            <button class="ds-button ds-button-primary" type="submit">Trigger ingest pipeline now</button>
            <p class="subtle-text" data-ingest-status></p>
          </div>
        </form>
      </article>

      <article class="ds-card">
        <div class="card-head">
          <h2>Ingest Pipeline Log</h2>
          <p>Recent OSM ingest worker execution history.</p>
        </div>
        <div class="stack compact" style="margin-top: 16px; max-height: 480px; overflow-y: auto;">
          ${page.recentJobs.length === 0 ? `
            <p style="text-align: center; color: var(--muted); padding: 24px;">No recent ingest runs recorded.</p>
          ` : page.recentJobs.map((job) => `
            <div class="list-row" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line);">
              <div style="max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <strong>${escapeHtml(job.jobId)}</strong>
                <span style="display: block; font-size: 12px; color: var(--muted);">Snapshot: ${escapeHtml(job.snapshotId)} · Actor: ${escapeHtml(job.actor)}</span>
              </div>
              <div style="text-align: right;">
                 <span class="chip ${job.status === "started" ? "warn" : job.outcome === "ok" ? "success" : "danger"}">${escapeHtml(job.status === "started" ? "Running" : job.outcome === "ok" ? "Success" : "Failed")}</span>
                <span style="display: block; font-size: 10px; color: var(--muted); margin-top: 4px;">${formatDate(job.startedAt)}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </article>
    </section>
  `;
}

function renderStyles(page: Extract<AdminConsolePage, { slug: "styles" }>): string {
  return `
    <article class="ds-card">
      <div class="card-head">
        <h2>Published Style Registries</h2>
        <p>List of globally registered style JSON documents. Click a style to view historical versions and draft promotions.</p>
      </div>
      <table class="ds-table" style="margin-top: 16px;">
        <thead>
          <tr>
            <th>Style ID</th>
            <th>Name</th>
            <th>Published Version ID</th>
            <th>Style JSON URL</th>
            <th style="text-align: right;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${page.styles.length === 0 ? `
            <tr><td colspan="5" style="text-align: center; color: var(--muted); padding: 24px;">No published styles registered on this platform.</td></tr>
          ` : page.styles.map((style) => `
            <tr>
              <td><code>${escapeHtml(style.id)}</code></td>
              <td><strong>${escapeHtml(style.name)}</strong></td>
              <td><code>${escapeHtml(style.publishedVersionId || "Draft only")}</code></td>
              <td><a href="/v1/styles/${escapeHtml(style.id)}/style.json" target="_blank" class="subtle-text" style="text-decoration: underline;">Open style.json</a></td>
              <td style="text-align: right;">
                <span class="chip success">Active</span>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function renderProjects(page: Extract<AdminConsolePage, { slug: "projects" }>): string {
  return `
    <article class="ds-card">
      <div class="card-head split">
        <div>
          <h2>Customer Projects Registry</h2>
          <p>List of all created customer workspaces projects and API key configurations.</p>
        </div>
        <div style="display: flex; gap: 8px;">
          <input class="search-input" type="text" placeholder="Search project ID..." data-project-search style="padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line);" />
        </div>
      </div>
      <table class="ds-table" style="margin-top: 16px;" data-projects-table>
        <thead>
          <tr>
            <th>Project ID</th>
            <th>Name</th>
            <th>Workspace ID</th>
            <th>Billing Plan</th>
            <th>Allowed Origins</th>
            <th style="text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${page.projects.length === 0 ? `
            <tr><td colspan="6" style="text-align: center; color: var(--muted); padding: 24px;">No customer projects found in the registry.</td></tr>
          ` : page.projects.map((proj) => `
            <tr data-project-row="${escapeHtml(proj.id)}">
              <td><code>${escapeHtml(proj.id)}</code></td>
              <td><strong>${escapeHtml(proj.name)}</strong></td>
              <td><code>${escapeHtml(proj.workspaceId)}</code></td>
              <td><span class="chip">${escapeHtml(proj.planId)}</span></td>
              <td style="max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${(proj.policy.allowedOrigins || []).join(", ") || "* (Any Origin)"}</td>
              <td style="text-align: right;">
                <a class="ds-button ds-button-secondary ds-button-sm" href="/ops/projects/${encodeURIComponent(proj.id)}">Inspect</a>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function renderProjectDetail(page: Extract<AdminConsolePage, { slug: "project-detail" }>): string {
  const p = page.project;
  return `
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>Project Metadata</h2>
          <p>Read-only identity profiles for project ID: ${escapeHtml(p.id)}</p>
        </div>
        <div class="stack" style="margin-top: 16px; gap: 14px;">
          <div>
            <span class="subtle-text">Project ID</span>
            <code style="display: block; margin-top: 4px;">${escapeHtml(p.id)}</code>
          </div>
          <div>
            <span class="subtle-text">Project Name</span>
            <strong style="display: block; margin-top: 4px;">${escapeHtml(p.name)}</strong>
          </div>
          <div>
            <span class="subtle-text">Workspace ID</span>
            <code style="display: block; margin-top: 4px;">${escapeHtml(p.workspaceId)}</code>
          </div>
          <div>
            <span class="subtle-text">Billing plan ID</span>
            <span class="chip" style="margin-top: 4px; display: inline-block;">${escapeHtml(p.planId)}</span>
          </div>
          <div>
            <span class="subtle-text">Allowed Origins</span>
             <p style="font-size: 13px; margin: 4px 0 0 0;">${(p.policy.allowedOrigins || []).join(", ") || "* (Any Origin)"}</p>
          </div>
          
          <div style="border-top: 1px solid var(--line); padding-top: 16px; margin-top: 16px;">
            ${page.workspaceOwner ? `
              <div>
                <strong>Workspace Owner Contact</strong>
                <p style="font-size: 13px; margin: 6px 0 0 0;">Name: ${escapeHtml(page.workspaceOwner.name)}</p>
                <p style="font-size: 13px; margin: 4px 0 0 0;">Email: ${escapeHtml(page.workspaceOwner.email)}</p>
                <p style="font-size: 13px; margin: 4px 0 0 0;">User ID: ${escapeHtml(page.workspaceOwner.id)}</p>
              </div>
            ` : `
              <form method="GET" action="/ops/projects/${escapeHtml(p.id)}">
                <input name="showOwnerPii" type="hidden" value="true" />
                <button class="ds-button ds-button-secondary ds-button-sm" type="submit">Show owner contact</button>
              </form>
            `}
          </div>
        </div>
      </article>

      <div class="stack" style="gap: 24px;">
        <article class="ds-card">
          <div class="card-head">
            <h2>Hashed API Keys</h2>
            <p>Operator view showing truncated key identifiers. Operators can force rotate keys.</p>
          </div>
          <table class="ds-table" style="margin-top: 16px;">
            <thead>
              <tr>
                <th>Key ID</th>
                <th>Hash Prefix</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              ${page.keys.map((k) => `
                <tr>
                  <td><code>${escapeHtml(k.id)}</code></td>
                  <td><code>${escapeHtml(k.tokenHash)}...</code></td>
                  <td>${formatDate(k.createdAt)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <div class="card-actions" style="margin-top: 16px;">
            <button class="ds-button ds-button-danger ds-button-ghost ds-button-sm" data-modal-trigger="rotate-key" type="button">Force Key Rotation</button>
          </div>
        </article>

        <article class="ds-card">
          <div class="card-head">
            <h2>Project Quota Usage</h2>
            <p>Monthly request count mirrored from persistent metrics storage.</p>
          </div>
          <section class="ds-stat-grid" style="grid-template-columns: repeat(3, 1fr); display: grid; gap: 12px; margin-top: 16px;">
            <div style="background: rgba(0,0,0,0.02); padding: 12px; border-radius: 8px; border: 1px solid var(--line);">
              <span class="subtle-text" style="font-size: 11px;">Tiles</span>
              <strong style="font-size: 18px; display: block; margin-top: 4px;">${page.usage.tiles.toLocaleString()}</strong>
            </div>
            <div style="background: rgba(0,0,0,0.02); padding: 12px; border-radius: 8px; border: 1px solid var(--line);">
              <span class="subtle-text" style="font-size: 11px;">Raster</span>
              <strong style="font-size: 18px; display: block; margin-top: 4px;">${page.usage.raster.toLocaleString()}</strong>
            </div>
            <div style="background: rgba(0,0,0,0.02); padding: 12px; border-radius: 8px; border: 1px solid var(--line);">
              <span class="subtle-text" style="font-size: 11px;">Static</span>
              <strong style="font-size: 18px; display: block; margin-top: 4px;">${page.usage.static.toLocaleString()}</strong>
            </div>
          </section>
        </article>
      </div>
    </section>

    <!-- Key Reveal Success card container -->
    <div id="key-rotation-result" style="margin-top: 24px;"></div>
  `;
}

function renderAudit(page: Extract<AdminConsolePage, { slug: "audit" }>): string {
  return `
    <article class="ds-card" style="margin-bottom: 24px;">
      <div class="card-head">
        <h2>Filters</h2>
      </div>
      <form class="filters-form" method="GET" action="/ops/audit" style="display: flex; gap: 16px; margin-top: 12px;">
        <label class="field" style="flex: 1;">
          <span>Event Type</span>
          <input name="eventType" type="text" placeholder="e.g. OPERATOR_SIGNED_IN" value="${escapeHtml(page.filters.eventType)}" />
        </label>
        <label class="field" style="flex: 1;">
          <span>Actor</span>
          <input name="actor" type="text" placeholder="e.g. admin@example.com" value="${escapeHtml(page.filters.actor)}" />
        </label>
        <label class="field" style="flex: 1;">
          <span>Outcome</span>
          <input name="outcome" type="text" placeholder="e.g. success" value="${escapeHtml(page.filters.outcome)}" />
        </label>
        <div style="display: flex; align-items: flex-end;">
          <button class="ds-button ds-button-primary" type="submit" style="padding: 10px 24px; border-radius: 12px;">Apply filters</button>
        </div>
      </form>
    </article>

    <article class="ds-card">
      <div class="card-head">
        <h2>Audit Log</h2>
        <p>Comprehensive administrative audit trail.</p>
      </div>
      <table class="ds-table" style="margin-top: 16px;">
        <thead>
          <tr>
            <th>Event ID</th>
            <th>Actor</th>
            <th>Operation</th>
            <th>Outcome</th>
            <th>Date & Time</th>
            <th>Detail Message</th>
          </tr>
        </thead>
        <tbody>
          ${page.events.length === 0 ? `
            <tr><td colspan="6" style="text-align: center; color: var(--muted); padding: 24px;">No audit events match filters.</td></tr>
          ` : page.events.map((e) => `
            <tr>
              <td><code>${escapeHtml(e.id)}</code></td>
              <td><strong>${escapeHtml(e.actor)}</strong></td>
              <td><span class="chip">${escapeHtml(e.operation)}</span></td>
               <td><span class="chip ${e.outcome === "ok" ? "success" : "danger"}">${escapeHtml(e.outcome)}</span></td>
              <td>${formatDate(e.startedAt)}</td>
              <td style="max-width: 320px; font-size: 13px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(e.message)}">${escapeHtml(e.message)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function renderJobs(page: Extract<AdminConsolePage, { slug: "jobs" }>): string {
  return `
    <article class="ds-card" style="margin-bottom: 24px;">
      <div class="card-head">
        <h2>Filters</h2>
      </div>
      <form class="filters-form" method="GET" action="/ops/jobs" style="display: flex; gap: 16px; margin-top: 12px;">
        <label class="field" style="flex: 1;">
          <span>Status</span>
          <input name="status" type="text" placeholder="e.g. running" value="${escapeHtml(page.filters.status)}" />
        </label>
        <label class="field" style="flex: 1;">
          <span>Actor</span>
          <input name="actor" type="text" placeholder="e.g. admin:..." value="${escapeHtml(page.filters.actor)}" />
        </label>
        <div style="display: flex; align-items: flex-end;">
          <button class="ds-button ds-button-primary" type="submit" style="padding: 10px 24px; border-radius: 12px;">Apply filters</button>
        </div>
      </form>
    </article>

    <article class="ds-card">
      <div class="card-head">
        <h2>OSM Ingest Job Log</h2>
        <p>Historic job execution logs.</p>
      </div>
      <table class="ds-table" style="margin-top: 16px;">
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Snapshot</th>
            <th>Status</th>
            <th>Outcome</th>
            <th>Actor</th>
            <th>Started At</th>
          </tr>
        </thead>
        <tbody>
          ${page.jobs.length === 0 ? `
            <tr><td colspan="6" style="text-align: center; color: var(--muted); padding: 24px;">No ingest jobs match filters.</td></tr>
          ` : page.jobs.map((j) => `
            <tr>
              <td><code>${escapeHtml(j.jobId)}</code></td>
              <td><code>${escapeHtml(j.snapshotId)}</code></td>
               <td><span class="chip ${j.status === "started" ? "warn" : "" }">${escapeHtml(j.status)}</span></td>
               <td><span class="chip ${j.outcome === "ok" ? "success" : j.outcome === "failed" ? "danger" : "" }">${escapeHtml(j.outcome || "Pending")}</span></td>
              <td>${escapeHtml(j.actor)}</td>
              <td>${formatDate(j.startedAt)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </article>
  `;
}

function renderAbuse(page: Extract<AdminConsolePage, { slug: "abuse" }>): string {
  return `
    <section class="two-column">
      <div class="stack" style="gap: 24px;">
        <article class="ds-card">
          <div class="card-head">
            <h2>Issue Abuse Warning</h2>
            <p>Send an operator-approved warning email to workspace owners for quota pressure, suspicious traffic, or policy violations.</p>
          </div>
          <form class="stack" data-abuse-warn-form data-abuse-endpoint="/ops/abuse/warn" style="margin-top: 16px;">
            <label class="field">
              <span>Workspace ID</span>
              <input name="workspaceId" type="text" placeholder="ws-..." required autocomplete="off" />
            </label>
            <label class="field">
              <span>Warning Title / Subject</span>
              <input name="subject" type="text" placeholder="Workspace usage review required" required autocomplete="off" />
            </label>
            <label class="field">
              <span>Warning Message (Markdown allowed)</span>
              <textarea name="message" placeholder="Your workspace is approaching the monthly request allowance. Review usage and billing to avoid delivery errors." required style="height: 120px; padding: 10px; border-radius: 12px; border: 1px solid var(--line); font-family: inherit; font-size: 13px;"></textarea>
            </label>
            <label class="field">
              <span>Confirmation Reason (Required, ≥ 8 chars)</span>
              <input name="reason" type="text" placeholder="Operator warning for quota pressure" required autocomplete="off" />
            </label>
            <div class="card-actions">
              <button class="ds-button ds-button-primary" type="submit">Issue warning email now</button>
              <p class="subtle-text" data-abuse-warn-status></p>
            </div>
          </form>
        </article>

        <article class="ds-card" style="border-color: var(--danger); box-shadow: 0 10px 20px rgba(220, 38, 38, 0.05);">
          <div class="card-head">
            <h2 style="color: var(--danger);">Suspend Workspace</h2>
            <p>Soft-disable a workspace, revoke member sessions, and show the suspension reason during the next sign-in attempt.</p>
          </div>
          <form class="stack" data-abuse-suspend-form data-abuse-endpoint="/ops/abuse/suspend" style="margin-top: 16px;">
            <label class="field">
              <span>Workspace ID</span>
              <input name="workspaceId" type="text" placeholder="ws-..." required autocomplete="off" />
            </label>
            <label class="field">
              <span>Suspension Reason</span>
              <textarea name="suspendReason" placeholder="Workspace suspended pending policy review." required style="height: 80px; padding: 10px; border-radius: 12px; border: 1px solid var(--line); font-family: inherit; font-size: 13px;"></textarea>
            </label>
            <label class="field">
              <span>Confirmation Reason (Required, ≥ 8 chars)</span>
              <input name="reason" type="text" placeholder="Operator suspension after policy review" required autocomplete="off" />
            </label>
            <div class="card-actions">
              <button class="ds-button ds-button-danger" type="submit">Suspend workspace now</button>
              <p class="subtle-text" data-abuse-suspend-status></p>
            </div>
          </form>
        </article>
      </div>

      <article class="ds-card">
        <div class="card-head">
          <h2>Currently Suspended Workspaces</h2>
          <p>Active enforcement list. Suspended workspaces block all member sign-ins and tile API range requests.</p>
        </div>
        <div class="stack compact" style="margin-top: 16px;">
          ${page.suspendedWorkspaces.length === 0 ? `
            <p style="text-align: center; color: var(--muted); padding: 24px;">No suspended workspaces currently.</p>
          ` : page.suspendedWorkspaces.map((ws) => `
            <div class="list-row" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line);">
              <div style="max-width: 70%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <strong>${escapeHtml(ws.name)}</strong>
                <span style="display: block; font-size: 11px; color: var(--danger); margin-top: 2px;">Reason: ${escapeHtml(ws.suspendedReason || "No reason given")}</span>
                <span style="display: block; font-size: 12px; color: var(--muted); margin-top: 4px;">ID: ${escapeHtml(ws.id)} · Owner: ${escapeHtml(ws.ownerEmail || "N/A")}</span>
              </div>
              <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
                <span class="chip danger">Suspended</span>
                <button class="ds-button ds-button-secondary ds-button-sm" data-unsuspend-btn="${escapeHtml(ws.id)}" data-unsuspend-endpoint="/ops/abuse/unsuspend" type="button">Unsuspend</button>
              </div>
            </div>
          `).join("")}
        </div>
      </article>
    </section>
  `;
}

function renderOperators(page: Extract<AdminConsolePage, { slug: "operators" }>): string {
  return `
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>Grant Operator Role</h2>
          <p>Add a new system operator. Target email must already have a customer account, otherwise they will be granted operator status upon accepting an invitation.</p>
        </div>
        <form class="stack" data-operator-grant-form data-operator-endpoint="/ops/operators/grant" style="margin-top: 16px;">
          <label class="field">
            <span>Operator Email Address</span>
            <input name="email" type="email" placeholder="colleague@tstiles.com" required autocomplete="off" />
          </label>
          <label class="field">
            <span>Confirmation Reason (Required, ≥ 8 chars)</span>
            <input name="reason" type="text" placeholder="Adding support operator lead" required autocomplete="off" />
          </label>
          <div class="card-actions">
            <button class="ds-button ds-button-primary" type="submit">Grant operator role now</button>
            <p class="subtle-text" data-operator-grant-status></p>
          </div>
        </form>
      </article>

      <article class="ds-card">
        <div class="card-head">
          <h2>Active System Operators</h2>
          <p>Currently authorized operator credentials.</p>
        </div>
        <div class="stack compact" style="margin-top: 16px;">
          ${page.operators.map((op) => `
            <div class="list-row" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line);">
              <div>
                <strong>${escapeHtml(op.name)}</strong>
                <span style="display: block; font-size: 11px; color: var(--muted); margin-top: 2px;">Email: ${escapeHtml(op.email)}</span>
                <span style="display: block; font-size: 11px; color: var(--muted); margin-top: 2px;">Granted: ${formatDate(op.roleOperatorGrantedAt)}</span>
              </div>
              <div style="text-align: right; display: flex; align-items: center; gap: 12px;">
                <span class="chip ${op.mfaEnabled ? "success" : "warn"}">${op.mfaEnabled ? "MFA Active" : "No MFA"}</span>
                ${op.id !== page.shell.currentUser.id ? `
                  <button class="ds-button ds-button-danger ds-button-ghost ds-button-sm" data-operator-revoke-btn="${escapeHtml(op.id)}" data-operator-revoke-endpoint="/ops/operators/revoke" type="button">Revoke</button>
                ` : `
                  <span class="chip">Self</span>
                `}
              </div>
            </div>
          `).join("")}
        </div>
      </article>
    </section>
  `;
}

function renderPageContent(page: AdminConsolePage): string {
  switch (page.slug) {
    case "overview":
      return renderOverview(page);
    case "artifacts":
      return renderArtifacts(page);
    case "ingest":
      return renderIngest(page);
    case "styles":
      return renderStyles(page);
    case "projects":
      return renderProjects(page);
    case "project-detail":
      return renderProjectDetail(page);
    case "audit":
      return renderAudit(page);
    case "jobs":
      return renderJobs(page);
    case "abuse":
      return renderAbuse(page);
    case "operators":
      return renderOperators(page);
  }
}

function renderClientScript(): string {
  return `
    <script>
      (function () {
        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        async function parseJson(response) {
          const text = await response.text();
          if (!text) return {};
          try {
            return JSON.parse(text);
          } catch (_error) {
            return {};
          }
        }

        async function requestJson(url, init) {
          try {
            const response = await fetch(url, init);
            return {
              ok: response.ok,
              data: await parseJson(response)
            };
          } catch (_error) {
            return { ok: false, data: null };
          }
        }

        async function copyText(value) {
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(value);
              return true;
            }
          } catch (_error) {}
          const input = document.createElement("textarea");
          input.value = value;
          document.body.appendChild(input);
          input.select();
          const copied = document.execCommand("copy");
          document.body.removeChild(input);
          return copied;
        }

        function setStatus(node, value, isError) {
          if (!node) return;
          node.textContent = value;
          node.classList.toggle("danger-text", Boolean(isError));
        }

        function provisionMarkup(result) {
          const token = result && result.issuedKey && typeof result.issuedKey.token === "string" ? result.issuedKey.token : "";
          return '' +
            '<article class="ds-card focus-card" style="border-color: var(--blue); margin-top: 24px;" data-provision-result-card>' +
              '<div class="card-head split"><div><h3>Handoff token ready</h3><p>This token is shown once and will not be shown again. Copy it now, and communicate it securely to the customer workspace owners.</p></div><button class="ds-button ds-button-secondary" type="button" data-dismiss-provision>Dismiss</button></div>' +
              '<div class="token-card" style="display: flex; align-items: center; justify-content: space-between; gap: 16px; background: rgba(0,0,0,0.02); padding: 16px; border-radius: 12px; border: 1px solid var(--line); margin-top: 16px;"><span>New key token</span><code>' + escapeHtml(token) + '</code><button class="ds-button ds-button-secondary" type="button" data-copy-value="' + escapeHtml(token) + '">Copy token</button></div>' +
            '</article>';
        }

        function bindCopyValueButtons(root) {
          Array.prototype.forEach.call(root.querySelectorAll("[data-copy-value]"), function (button) {
            if (button.getAttribute("data-copy-bound") === "true") return;
            button.setAttribute("data-copy-bound", "true");
            button.addEventListener("click", async function () {
              const value = button.getAttribute("data-copy-value") || "";
              const previous = button.textContent;
              const copied = await copyText(value);
              button.textContent = copied ? "Copied" : "Copy failed";
              window.setTimeout(function () {
                button.textContent = previous || "Copy";
              }, 1200);
            });
          });
        }

        function bindProvisionResultCards(root) {
          Array.prototype.forEach.call(root.querySelectorAll("[data-provision-result-card]"), function (card) {
            const dismissButton = card.querySelector("[data-dismiss-provision]");
            if (!dismissButton || dismissButton.getAttribute("data-dismiss-bound") === "true") return;
            dismissButton.setAttribute("data-dismiss-bound", "true");
            dismissButton.addEventListener("click", function () {
              card.remove();
            });
          });
        }

        bindCopyValueButtons(document);
        bindProvisionResultCards(document);

        // Confirmation modals with reason capture
        const confirmDialog = document.querySelector("[data-confirm-dialog]");
        const confirmTitle = confirmDialog ? confirmDialog.querySelector("[data-confirm-title]") : null;
        const confirmText = confirmDialog ? confirmDialog.querySelector("[data-confirm-text]") : null;
        const confirmForm = confirmDialog ? confirmDialog.querySelector("[data-confirm-form]") : null;
        const confirmCancel = confirmDialog ? confirmDialog.querySelector("[data-confirm-cancel]") : null;
        const confirmClose = confirmDialog ? confirmDialog.querySelector("[data-confirm-close]") : null;
        const confirmStatus = confirmDialog ? confirmDialog.querySelector("[data-confirm-status]") : null;
        
        let pendingAction = null;

        function closeConfirmDialog() {
          pendingAction = null;
          if (!confirmDialog) return;
          confirmDialog.setAttribute("hidden", "hidden");
          confirmDialog.setAttribute("aria-hidden", "true");
          document.body.classList.remove("modal-open");
          if (confirmStatus) confirmStatus.textContent = "";
          if (confirmForm) confirmForm.reset();
        }

        function openConfirmDialog(title, text, endpoint, method, payload = {}, callback = null) {
          pendingAction = { endpoint, method, payload, callback };
          if (!confirmDialog) return;
          if (confirmTitle) confirmTitle.textContent = title;
          if (confirmText) confirmText.textContent = text;
          confirmDialog.removeAttribute("hidden");
          confirmDialog.setAttribute("aria-hidden", "false");
          document.body.classList.add("modal-open");
        }

        if (confirmCancel) confirmCancel.addEventListener("click", closeConfirmDialog);
        if (confirmClose) confirmClose.addEventListener("click", closeConfirmDialog);
        if (confirmDialog) {
          confirmDialog.addEventListener("click", function (event) {
            if (event.target === confirmDialog) closeConfirmDialog();
          });
        }
        document.addEventListener("keydown", function (event) {
          if (event.key === "Escape") closeConfirmDialog();
        });

        if (confirmForm) {
          confirmForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            if (!pendingAction) return;
            const reasonInput = confirmForm.querySelector('input[name="reason"]');
            const reason = reasonInput ? reasonInput.value.trim() : "";
            if (reason.length < 8) {
              setStatus(confirmStatus, "Action reason must be at least 8 characters long.", true);
              return;
            }

            setStatus(confirmStatus, "Executing operator action...", false);
            const fullPayload = { ...pendingAction.payload, reason };
            
            const result = await requestJson(pendingAction.endpoint, {
              method: pendingAction.method,
              headers: { "content-type": "application/json" },
              body: JSON.stringify(fullPayload)
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(confirmStatus, data && data.error ? String(data.error) : "Action failed", true);
              return;
            }

            if (pendingAction.callback) {
              pendingAction.callback(data);
            } else {
              window.location.reload();
            }
            closeConfirmDialog();
          });
        }

        // Action Bindings: Promote Artifact
        Array.prototype.forEach.call(document.querySelectorAll("[data-modal-trigger]"), function (btn) {
          const action = btn.getAttribute("data-modal-trigger");
          if (action.indexOf("promote-") === 0) {
            const versionId = action.slice(8);
            btn.addEventListener("click", function () {
              openConfirmDialog(
                "Promote PMTiles Artifact",
                "Promoting version " + versionId + " to active will immediately reroute all tileserver traffic.",
                "/ops/artifacts/" + encodeURIComponent(versionId) + "/promote",
                "POST"
              );
            });
          }
          if (action === "promote-latest") {
            btn.addEventListener("click", function () {
              openConfirmDialog(
                "Promote Latest Artifact",
                "Reroute global customer tiles request pipelines to use the newly ingested artifact version.",
                "/ops/artifacts/promote-latest",
                "POST"
              );
            });
          }
          if (action === "rollback") {
            btn.addEventListener("click", function () {
              openConfirmDialog(
                "Rollback Active Artifact",
                "Rollback will route delivery to the previously promoted artifact version.",
                "/ops/artifacts/rollback",
                "POST"
              );
            });
          }
          if (action === "rotate-key") {
            const projectId = window.location.pathname.split("/").pop() || "";
            btn.addEventListener("click", function () {
              openConfirmDialog(
                "Force Rotate project API key",
                "Revoking customer token " + projectId + " immediately triggers offline status. Communicate new keys securely.",
                "/ops/projects/" + encodeURIComponent(projectId) + "/keys/rotate",
                "POST",
                {},
                function (data) {
                  const targetNode = document.getElementById("key-rotation-result");
                  if (targetNode) {
                    targetNode.innerHTML = provisionMarkup(data);
                    bindCopyValueButtons(targetNode);
                    bindProvisionResultCards(targetNode);
                  }
                }
              );
            });
          }
        });

        // Search Projects List
        const searchInput = document.querySelector("[data-project-search]");
        const projectsTable = document.querySelector("[data-projects-table]");
        if (searchInput && projectsTable) {
          searchInput.addEventListener("input", function () {
            const query = searchInput.value.trim().toLowerCase();
            const rows = projectsTable.querySelectorAll("tbody tr");
            Array.prototype.forEach.call(rows, function (row) {
              const projectId = row.getAttribute("data-project-row") || "";
              const matches = projectId.toLowerCase().indexOf(query) >= 0;
              row.style.display = matches || query.length === 0 ? "" : "none";
            });
          });
        }

        // Trigger Ingest Form
        const ingestForm = document.querySelector("[data-ingest-trigger-form]");
        if (ingestForm) {
          ingestForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = ingestForm.getAttribute("data-ingest-endpoint") || "";
            const statusNode = ingestForm.querySelector("[data-ingest-status]");
            setStatus(statusNode, "Triggering OSM Ingest Pipeline...", false);
            
            const snapshotNode = ingestForm.querySelector('input[name="snapshotId"]');
            const sourceUrlNode = ingestForm.querySelector('input[name="sourceUrl"]');
            const expectedChecksumNode = ingestForm.querySelector('input[name="expectedChecksum"]');
            const reasonNode = ingestForm.querySelector('input[name="reason"]');
            
            const payload = {
              snapshotId: snapshotNode ? snapshotNode.value.trim() : "",
              sourceUrl: sourceUrlNode ? sourceUrlNode.value.trim() : "",
              expectedChecksum: expectedChecksumNode ? expectedChecksumNode.value.trim() : "",
              reason: reasonNode ? reasonNode.value.trim() : ""
            };
            
            if (payload.reason.length < 8) {
              setStatus(statusNode, "Confirmation reason must be at least 8 characters long.", true);
              return;
            }

            const result = await requestJson(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Ingest launch failed", true);
              return;
            }
            setStatus(statusNode, "OSM Ingest launched successfully! Reloading...", false);
            window.setTimeout(function () { window.location.reload(); }, 1200);
          });
        }

        // Issue Abuse Warning Form
        const abuseWarnForm = document.querySelector("[data-abuse-warn-form]");
        if (abuseWarnForm) {
          abuseWarnForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = abuseWarnForm.getAttribute("data-abuse-endpoint") || "";
            const statusNode = abuseWarnForm.querySelector("[data-abuse-warn-status]");
            setStatus(statusNode, "Dispatching warning notification...", false);
            
            const wsNode = abuseWarnForm.querySelector('input[name="workspaceId"]');
            const subjectNode = abuseWarnForm.querySelector('input[name="subject"]');
            const msgNode = abuseWarnForm.querySelector('textarea[name="message"]');
            const reasonNode = abuseWarnForm.querySelector('input[name="reason"]');
            
            const payload = {
              workspaceId: wsNode ? wsNode.value.trim() : "",
              subject: subjectNode ? subjectNode.value.trim() : "",
              message: msgNode ? msgNode.value.trim() : "",
              reason: reasonNode ? reasonNode.value.trim() : ""
            };
            
            if (payload.reason.length < 8) {
              setStatus(statusNode, "Confirmation reason must be at least 8 characters long.", true);
              return;
            }

            const result = await requestJson(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Warning failed to send", true);
              return;
            }
            setStatus(statusNode, "Abuse warning notification successfully dispatched.", false);
            abuseWarnForm.reset();
          });
        }

        // Suspend Workspace Form
        const abuseSuspendForm = document.querySelector("[data-abuse-suspend-form]");
        if (abuseSuspendForm) {
          abuseSuspendForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = abuseSuspendForm.getAttribute("data-abuse-endpoint") || "";
            const statusNode = abuseSuspendForm.querySelector("[data-abuse-suspend-status]");
            setStatus(statusNode, "Enforcing workspace suspension...", false);
            
            const wsNode = abuseSuspendForm.querySelector('input[name="workspaceId"]');
            const reasonNode = abuseSuspendForm.querySelector('textarea[name="suspendReason"]');
            const confReasonNode = abuseSuspendForm.querySelector('input[name="reason"]');
            
            const payload = {
              workspaceId: wsNode ? wsNode.value.trim() : "",
              suspendReason: reasonNode ? reasonNode.value.trim() : "",
              reason: confReasonNode ? confReasonNode.value.trim() : ""
            };

            if (payload.reason.length < 8) {
              setStatus(statusNode, "Confirmation reason must be at least 8 characters long.", true);
              return;
            }

            const result = await requestJson(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Suspension failed", true);
              return;
            }
            setStatus(statusNode, "Workspace successfully suspended. Reloading list...", false);
            window.setTimeout(function () { window.location.reload(); }, 1200);
          });
        }

        // Unsuspend workspace buttons
        Array.prototype.forEach.call(document.querySelectorAll("[data-unsuspend-btn]"), function (btn) {
          btn.addEventListener("click", function () {
            const wsId = btn.getAttribute("data-unsuspend-btn");
            const endpoint = btn.getAttribute("data-unsuspend-endpoint");
            openConfirmDialog(
              "Unsuspend Workspace",
              "Restoring workspace " + wsId + " will immediately enable token range queries and workspace member sign-ins.",
              endpoint,
              "POST",
              { workspaceId: wsId }
            );
          });
        });

        // Grant Operator Role Form
        const opGrantForm = document.querySelector("[data-operator-grant-form]");
        if (opGrantForm) {
          opGrantForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = opGrantForm.getAttribute("data-operator-endpoint") || "";
            const statusNode = opGrantForm.querySelector("[data-operator-grant-status]");
            setStatus(statusNode, "Granting operators role...", false);
            
            const emailNode = opGrantForm.querySelector('input[name="email"]');
            const reasonNode = opGrantForm.querySelector('input[name="reason"]');
            
            const payload = {
              email: emailNode ? emailNode.value.trim() : "",
              reason: reasonNode ? reasonNode.value.trim() : ""
            };

            if (payload.reason.length < 8) {
              setStatus(statusNode, "Confirmation reason must be at least 8 characters long.", true);
              return;
            }

            const result = await requestJson(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Grant failed", true);
              return;
            }
            setStatus(statusNode, "Operator role successfully granted! Reloading...", false);
            window.setTimeout(function () { window.location.reload(); }, 1200);
          });
        }

        // Revoke Operator Role buttons
        Array.prototype.forEach.call(document.querySelectorAll("[data-operator-revoke-btn]"), function (btn) {
          btn.addEventListener("click", function () {
            const opId = btn.getAttribute("data-operator-revoke-btn");
            const endpoint = btn.getAttribute("data-operator-revoke-endpoint");
            openConfirmDialog(
              "Revoke System Operator Role",
              "Removing operator role from " + opId + " immediately terminates all operator console sessions.",
              endpoint,
              "POST",
              { userId: opId }
            );
          });
        });
      })();
    </script>
  `;
}

export function renderAdminConsoleHtml(page: AdminConsolePage): string {
  const shell = page.shell;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)} | Operator Console</title>
  <style>
    ${getGlobalCss()}
    :root {
      --panel: var(--surface);
      --panel-strong: var(--bg);
      --danger: var(--danger);
      --sidebar: var(--surface);
      --sidebar-ink: var(--ink-2);
      --blue: var(--accent);
    }
    body.modal-open { overflow: hidden; }
    a { color: inherit; }
    .app-shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
    }
    .sidebar {
      padding: 28px 24px;
      background: var(--sidebar);
      color: var(--sidebar-ink);
      position: sticky;
      top: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      gap: 28px;
      border-right: 1px solid var(--border);
    }
    .brand {
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-weight: 800;
      font-size: 13px;
      color: var(--ink);
    }
    .brand span {
      background: var(--blue);
      color: var(--accent-fg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      margin-left: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .sidebar p,
    .sidebar a {
      color: var(--muted);
      text-decoration: none;
    }
    .nav {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex-grow: 1;
    }
    .nav-item {
      padding: 10px 14px;
      border-radius: var(--rad-2);
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      transition: background var(--motion-fast), color var(--motion-fast);
      color: var(--ink-2);
    }
    .nav-item:hover {
      background: var(--surface-2);
      color: var(--ink);
    }
    .nav-item.active {
      background: rgba(79, 70, 229, 0.08);
      color: var(--accent);
      font-weight: 600;
    }
    .main-surface {
      background: var(--bg);
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    .top-bar {
      height: 64px;
      border-bottom: 1px solid var(--border);
      background: var(--panel-strong);
      padding: 0 40px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .health-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 500;
    }
    .health-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .health-dot.green { background: var(--success); }
    .health-dot.red { background: var(--danger); }
    .content-area {
      flex-grow: 1;
      padding: 40px;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
    }
    .page-title-block {
      margin-bottom: 32px;
    }
    .page-title-block h1 {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0 0 8px 0;
    }
    .page-title-block p {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
    }
    .ds-card {
      border: 1px solid var(--border);
      border-radius: var(--rad-3);
      background: var(--panel-strong);
      padding: 24px;
      position: relative;
    }
    .ds-card.focus-card {
      background: var(--panel);
      border-color: var(--border);
    }
    .card-head {
      margin-bottom: 16px;
    }
    .card-head.split {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .card-head h2 { font-size: 18px; margin: 0 0 4px 0; font-weight: 600; }
    .card-head h3 { font-size: 16px; margin: 0 0 4px 0; font-weight: 600; }
    .card-head p { margin: 0; color: var(--muted); font-size: 13px; }
    .ds-stat-grid {
      display: grid;
      gap: 16px;
    }
    .subtle-text {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stack {
      display: flex;
      flex-direction: column;
    }
    .stack.compact { gap: 8px; }
    .stack.loose { gap: 24px; }
    .card-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .card-actions.wrap { flex-wrap: wrap; }
    .chip {
      display: inline-block;
      padding: 4px 8px;
      border-radius: var(--rad-1);
      font-size: 11px;
      font-weight: 600;
      background: var(--surface-2);
      color: var(--ink-2);
      border: 1px solid var(--border);
    }
    .chip.success { background: rgba(22, 163, 74, 0.08); color: var(--success); border-color: rgba(22, 163, 74, 0.2); }
    .chip.danger { background: rgba(220, 38, 38, 0.08); color: var(--danger); border-color: rgba(220, 38, 38, 0.2); }
    .chip.warn { background: rgba(217, 119, 6, 0.08); color: var(--warn); border-color: rgba(217, 119, 6, 0.2); }
    .two-column {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 24px;
    }
    @media (max-width: 1024px) {
      .two-column { grid-template-columns: 1fr; }
    }
    .checklist {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .check-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }
    .check-item::before {
      content: "✓";
      color: var(--success);
      font-weight: 700;
    }
    .list-row {
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .list-row:last-child {
      border-bottom: none;
    }
    .modal-shell {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 24px;
    }
    .modal-card {
      background: var(--panel-strong);
      border-radius: 16px;
      border: 1px solid var(--line);
      width: 100%;
      max-width: 520px;
      padding: 32px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.15);
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">TSTiles <span>Ops</span></div>
      <nav class="nav">
        ${shell.navigation.map((n) => `
          <a class="nav-item ${n.active ? "active" : ""}" href="${n.href}">${escapeHtml(n.label)}</a>
        `).join("")}
      </nav>
      <div class="user-block" style="border-top: 1px solid rgba(244, 237, 224, 0.12); padding-top: 16px;">
        <span class="subtle-text" style="color: rgba(244, 237, 224, 0.5);">Signed in as</span>
        <strong style="display: block; font-size: 13px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(shell.currentUser.email)}</strong>
      </div>
    </aside>

    <main class="main-surface">
      <header class="top-bar">
        <div class="health-indicator">
          <span class="health-dot ${shell.health.ok ? "green" : "red"}"></span>
          <span>Core service: ${shell.health.ok ? "Operational" : "Degraded"}</span>
        </div>
        <form method="POST" action="/ops/sign-out">
          <input name="_csrf" type="hidden" value="" />
          <button class="ds-button ds-button-secondary ds-button-sm" type="submit">Sign out</button>
        </form>
      </header>

      <div class="content-area">
        <div class="page-title-block">
          <h1>${escapeHtml(page.title)}</h1>
          <p>${escapeHtml(page.description)}</p>
        </div>

        ${renderPageContent(page)}
      </div>
    </main>
  </div>

  <!-- Shared Action Confirmation Dialog -->
  <div class="modal-shell" data-confirm-dialog aria-hidden="true" hidden>
    <article class="modal-card" role="dialog" aria-modal="true">
      <div class="card-head">
        <h2 data-confirm-title>Confirm Action</h2>
        <p data-confirm-text>Are you sure you want to perform this operation?</p>
      </div>
      <form class="stack" data-confirm-form style="margin-top: 16px;">
        <label class="field">
          <span>Confirmation Reason (Required, ≥ 8 chars)</span>
          <input name="reason" type="text" placeholder="Reason for audit event" required autocomplete="off" />
        </label>
        <div class="modal-actions">
          <button class="ds-button ds-button-secondary" type="button" data-confirm-cancel>Cancel</button>
          <button class="ds-button ds-button-danger" type="submit">Confirm action</button>
        </div>
        <p class="subtle-text" data-confirm-status style="margin-top: 12px;"></p>
      </form>
    </article>
  </div>

  ${renderClientScript()}
</body>
</html>`;
}

export function renderOpsSignInHtml(page: AdminConsoleSignInPage): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)} | TSTiles Ops</title>
  <style>
    ${getGlobalCss()}
    :root {
      --panel: var(--surface);
      --panel-strong: var(--bg);
      --blue: var(--accent);
    }
    main {
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: var(--surface);
      padding: 24px;
    }
    .login-card {
      width: 100%;
      max-width: 440px;
      padding: 40px;
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: var(--rad-3);
      box-shadow: var(--shadow-1);
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    p.sub {
      margin: 0 0 32px 0;
      color: var(--muted);
      font-size: 14px;
    }
    .checklist {
      background: rgba(0, 0, 0, 0.02);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 16px;
      margin-top: 16px;
      font-family: monospace;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <main>
    <article class="login-card">
      <div style="font-weight: 800; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--blue); margin-bottom: 8px;">TSTiles Operator Portal</div>
      <h1>Sign in to Ops</h1>
      <p class="sub">First-party role-gated access. Multi-factor authentication is mandatory.</p>

      <form class="stack" data-login-form>
        <label class="field">
          <span>Operator Email</span>
          <input name="email" type="email" placeholder="admin@tstiles.com" required autocomplete="username" />
        </label>
        <label class="field">
          <span>Password</span>
          <input name="password" type="password" required autocomplete="current-password" />
        </label>
        
        <div data-totp-container style="display: none; margin-top: 16px;">
          <!-- Manual TOTP Secret Reveal -->
          <div data-totp-setup-panel style="display: none; margin-bottom: 16px;">
            <div style="padding: 16px; background: white; border: 1px solid var(--line); border-radius: 12px; text-align: center; margin-bottom: 16px;">
              <span class="subtle-text" style="font-size: 10px;">Enrolling Operator TOTP</span>
              <div data-totp-setup-secret style="font-family: monospace; font-size: 16px; font-weight: 700; letter-spacing: 0.1em; color: var(--blue); margin: 8px 0;"></div>
              <p style="font-size: 11px; color: var(--muted);">Scan code or enter secret manually into your authenticator app.</p>
            </div>
            <div class="checklist">
              <strong style="display: block; margin-bottom: 8px;">Secure recovery codes:</strong>
              <div data-totp-recovery-codes style="grid-template-columns: repeat(2, 1fr); display: grid; gap: 8px;"></div>
              <p style="color: var(--danger); font-weight: 700; margin-top: 8px; font-size: 10px;">⚠️ Store these recovery codes securely. They will not be shown again.</p>
            </div>
          </div>
          <label class="field">
            <span>Verification code</span>
            <input name="totp" type="text" placeholder="123456" autocomplete="one-time-code" />
          </label>
        </div>

        <div class="card-actions" style="margin-top: 24px;">
          <button class="ds-button ds-button-primary" type="submit" style="width: 100%;">Sign in now</button>
        </div>
        <p class="subtle-text" data-login-status style="margin-top: 16px; text-align: center;"></p>
      </form>
    </article>
  </main>

  <script>
    (function () {
      function setStatus(node, value, isError) {
        if (!node) return;
        node.textContent = value;
        node.classList.toggle("danger-text", Boolean(isError));
      }

      async function parseJson(response) {
        const text = await response.text();
        if (!text) return {};
        try {
          return JSON.parse(text);
        } catch (_error) {
          return {};
        }
      }

      async function requestJson(url, init) {
        try {
          const response = await fetch(url, init);
          return {
            ok: response.ok,
            data: await parseJson(response)
          };
        } catch (_error) {
          return { ok: false, data: null };
        }
      }

      const form = document.querySelector("[data-login-form]");
      if (form) {
        form.addEventListener("submit", async function (event) {
          event.preventDefault();
          const statusNode = form.querySelector("[data-login-status]");
          setStatus(statusNode, "Signing in...", false);

          const emailNode = form.querySelector('input[name="email"]');
          const passwordNode = form.querySelector('input[name="password"]');
          const totpNode = form.querySelector('input[name="totp"]');

          const payload = {
            email: emailNode ? emailNode.value.trim() : "",
            password: passwordNode ? passwordNode.value : "",
            totp: totpNode && totpNode.value.trim().length > 0 ? totpNode.value.trim() : undefined
          };

          const result = await requestJson("/ops/sign-in", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
          });
          const data = result.data;
          if (!result.ok) {
            setStatus(statusNode, data && data.error ? String(data.error) : "Invalid email, password, or verification code.", true);
            return;
          }

          if (data && data.mfaRequired) {
            // Unveil verification input container
            const totpContainer = form.querySelector("[data-totp-container]");
            if (totpContainer) totpContainer.style.display = "block";
            
            // Set required validation property
            const totpInput = form.querySelector('input[name="totp"]');
            if (totpInput) totpInput.required = true;

            // Handle MFA setup cards if newly seeded
            if (data.secret) {
              const setupPanel = form.querySelector("[data-totp-setup-panel]");
              const secretNode = form.querySelector("[data-totp-setup-secret]");
              const recoveryNode = form.querySelector("[data-totp-recovery-codes]");
              if (setupPanel) setupPanel.style.display = "block";
              if (secretNode) secretNode.textContent = data.secret;
              if (recoveryNode && data.recoveryCodes) {
                recoveryNode.innerHTML = data.recoveryCodes.map(function (c) {
                  return '<div style="font-weight: 700;">' + String(c) + '</div>';
                }).join("");
              }
              setStatus(statusNode, "MFA Setup required. Please scan the key and enter the verification code.", false);
            } else {
              setStatus(statusNode, "Password correct. Please enter your MFA verification code.", false);
            }
            return;
          }

          setStatus(statusNode, "Signed in successfully. Redirecting...", false);
          window.location.href = "/ops";
        });
      }
    })();
  </script>
</body>
</html>`;
}
