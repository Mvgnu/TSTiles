import { getGlobalCss } from "../../design-system/styles";

/** App-console layout rules layered on the shared design-system tokens and primitives. */
export function getAppConsoleCss(): string {
  return `
    ${getGlobalCss()}
    body.modal-open {
      overflow: hidden;
    }
    [hidden] {
      display: none !important;
    }
    a {
      color: inherit;
    }
    .skip-link {
      position: fixed;
      inset-block-start: var(--sp-2);
      inset-inline-start: var(--sp-2);
      z-index: 100;
      translate: 0 -160%;
      padding: var(--sp-2) var(--sp-3);
      border: 2px solid var(--accent);
      border-radius: var(--rad-1);
      background: var(--bg);
      color: var(--ink);
      font-weight: 600;
      transition: translate var(--motion-fast);
    }
    .skip-link:focus {
      translate: 0;
    }
    .app-shell {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      width: 100%;
      max-width: 100%;
      min-height: 100vh;
    }
    .sidebar {
      position: sticky;
      inset-block-start: 0;
      display: flex;
      flex-direction: column;
      gap: var(--sp-5);
      height: 100vh;
      min-width: 0;
      padding: var(--sp-5) var(--sp-4);
      overflow-y: auto;
      border-inline-end: 1px solid var(--border);
      background: var(--surface);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
      color: var(--ink);
      font-size: var(--fs-base);
      font-weight: 650;
      letter-spacing: -0.015em;
      text-decoration: none;
    }
    .brand::before {
      content: "";
      width: 0.55em;
      height: 0.55em;
      border: 2px solid var(--accent);
      border-radius: 50% 50% 50% 0;
      rotate: -45deg;
    }
    .workspace-block,
    .sidebar-usage {
      display: grid;
      gap: var(--sp-1);
      min-width: 0;
    }
    .workspace-block {
      padding-block-end: var(--sp-4);
      border-block-end: 1px solid var(--border);
    }
    .workspace-block strong,
    .workspace-block span,
    .workspace-block small,
    .sidebar-usage strong,
    .sidebar-usage span,
    .sidebar-usage small {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .workspace-block strong,
    .sidebar-usage strong {
      color: var(--ink);
      font-size: var(--fs-sm);
      font-weight: 600;
    }
    .workspace-block span,
    .workspace-block small,
    .sidebar-usage span,
    .sidebar-usage small {
      color: var(--muted);
      font-size: var(--fs-xs);
    }
    .nav {
      display: grid;
      gap: var(--sp-1);
    }
    .nav a {
      padding: var(--sp-2) var(--sp-3);
      border-radius: var(--rad-1);
      color: var(--ink-2);
      font-size: var(--fs-sm);
      font-weight: 500;
      text-decoration: none;
      transition: background-color var(--motion-fast), color var(--motion-fast);
    }
    .nav a:hover {
      background: var(--surface-2);
      color: var(--ink);
    }
    .nav a.active {
      background: color-mix(in srgb, var(--accent) 9%, transparent);
      color: var(--accent);
      font-weight: 600;
    }
    .support-menu {
      min-width: 0;
      border-block-start: 1px solid var(--border);
      padding-block-start: var(--sp-3);
    }
    .support-menu summary {
      padding: var(--sp-2);
      border-radius: var(--rad-1);
      color: var(--ink-2);
      cursor: pointer;
      font-size: var(--fs-sm);
      font-weight: 600;
    }
    .support-menu summary:hover {
      background: var(--surface-2);
    }
    .support-links {
      display: grid;
      gap: var(--sp-1);
      padding-block-start: var(--sp-2);
    }
    .support-links a {
      padding: var(--sp-1) var(--sp-2);
      color: var(--muted);
      font-size: var(--fs-xs);
      text-decoration: none;
    }
    .support-links a:hover {
      color: var(--ink);
      text-decoration: underline;
    }
    .sign-out-form {
      margin-block-start: auto;
    }
    .mobile-header {
      display: none;
    }
    main {
      display: grid;
      align-content: start;
      gap: var(--sp-5);
      width: 100%;
      max-width: 100%;
      min-width: 0;
      padding: var(--sp-6);
    }
    main > * {
      min-width: 0;
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--sp-4);
      padding-block-end: var(--sp-4);
      border-block-end: 1px solid var(--border);
    }
    .page-kicker {
      margin: 0;
      color: var(--muted);
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: var(--fs-xs);
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    h1, h2, h3, p {
      margin: 0;
    }
    h1 {
      font-size: clamp(var(--fs-xl), 3vw, var(--fs-2xl));
      line-height: 1.15;
    }
    h2 {
      font-size: var(--fs-xl);
    }
    h3 {
      font-size: var(--fs-lg);
    }
    .topbar p,
    .subtle-text,
    .field > span,
    .list-row span,
    .stat-detail,
    .stat-label {
      color: var(--muted);
    }
    .plan-chip,
    .chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      max-width: 100%;
      padding: var(--sp-1) var(--sp-2);
      border: 1px solid var(--border-strong);
      border-radius: var(--rad-1);
      background: var(--surface);
      color: var(--ink-2);
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: var(--fs-xs);
      line-height: 1.4;
      text-align: center;
      overflow-wrap: anywhere;
    }
    .chip-live {
      border-color: color-mix(in srgb, var(--success) 55%, var(--border));
      color: var(--success);
    }
    .chip-muted {
      color: var(--muted);
    }
    .banner {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--sp-3);
      min-width: 0;
      padding: var(--sp-3) var(--sp-4);
      border: 1px solid var(--border-strong);
      border-inline-start-width: 3px;
      border-radius: var(--rad-2);
      background: var(--surface);
      color: var(--ink-2);
      font-size: var(--fs-sm);
    }
    .banner > div {
      flex: 1 1 18rem;
      min-width: 0;
    }
    .banner p {
      margin-block-start: var(--sp-1);
    }
    .banner-info {
      border-inline-start-color: var(--accent);
    }
    .banner-success {
      border-inline-start-color: var(--success);
    }
    .banner-warning {
      border-inline-start-color: var(--warn);
    }
    .banner-danger {
      border-inline-start-color: var(--danger);
    }
    .stack {
      display: grid;
      gap: var(--sp-4);
      min-width: 0;
    }
    .stack.compact {
      gap: var(--sp-2);
    }
    .section-stack {
      gap: var(--sp-4);
    }
    .stats-grid,
    .two-column,
    .usage-grid,
    .compact-grid,
    .metric-stack {
      display: grid;
      min-width: 0;
      gap: var(--sp-4);
    }
    .stats-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .two-column {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .usage-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .compact-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .ds-card,
    .ds-card-body,
    .stat-card,
    .snippet-card {
      min-width: 0;
      max-width: 100%;
    }
    .focus-card {
      border-color: var(--border-strong);
      background: var(--bg);
    }
    .onboarding-layout {
      align-items: start;
    }
    .progress-head {
      align-items: center;
      margin-block: var(--sp-1);
    }
    .setup-progress {
      width: 100%;
      height: var(--sp-2);
      overflow: hidden;
      border-radius: var(--rad-1);
      background: var(--surface-2);
    }
    .setup-progress-fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--accent);
    }
    .setup-step {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: start;
      gap: var(--sp-3);
      min-width: 0;
      padding: var(--sp-3);
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--bg);
      color: inherit;
      text-decoration: none;
    }
    .setup-step p {
      margin-block-start: var(--sp-1);
      color: var(--muted);
    }
    .setup-step-index {
      display: grid;
      place-items: center;
      width: var(--sp-6);
      height: var(--sp-6);
      border: 1px solid var(--border-strong);
      border-radius: 50%;
      background: var(--surface);
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: var(--fs-sm);
    }
    .setup-step-complete {
      border-inline-start: 3px solid var(--success);
    }
    .setup-step-current {
      border-inline-start: 3px solid var(--accent);
    }
    .setup-step-blocked {
      color: var(--muted);
    }
    .card-head,
    .section-header {
      display: grid;
      gap: var(--sp-2);
      min-width: 0;
      margin-block-end: var(--sp-4);
    }
    .split {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--sp-3);
      min-width: 0;
    }
    .split > * {
      min-width: 0;
    }
    .align-end {
      align-items: flex-end;
    }
    .stat-card {
      display: grid;
      gap: var(--sp-2);
      padding: var(--sp-4);
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--surface);
      box-shadow: var(--shadow-1);
      color: inherit;
      text-decoration: none;
    }
    .stat-card:hover {
      border-color: var(--border-strong);
    }
    .stat-label {
      font-size: var(--fs-xs);
      font-weight: 500;
    }
    .stat-value {
      color: var(--ink);
      font-size: var(--fs-xl);
      font-weight: 650;
    }
    .usage-bar {
      display: flex;
      width: 100%;
      height: var(--sp-3);
      margin-block: var(--sp-4);
      overflow: hidden;
      border-radius: var(--rad-1);
      background: var(--surface-2);
    }
    .usage-bar.large {
      height: var(--sp-4);
    }
    .usage-segment {
      display: block;
      height: 100%;
    }
    .segment-tiles {
      background: var(--accent);
    }
    .segment-raster {
      background: var(--success);
    }
    .segment-static {
      background: var(--warn);
    }
    .usage-metric,
    .metric-card,
    .token-card {
      display: grid;
      gap: var(--sp-2);
      min-width: 0;
      padding: var(--sp-3);
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--bg);
    }
    .usage-metric strong,
    .metric-card strong,
    .token-card code {
      min-width: 0;
      color: var(--ink);
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .token-card code,
    .code-block,
    input[readonly] {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: var(--fs-sm);
    }
    .field {
      display: grid;
      gap: var(--sp-2);
      min-width: 0;
    }
    .inline-field {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
    }
    main input,
    main textarea,
    main select {
      width: 100%;
      min-height: 2.75rem;
      padding: 0.625rem 0.75rem;
      border: 1px solid var(--border-strong);
      border-radius: var(--rad-1);
      background: var(--bg) !important;
      color: var(--ink);
      font: inherit;
    }
    textarea {
      resize: vertical;
    }
    .checklist {
      display: grid;
      gap: var(--sp-2);
    }
    .chip-row,
    .card-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--sp-2);
      min-width: 0;
    }
    .check-item {
      padding: var(--sp-2) var(--sp-3);
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--surface);
      color: var(--ink-2);
      font-size: var(--fs-sm);
    }
    .check {
      display: flex;
      align-items: center;
      gap: var(--sp-2);
      padding: var(--sp-2) var(--sp-3);
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--surface);
    }
    .check input {
      width: auto;
      min-height: 0;
      margin: 0;
    }
    .mode-toggle {
      display: flex;
      flex-wrap: wrap;
      gap: var(--sp-2);
    }
    .mode-button,
    .mode-link {
      padding: var(--sp-2) var(--sp-3);
      border: 1px solid var(--border-strong);
      border-radius: var(--rad-2);
      background: var(--surface);
      color: var(--ink);
      cursor: pointer;
      font: inherit;
      font-size: var(--fs-sm);
      text-decoration: none;
    }
    .mode-button.active,
    .mode-link.active {
      border-color: var(--accent);
      background: var(--accent);
      color: var(--accent-fg);
    }
    .code-block {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      min-height: 7.5rem;
      margin: 0;
      padding: var(--sp-4);
      overflow-x: auto;
      border-radius: var(--rad-2);
      background: var(--code-bg);
      color: var(--code-ink);
      line-height: 1.5;
    }
    .list-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-3);
      min-width: 0;
      padding: var(--sp-3);
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--bg);
      color: inherit;
      text-decoration: none;
    }
    .list-row > * {
      min-width: 0;
    }
    .list-row strong {
      display: block;
      min-width: 0;
      color: var(--ink);
      overflow-wrap: anywhere;
    }
    .empty-note,
    .empty-state {
      display: grid;
      justify-items: start;
      gap: var(--sp-3);
      min-width: 0;
      padding: var(--sp-4);
      border: 1px dashed var(--border-strong);
      border-radius: var(--rad-2);
      background: var(--surface);
      color: var(--muted);
    }
    .preview-map {
      display: grid;
      align-content: end;
      gap: var(--sp-2);
      min-height: 11.25rem;
      padding: var(--sp-4);
      border: 1px solid var(--border);
      border-radius: var(--rad-3);
      background: var(--surface);
    }
    .preview-map-large {
      min-height: 15rem;
    }
    .style-preview-card {
      align-content: stretch;
      gap: var(--sp-3);
    }
    .style-preview-top,
    .style-preview-legend {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--sp-2);
      min-width: 0;
    }
    .style-preview-top small {
      color: var(--muted);
    }
    .style-preview-frame {
      display: grid;
      min-width: 0;
    }
    .style-preview-image {
      display: block;
      width: 100%;
      min-height: 8.25rem;
      aspect-ratio: 16 / 9;
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--bg);
      object-fit: cover;
    }
    .style-preview-empty {
      display: grid;
      place-items: center;
      align-content: center;
      gap: var(--sp-2);
      min-height: 8.25rem;
      aspect-ratio: 16 / 9;
      padding: var(--sp-4);
      border: 1px dashed var(--border-strong);
      border-radius: var(--rad-2);
      background: var(--bg);
      color: var(--muted);
      text-align: center;
    }
    .style-preview-empty strong {
      color: var(--ink);
    }
    .style-preview-empty p {
      max-width: 30rem;
    }
    .billing-action-guidance {
      margin-block: var(--sp-4) var(--sp-3);
      color: var(--ink-2);
      font-size: var(--fs-sm);
    }
    .danger-zone {
      border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
    }
    .settings-tabs {
      display: flex !important;
      flex-wrap: wrap;
      gap: var(--sp-2) var(--sp-4) !important;
      min-width: 0;
      margin-block-end: var(--sp-5);
      padding-block-end: var(--sp-2);
      border-block-end: 1px solid var(--border);
    }
    .settings-tab-link {
      padding-block-end: var(--sp-2);
      border-block-end: 2px solid transparent;
      color: var(--muted);
      font-size: var(--fs-sm);
      font-weight: 600;
      text-decoration: none;
    }
    .settings-tab-link.active {
      border-block-end-color: var(--accent);
      color: var(--accent);
    }
    .settings-list {
      margin-block-start: var(--sp-4);
    }
    .settings-action-row,
    .row-actions,
    .notification-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--sp-3);
      min-width: 0;
    }
    .settings-action-row {
      padding-block: var(--sp-3);
      border-block-end: 1px solid var(--border);
    }
    .settings-action-row:last-child {
      border-block-end: 0;
    }
    .row-detail {
      display: block;
      margin-block-start: var(--sp-1);
      color: var(--muted);
      font-size: var(--fs-xs);
    }
    .session-details {
      min-width: 0;
      max-width: 75%;
    }
    .session-details strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .content-narrow {
      width: min(100%, 37.5rem);
    }
    .selectable-text {
      user-select: all;
    }
    .notification-heading {
      justify-content: flex-start;
    }
    .notification-tone {
      font-size: 0.625rem;
      text-transform: uppercase;
    }
    .recovery-code-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--sp-2);
      min-width: 0;
      margin-block-end: var(--sp-4);
      padding: var(--sp-4);
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--code-bg);
    }
    .recovery-code-grid code {
      min-width: 0;
      color: var(--code-ink);
      text-align: center;
      overflow-wrap: anywhere;
    }
    .danger-text {
      color: var(--danger) !important;
    }
    .modal-shell {
      position: fixed;
      inset: 0;
      z-index: 40;
      display: grid;
      place-items: center;
      padding: var(--sp-4);
      background: color-mix(in srgb, var(--ink) 55%, transparent);
    }
    .modal-card {
      display: grid;
      gap: var(--sp-4);
      width: min(100%, 32.5rem);
      max-height: calc(100vh - 2rem);
      padding: var(--sp-5);
      overflow-y: auto;
      border: 1px solid var(--border-strong);
      border-radius: var(--rad-3);
      background: var(--bg);
      box-shadow: var(--shadow-1);
    }
    .modal-card p {
      color: var(--muted);
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: var(--sp-2);
    }
    @media (max-width: 75rem) {
      .stats-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 64rem) {
      .app-shell {
        display: block;
        min-height: 0;
      }
      .sidebar {
        display: none;
      }
      .mobile-header {
        position: sticky;
        inset-block-start: 0;
        z-index: 30;
        display: block;
        min-height: 3.5rem;
        border-block-end: 1px solid var(--border);
        background: var(--bg);
      }
      .mobile-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 3.5rem;
        padding-inline: var(--sp-4);
      }
      .mobile-menu {
        position: relative;
      }
      .mobile-menu > summary {
        min-height: 2.25rem;
        list-style: none;
        cursor: pointer;
      }
      .mobile-menu > summary::-webkit-details-marker {
        display: none;
      }
      .mobile-menu-panel {
        position: absolute;
        inset-block-start: calc(100% + var(--sp-2));
        inset-inline-end: 0;
        display: grid;
        gap: var(--sp-4);
        width: min(calc(100vw - 2rem), 22.5rem);
        max-height: calc(100vh - 5rem);
        padding: var(--sp-4);
        overflow-y: auto;
        border: 1px solid var(--border-strong);
        border-radius: var(--rad-3);
        background: var(--bg);
        box-shadow: var(--shadow-1);
      }
      .mobile-menu-panel .support-menu {
        border-block-start: 0;
      }
      main {
        padding: var(--sp-5);
      }
    }
    @media (max-width: 48rem) {
      main {
        gap: var(--sp-4);
        padding: var(--sp-4);
      }
      .stats-grid,
      .two-column,
      .usage-grid,
      .compact-grid {
        grid-template-columns: 1fr;
      }
      .topbar,
      .banner,
      .list-row {
        align-items: stretch;
      }
      .topbar > .align-end {
        align-items: flex-start;
      }
      .inline-field {
        grid-template-columns: 1fr;
      }
      .setup-step {
        grid-template-columns: auto minmax(0, 1fr);
      }
      .setup-step > .chip {
        grid-column: 2;
      }
      .card-actions > .ds-button,
      .card-actions > .button {
        flex: 1 1 auto;
      }
    }
    @media (max-width: 28rem) {
      .recovery-code-grid {
        grid-template-columns: 1fr;
      }
      .mobile-header-row {
        padding-inline: var(--sp-3);
      }
      main {
        padding: var(--sp-3);
      }
      .ds-card {
        padding: var(--sp-4);
      }
    }
  `;
}
