import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const dataExportReadyHandler: EmailTemplateHandler = {
  templateKey: "data_export_ready",
  subject: "Your workspace data export is ready",
  validateParams(params) {
    return validateRequiredParams(params, ["exportUrl"]);
  },
  renderHtml(params) {
    const exportUrl = escapeHtml(params.exportUrl);
    const content = `
      <h1>Your data export is ready</h1>
      <p>Your workspace export has been prepared, including projects, styles, metadata, and billing history available to the account.</p>
      <p>Click the button below to download the compiled archive.</p>
      <a href="${exportUrl}" class="btn">Download export archive</a>
      <p>If the button doesn't work, you can copy and paste the following link into your browser:</p>
      <div class="code-block">${exportUrl}</div>
      <p class="muted">For security reasons, this download link remains active for 7 days.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: "Your TSTiles workspace data export is ready for download." });
  },
  renderText(params) {
    const exportUrl = String(params.exportUrl);
    return `Your data export is ready\n\nYour workspace export has been prepared, including projects, styles, metadata, and billing history available to the account.\n\nPlease download your archive from the following link:\n\n${exportUrl}\n\nFor security reasons, this download link remains active for 7 days.\n\n--\nThe TSTiles Team`;
  },
};
