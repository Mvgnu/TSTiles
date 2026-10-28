import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const passwordResetHandler: EmailTemplateHandler = {
  templateKey: "password_reset",
  subject: "Reset your password",
  validateParams(params) {
    return validateRequiredParams(params, ["resetUrl", "name"]);
  },
  renderHtml(params) {
    const name = escapeHtml(params.name);
    const resetUrl = escapeHtml(params.resetUrl);
    const content = `
      <h1>Reset your password</h1>
      <p>Hi ${name},</p>
      <p>We received a request to reset the password for your TSTiles account. Click the button below to choose a new password.</p>
      <a href="${resetUrl}" class="btn">Reset password</a>
      <p>If the button doesn't work, you can copy and paste the following link into your browser:</p>
      <div class="code-block">${resetUrl}</div>
      <p class="muted">This password reset link is valid for 1 hour. If you did not request a password reset, you can safely ignore this email; your password will remain secure.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: "Reset your TSTiles account password." });
  },
  renderText(params) {
    const name = String(params.name);
    const resetUrl = String(params.resetUrl);
    return `Hi ${name},\n\nWe received a request to reset the password for your TSTiles account. Please use the following link to reset your password:\n\n${resetUrl}\n\nThis reset link is valid for 1 hour. If you did not request a password reset, you can safely ignore this email; your password will remain secure.\n\n--\nThe TSTiles Team`;
  },
};
