import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const accountDeletionCompletedHandler: EmailTemplateHandler = {
  templateKey: "account_deletion_completed",
  subject: "Your TSTiles account was permanently deleted",
  validateParams(params) {
    return validateRequiredParams(params, ["email"]);
  },
  renderHtml(params) {
    const email = escapeHtml(params.email);
    const content = `
      <h1>Account deleted</h1>
      <p>This confirms that the TSTiles account associated with <strong>${email}</strong> has been deleted and scheduled data removal has completed for active account records.</p>
      <p>No further action is required.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: "Confirming permanent deletion of your TSTiles account." });
  },
  renderText(params) {
    const email = String(params.email);
    return `Account deleted\n\nThis confirms that the TSTiles account associated with "${email}" has been deleted and scheduled data removal has completed for active account records.\n\nNo further action is required.\n\n--\nThe TSTiles Team`;
  },
};
