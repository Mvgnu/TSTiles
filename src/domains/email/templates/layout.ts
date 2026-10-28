import type { EmailTemplateKey } from "../types";
import { EmailError, EmailErrorCode } from "../types";

export interface LayoutOptions {
  readonly title: string;
  readonly preheader?: string;
}

export interface EmailTemplateHandler {
  readonly templateKey: EmailTemplateKey;
  readonly subject: string;
  validateParams(params: unknown): Record<string, unknown>;
  renderHtml(params: Record<string, unknown>): string;
  renderText(params: Record<string, unknown>): string;
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function validateRequiredParams(
  params: unknown,
  requiredKeys: readonly string[],
): Record<string, unknown> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new EmailError(EmailErrorCode.PARAMS_INVALID, "Parameters must be an object");
  }
  const record = params as Record<string, unknown>;
  for (const key of requiredKeys) {
    if (record[key] === undefined || record[key] === null || String(record[key]).trim().length === 0) {
      throw new EmailError(EmailErrorCode.PARAMS_INVALID, `Missing required template parameter: ${key}`);
    }
  }
  return record;
}

export function renderEmailLayout(contentHtml: string, options: LayoutOptions): string {
  const { title, preheader = "" } = options;
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #FFFFFF;
      color: #111111;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    table {
      border-collapse: collapse;
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
      width: 100%;
    }
    img {
      border: 0;
      height: auto;
      line-height: 100%;
      outline: none;
      text-decoration: none;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #FFFFFF;
      padding: 48px 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #FAFAFA;
      border: 1px solid #E5E5E5;
      border-radius: 8px;
      overflow: hidden;
    }
    .header {
      padding: 32px 32px 16px 32px;
      border-bottom: 1px solid #E5E5E5;
    }
    .logo-text {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #111111;
      text-decoration: none;
    }
    .content {
      padding: 32px;
    }
    .footer {
      padding: 24px 32px;
      background-color: #FFFFFF;
      border-top: 1px solid #E5E5E5;
      font-size: 12px;
      color: #6B7280;
      text-align: center;
    }
    h1 {
      margin: 0 0 16px 0;
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.25;
      color: #111111;
    }
    p {
      margin: 0 0 16px 0;
      color: #111111;
      font-size: 14px;
      line-height: 1.6;
    }
    p.muted {
      color: #6B7280;
    }
    .btn {
      display: inline-block;
      padding: 10px 18px;
      background-color: #4F46E5;
      color: #FFFFFF !important;
      text-decoration: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      margin: 8px 0 24px 0;
      text-align: center;
    }
    .btn:hover {
      background-color: #4338CA;
    }
    .divider {
      height: 1px;
      background-color: #E5E5E5;
      margin: 24px 0;
    }
    .code-block {
      background-color: #FFFFFF;
      border: 1px solid #E5E5E5;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 13px;
      padding: 12px 16px;
      margin: 16px 0;
      overflow-x: auto;
      color: #111111;
    }
  </style>
</head>
<body>
  ${preheader ? `<span style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;color:#FFFFFF;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${safePreheader}</span>` : ""}
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <span class="logo-text">TSTiles</span>
      </div>
      <div class="content">
        ${contentHtml}
      </div>
      <div class="footer">
        <p class="muted" style="margin: 0 0 8px 0;">This is an automated transactional email from TSTiles.</p>
        <p class="muted" style="margin: 0;">&copy; ${new Date().getFullYear()} TSTiles. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
