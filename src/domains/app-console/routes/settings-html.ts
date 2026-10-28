import type { AppConsolePage } from "../types";
import { escapeHtml } from "../../design-system/components";

function formatDate(value: string | undefined): string {
  if (!value) {
    return "Pending confirmation";
  }
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderSettingsTabs(active: "workspace" | "members" | "security" | "account"): string {
  return `
    <nav class="settings-tabs ds-tabs" aria-label="Settings">
      <a class="settings-tab-link ${active === "workspace" ? "active" : ""}" href="/app/settings"${active === "workspace" ? ' aria-current="page"' : ""}>Workspace</a>
      <a class="settings-tab-link ${active === "members" ? "active" : ""}" href="/app/settings/members"${active === "members" ? ' aria-current="page"' : ""}>Members</a>
      <a class="settings-tab-link ${active === "security" ? "active" : ""}" href="/app/settings/security"${active === "security" ? ' aria-current="page"' : ""}>Security</a>
      <a class="settings-tab-link ${active === "account" ? "active" : ""}" href="/app/settings/account"${active === "account" ? ' aria-current="page"' : ""}>Account</a>
    </nav>
  `;
}

function renderSettings(page: Extract<AppConsolePage, { slug: "settings" }>): string {
  return `
    ${renderSettingsTabs("workspace")}
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>Workspace settings</h2>
          <p>Change the workspace name shown throughout the console.</p>
        </div>
        <form class="stack" data-settings-form data-settings-endpoint="/app-api/settings">
          <label class="field">
            <span>Workspace name</span>
            <input name="workspaceName" type="text" value="${escapeHtml(page.settings.workspace.name)}" required />
          </label>
          <label class="field">
            <span>Billing contact email</span>
            <input type="text" value="${escapeHtml(page.settings.billingEmail ?? "Not synced yet")}" readonly />
          </label>
          <div class="card-actions">
            <button class="ds-button ds-button-primary" type="submit">Save workspace</button>
            <p class="subtle-text" data-form-status></p>
          </div>
        </form>
      </article>
    </section>
  `;
}

function renderSettingsMembers(page: Extract<AppConsolePage, { slug: "settings-members" }>): string {
  const isOwner = page.shell.currentMembership.role === "owner";
  return `
    ${renderSettingsTabs("members")}
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>Members</h2>
          <p>People who can currently access this workspace.</p>
        </div>
        <div class="stack compact settings-list">
          ${page.settings.memberships.map((membership) => `
            <div class="list-row">
              <div>
                <strong>${escapeHtml(membership.userId)}</strong>
                <span class="row-detail">${escapeHtml(membership.role)}</span>
              </div>
              <div class="row-actions">
                <span class="chip">${escapeHtml(membership.role)}</span>
                ${isOwner && membership.userId !== page.shell.currentUser.id ? `
                  <button class="ds-button ds-button-danger ds-button-sm" aria-label="Remove ${escapeHtml(membership.userId)} from this workspace" data-remove-member-button="${escapeHtml(membership.userId)}" data-remove-member-endpoint="/app-api/memberships/${escapeHtml(membership.userId)}/remove" type="button">Remove</button>
                ` : ""}
              </div>
            </div>
          `).join("")}
        </div>
      </article>
      
      ${isOwner ? `
        <article class="ds-card">
          <div class="card-head">
            <h2>Invite new member</h2>
            <p>Add a new collaborator to this workspace by sending an invitation.</p>
          </div>
          <form class="stack settings-list" data-invite-form data-invite-endpoint="/app-api/memberships/invite">
            <label class="field">
              <span>Email address</span>
              <input name="email" type="email" placeholder="colleague@example.com" required />
            </label>
            <label class="field">
              <span>Role</span>
            <select name="role">
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
            </label>
            <div class="card-actions">
              <button class="ds-button ds-button-primary" type="submit">Send invitation</button>
              <p class="subtle-text" data-invite-status></p>
            </div>
          </form>
        </article>
      ` : ""}
    </section>
  `;
}

function renderSettingsSecurity(page: Extract<AppConsolePage, { slug: "settings-security" }>): string {
  const mfaEnabled = page.shell.currentUser.mfaEnabledAt !== null;
  return `
    ${renderSettingsTabs("security")}
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>Security settings</h2>
          <p>Manage your password and multi-factor authentication.</p>
        </div>
        <div class="stack settings-list">
          <div class="settings-action-row">
            <div>
              <strong>Password</strong>
              <p class="row-detail">Update your account credentials.</p>
            </div>
            <a class="ds-button ds-button-secondary ds-button-sm" href="/app/settings/security/password">Change password</a>
          </div>
          <div class="settings-action-row">
            <div>
              <strong>Multi-factor authentication (MFA)</strong>
              <p class="row-detail">MFA is currently ${mfaEnabled ? "enabled" : "disabled"}.</p>
            </div>
            ${mfaEnabled ? `
              <button class="ds-button ds-button-danger ds-button-ghost ds-button-sm" data-disable-mfa-trigger type="button">Disable MFA</button>
            ` : `
              <a class="ds-button ds-button-secondary ds-button-sm" href="/app/settings/security/mfa">Enroll MFA</a>
            `}
          </div>
        </div>
      </article>

      <article class="ds-card">
        <div class="card-head">
          <h2>Active sessions</h2>
          <p>Browsers and clients currently signed in to your account.</p>
        </div>
        <div class="stack compact settings-list">
          ${page.activeSessions.map((session) => `
            <div class="list-row">
              <div class="session-details">
                <strong>${escapeHtml(session.userAgent || "Unknown browser or client")}</strong>
                <span class="row-detail">Signed in ${formatDate(session.createdAt)} · Last active ${formatDate(session.lastSeenAt)}</span>
              </div>
              <span class="chip chip-live">Active</span>
            </div>
          `).join("")}
        </div>
        <p class="empty-note">Individual session revocation is not available here yet. Sign out to end this browser session. If you do not recognize a device, change your password.</p>
      </article>
    </section>

    <div class="modal-shell" data-disable-mfa-dialog aria-hidden="true" hidden>
      <article class="modal-card" role="dialog" aria-modal="true" aria-labelledby="disable-mfa-title">
        <div class="card-head">
        <h2 id="disable-mfa-title">Disable multi-factor authentication</h2>
        <p>Signing in will no longer require an authenticator code. Enter your password to continue. You can enable MFA again later.</p>
        </div>
        <form class="stack" data-disable-mfa-form data-disable-mfa-endpoint="/app-api/security/mfa/disable">
          <label class="field">
            <span>Password</span>
            <input name="password" type="password" required />
          </label>
          <div class="modal-actions">
            <button class="ds-button ds-button-secondary" type="button" data-disable-mfa-cancel>Cancel</button>
            <button class="ds-button ds-button-danger" type="submit">Disable MFA now</button>
          </div>
          <p class="subtle-text" data-disable-mfa-status></p>
        </form>
      </article>
    </div>
  `;
}

function renderSettingsSecurityMfa(page: Extract<AppConsolePage, { slug: "settings-security-mfa" }>): string {
  void page;
  return `
    ${renderSettingsTabs("security")}
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>TOTP authenticator setup</h2>
          <p>Start setup to create a secret key, then add it to your authenticator app and enter the six-digit code.</p>
        </div>
        <div class="stack" data-mfa-setup>
          <div class="empty-note" data-mfa-setup-intro>
            No MFA secret has been created from this page load. Starting setup creates one and displays its recovery codes once.
          </div>
          <div class="card-actions" data-mfa-start-actions>
            <a class="ds-button ds-button-secondary" href="/app/settings/security">Cancel</a>
            <button class="ds-button ds-button-primary" data-mfa-start data-mfa-enroll-endpoint="/app-api/security/mfa/enroll" type="button">Start MFA setup</button>
          </div>
          <p class="subtle-text" data-mfa-start-status aria-live="polite"></p>
          <div class="token-card" data-mfa-secret-panel hidden>
            <span>Manual entry key</span>
            <code data-mfa-secret></code>
            <button class="ds-button ds-button-secondary" type="button" data-mfa-secret-copy>Copy secret key</button>
          </div>
          <form class="stack" data-mfa-enroll-form data-mfa-enroll-endpoint="/app-api/security/mfa/enroll" hidden>
            <label class="field">
              <span>Verification code</span>
              <input name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
            </label>
            <div class="card-actions">
              <button class="ds-button ds-button-primary" type="submit">Verify and enable MFA</button>
            </div>
            <p class="subtle-text" data-mfa-enroll-status aria-live="polite"></p>
          </form>
        </div>
      </article>

      <article class="ds-card" data-mfa-recovery-panel hidden>
        <div class="card-head">
          <h2>Recovery codes</h2>
          <p>Store these one-time recovery codes in a password manager before enabling MFA. They will not be shown again.</p>
        </div>
        <div class="recovery-code-grid" data-mfa-recovery-codes></div>
        <div class="card-actions">
          <button class="ds-button ds-button-secondary" type="button" data-mfa-recovery-copy>Copy recovery codes</button>
        </div>
      </article>
    </section>
  `;
}

function renderSettingsSecurityPassword(_page: Extract<AppConsolePage, { slug: "settings-security-password" }>): string {
  void _page;
  return `
    ${renderSettingsTabs("security")}
    <section class="content-narrow">
      <article class="ds-card">
        <div class="card-head">
          <h2>Change password</h2>
          <p>Enter your current password, then choose a new password with at least 12 characters, one number, and one special character.</p>
        </div>
        <form class="stack settings-list" data-password-change-form data-password-change-endpoint="/app-api/security/password">
          <label class="field">
            <span>Current password</span>
            <input name="currentPassword" type="password" required />
          </label>
          <label class="field">
            <span>New password</span>
            <input name="newPassword" type="password" required />
          </label>
          <div class="card-actions">
            <a class="ds-button ds-button-secondary" href="/app/settings/security">Cancel</a>
            <button class="ds-button ds-button-primary" type="submit">Update password</button>
            <p class="subtle-text" data-password-change-status></p>
          </div>
        </form>
      </article>
    </section>
  `;
}

function renderSettingsAccount(page: Extract<AppConsolePage, { slug: "settings-account" }>): string {
  return `
    ${renderSettingsTabs("account")}
    <section class="two-column">
      <article class="ds-card">
        <div class="card-head">
          <h2>Workspace details</h2>
          <p>Update the workspace name shown throughout the console.</p>
        </div>
        <form class="stack settings-list" data-settings-form data-settings-endpoint="/app-api/settings">
          <label class="field">
            <span>Workspace name</span>
            <input name="workspaceName" type="text" value="${escapeHtml(page.settings.workspace.name)}" required />
          </label>
          <div class="card-actions">
            <button class="ds-button ds-button-primary" type="submit">Save settings</button>
            <p class="subtle-text" data-form-status></p>
          </div>
        </form>
      </article>

      <article class="ds-card danger-zone">
        <div class="card-head">
          <h2>Workspace data</h2>
          <p>Request an export or schedule the workspace and its map resources for deletion.</p>
        </div>
        <div class="stack settings-list">
          <div class="settings-action-row">
            <div>
              <strong>Export workspace data</strong>
              <p class="row-detail">Receive a JSON export by email. Raw access tokens are excluded.</p>
            </div>
            <a class="ds-button ds-button-secondary ds-button-sm" href="/app/settings/account/export">Export data</a>
          </div>
          <div class="settings-action-row">
            <div>
              <strong class="danger-text">Delete workspace</strong>
              <p class="row-detail">Access ends immediately. The workspace can be restored for 30 days before permanent deletion.</p>
            </div>
            <a class="ds-button ds-button-danger ds-button-ghost ds-button-sm" href="/app/settings/account/delete">Delete workspace</a>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderSettingsAccountExport(_page: Extract<AppConsolePage, { slug: "settings-account-export" }>): string {
  void _page;
  return `
    ${renderSettingsTabs("account")}
    <section class="content-narrow">
      <article class="ds-card">
        <div class="card-head">
          <h2>Export workspace data</h2>
          <p>Request an asynchronous data export. A secure download link will be emailed to your account address when it is ready.</p>
        </div>
        <div class="stack settings-list">
          <div class="checklist">
            <div class="check-item">Exports contain project settings and metadata.</div>
            <div class="check-item">Exports include public, published style JSON documents.</div>
            <div class="check-item">Raw API secret keys are excluded to preserve security.</div>
          </div>
          <div class="card-actions">
            <a class="ds-button ds-button-secondary" href="/app/settings/account">Back</a>
            <button class="ds-button ds-button-primary" data-export-trigger-btn data-export-endpoint="/app-api/workspace/export" type="button">Request export</button>
            <p class="subtle-text" data-export-status></p>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderSettingsAccountDelete(page: Extract<AppConsolePage, { slug: "settings-account-delete" }>): string {
  return `
    ${renderSettingsTabs("account")}
    <section class="content-narrow">
      <article class="ds-card danger-zone">
        <div class="card-head">
          <h2 class="danger-text">Delete workspace</h2>
          <p>This immediately revokes workspace access and schedules permanent deletion in 30 days. During that recovery period, support can restore the workspace and cancel deletion.</p>
        </div>
        <form class="stack settings-list" data-delete-workspace-form data-delete-workspace-endpoint="/app-api/workspace/delete">
          <div class="checklist">
            <div class="check-item">Project access tokens stop working immediately.</div>
            <div class="check-item">Workspace members are signed out immediately.</div>
            <div class="check-item">Permanent deletion occurs after 30 days unless support restores the workspace.</div>
          </div>
          <label class="field">
            <span>Type your email address (<strong class="selectable-text">${escapeHtml(page.shell.currentUser.email)}</strong>) to confirm:</span>
            <input name="confirmEmail" type="text" required placeholder="${escapeHtml(page.shell.currentUser.email)}" autocomplete="off" />
          </label>
          <div class="card-actions">
            <a class="ds-button ds-button-secondary" href="/app/settings/account">Cancel</a>
            <button class="ds-button ds-button-danger" type="submit" disabled data-delete-submit-btn>Schedule workspace deletion</button>
            <p class="subtle-text" data-delete-status></p>
          </div>
        </form>
      </article>
    </section>
  `;
}

function renderNotifications(page: Extract<AppConsolePage, { slug: "notifications" }>): string {
  const notifications = page.notifications;
  if (notifications.length === 0) {
    return `
      <article class="ds-card empty-state">
        <h3>No notifications</h3>
        <p>Workspace events from the last 90 days will appear here.</p>
        <a class="ds-button ds-button-secondary" href="/app">Open overview</a>
      </article>
    `;
  }
  return `
    <section class="stack">
      ${notifications.map((n) => {
        const toneClass = n.type === "danger" ? "banner-danger" : n.type === "warn" ? "banner-warning" : "banner-info";
        return `
          <article class="banner ${toneClass}">
            <div class="stack compact">
              <div class="notification-heading">
                <span class="chip notification-tone">${escapeHtml(n.type)}</span>
                <strong>${escapeHtml(n.title)}</strong>
              </div>
              <p>${escapeHtml(n.message)}</p>
              <span class="row-detail">${formatDate(n.recordedAt)}</span>
            </div>
            ${n.actionHref ? `
              <a class="ds-button ds-button-secondary ds-button-sm" href="${escapeHtml(n.actionHref)}">View</a>
            ` : ""}
          </article>
        `;
      }).join("")}
    </section>
  `;
}


type SettingsPage = Extract<AppConsolePage, {
  slug: "settings"
    | "settings-members"
    | "settings-security"
    | "settings-security-mfa"
    | "settings-security-password"
    | "settings-account"
    | "settings-account-export"
    | "settings-account-delete"
    | "notifications";
}>;

export function renderSettingsPageContent(page: SettingsPage): string {
  switch (page.slug) {
    case "settings":
      return renderSettings(page);
    case "settings-members":
      return renderSettingsMembers(page);
    case "settings-security":
      return renderSettingsSecurity(page);
    case "settings-security-mfa":
      return renderSettingsSecurityMfa(page);
    case "settings-security-password":
      return renderSettingsSecurityPassword(page);
    case "settings-account":
      return renderSettingsAccount(page);
    case "settings-account-export":
      return renderSettingsAccountExport(page);
    case "settings-account-delete":
      return renderSettingsAccountDelete(page);
    case "notifications":
      return renderNotifications(page);
  }
}
