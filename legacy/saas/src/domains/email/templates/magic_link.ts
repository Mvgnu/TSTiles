import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const magicLinkHandler: EmailTemplateHandler = {
  templateKey: "magic_link",
  subject: "Sign in with your magic link",
  validateParams(params) {
    return validateRequiredParams(params, ["magicLinkUrl"]);
  },
  renderHtml(params) {
    const magicLinkUrl = escapeHtml(params.magicLinkUrl);
    const content = `
      <h1>Sign in to TSTiles</h1>
      <p>Click the button below to sign in to your TSTiles account. No password is required for this request.</p>
      <a href="${magicLinkUrl}" class="btn">Sign in</a>
      <p>If the button doesn't work, you can copy and paste the following link into your browser:</p>
      <div class="code-block">${magicLinkUrl}</div>
      <p class="muted">This magic link is single-use and valid for 15 minutes. If you did not request this link, you can safely ignore this email.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: "Sign in to TSTiles." });
  },
  renderText(params) {
    const magicLinkUrl = String(params.magicLinkUrl);
    return `Sign in to TSTiles\n\nPlease use the following link to sign in to your account:\n\n${magicLinkUrl}\n\nThis magic link is single-use and valid for 15 minutes. If you did not request this link, you can safely ignore this email.\n\n--\nThe TSTiles Team`;
  },
};
