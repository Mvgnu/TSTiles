import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const emailVerificationHandler: EmailTemplateHandler = {
  templateKey: "email_verification",
  subject: "Verify your email address",
  validateParams(params) {
    return validateRequiredParams(params, ["verificationUrl", "name"]);
  },
  renderHtml(params) {
    const name = escapeHtml(params.name);
    const verificationUrl = escapeHtml(params.verificationUrl);
    const content = `
      <h1>Verify your email address</h1>
      <p>Hi ${name},</p>
      <p>Thank you for signing up for TSTiles. Please click the button below to verify your email address and activate your account.</p>
      <a href="${verificationUrl}" class="btn">Verify email address</a>
      <p>If the button doesn't work, you can copy and paste the following link into your browser:</p>
      <div class="code-block">${verificationUrl}</div>
      <p class="muted">This verification link is valid for 24 hours. If you did not create a TSTiles account, you can safely ignore this email.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: "Verify your email address to activate your TSTiles account." });
  },
  renderText(params) {
    const name = String(params.name);
    const verificationUrl = String(params.verificationUrl);
    return `Hi ${name},\n\nThank you for signing up for TSTiles. Please verify your email address by visiting the following link:\n\n${verificationUrl}\n\nThis verification link is valid for 24 hours. If you did not create a TSTiles account, you can safely ignore this email.\n\n--\nThe TSTiles Team`;
  },
};
