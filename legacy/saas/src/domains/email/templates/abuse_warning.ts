import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const abuseWarningHandler: EmailTemplateHandler = {
  templateKey: "abuse_warning",
  subject: "Security or abuse warning for your workspace",
  validateParams(params) {
    return validateRequiredParams(params, ["workspaceName", "reason"]);
  },
  renderHtml(params) {
    const rawWorkspaceName = String(params.workspaceName);
    const workspaceName = escapeHtml(rawWorkspaceName);
    const reason = escapeHtml(params.reason);
    const content = `
      <h1 style="color: #D97706;">Security and abuse warning</h1>
      <p>The <strong>${workspaceName}</strong> workspace requires review.</p>
      <p>Telemetry or operator review identified the following issue:</p>
      <div class="code-block" style="border-left: 4px solid #D97706;">${reason}</div>
      <p>Please resolve the issue to avoid workspace suspension. If you need details or want to appeal this flag, reply to this email.</p>
      <a href="https://tstiles.com/security" class="btn" style="background-color: #D97706;">Review security policies</a>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: `Warning for workspace ${rawWorkspaceName}.` });
  },
  renderText(params) {
    const workspaceName = String(params.workspaceName);
    const reason = String(params.reason);
    return `Security and abuse warning\n\nThe "${workspaceName}" workspace requires review.\n\nTelemetry or operator review identified the following issue:\n\n${reason}\n\nPlease resolve the issue to avoid workspace suspension. If you need details or want to appeal this flag, reply to this email.\n\n--\nThe TSTiles Team`;
  },
};
