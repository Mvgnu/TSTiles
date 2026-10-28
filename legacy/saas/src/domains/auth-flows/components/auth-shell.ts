import { getGlobalCss } from "../../design-system/styles";
import { getUniversalHeaderCss, renderBanner, renderUniversalHeader } from "../../design-system/components";

export interface AuthShellOptions {
  readonly title: string;
  readonly csrfToken: string;
  readonly alert?: {
    readonly tone: "info" | "warn" | "danger" | "success";
    readonly message: string;
  };
  readonly showMarketingNav?: boolean;
}

export function renderAuthShell(contentHtml: string, options: AuthShellOptions): string {
  const { title, csrfToken, alert, showMarketingNav = true } = options;
  void csrfToken;
  const globalCss = getGlobalCss();
  const activeHeaderItem = title.toLowerCase().includes("create") ? "sign-up" : title.toLowerCase().includes("sign in") ? "sign-in" : undefined;

  const alertBanner = alert
    ? `<div style="margin-bottom: 24px;">
        ${renderBanner(alert.message, alert.tone)}
       </div>`
    : "";

  const navHtml = showMarketingNav ? renderUniversalHeader(activeHeaderItem) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | TSTiles</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    ${globalCss}
    ${getUniversalHeaderCss()}
    
    body {
      background:
        radial-gradient(circle at 12% 12%, rgba(31,95,139,0.12), transparent 28%),
        linear-gradient(135deg, rgba(246,241,231,0.92), rgba(250,250,250,1));
      color: var(--ink);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    @media (prefers-color-scheme: dark) {
      body {
        background:
          radial-gradient(circle at 12% 12%, rgba(99,102,241,0.18), transparent 28%),
          linear-gradient(135deg, rgba(11,11,12,1), rgba(20,20,22,1));
      }
    }
    
    .auth-main {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 64px 16px;
    }
    
    .auth-card-container {
      width: 100%;
      max-width: 440px;
    }
    
    .auth-footer {
      padding: 32px 16px;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 12px;
      color: var(--muted);
    }
    
    .auth-footer a {
      color: var(--ink-2);
      text-decoration: none;
      margin: 0 8px;
    }
    
    .auth-footer a:hover {
      color: var(--ink);
    }
    
    .form-group {
      margin-bottom: 20px;
    }
    
    .form-group label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--ink-2);
      margin-bottom: 8px;
    }
    
    .form-links {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 16px;
      font-size: 13px;
    }
    
    .form-links a {
      color: var(--accent);
      text-decoration: none;
    }
    
    .form-links a:hover {
      text-decoration: underline;
    }
    
    .submit-btn {
      width: 100%;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  ${navHtml}
  
  <main class="auth-main">
    <div class="auth-card-container">
      ${alertBanner}
      ${contentHtml}
    </div>
  </main>
  
  <footer class="auth-footer">
    <p>&copy; ${new Date().getFullYear()} TSTiles. All rights reserved.</p>
    <p style="margin-top: 8px;">
      <a href="/legal/terms">Terms</a> &middot;
      <a href="/legal/privacy">Privacy</a> &middot;
      <a href="/security">Security</a>
    </p>
  </footer>
</body>
</html>`;
}
