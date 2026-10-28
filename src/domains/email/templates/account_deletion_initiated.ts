import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const accountDeletionInitiatedHandler: EmailTemplateHandler = {
  templateKey: "account_deletion_initiated",
  subject: "Account deletion request initiated",
  validateParams(params) {
    return validateRequiredParams(params, ["deletionDate"]);
  },
  renderHtml(params) {
    const rawDeletionDate = String(params.deletionDate);
    const deletionDate = escapeHtml(rawDeletionDate);
    const content = `
      <h1 style="color: #DC2626;">Account deletion requested</h1>
      <p>We received a request to delete your TSTiles account.</p>
      <p>Your account is scheduled for deletion on <strong>${deletionDate}</strong>.</p>
      <p>During the grace period, workspace access and delivery services may be suspended. If you did not request this deletion or want to cancel it, sign in and review account settings.</p>
      <a href="https://tstiles.com/app" class="btn" style="background-color: #DC2626;">Review account</a>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: `Your account is scheduled for deletion on ${rawDeletionDate}.` });
  },
  renderText(params) {
    const deletionDate = String(params.deletionDate);
    return `Account deletion requested\n\nWe received a request to delete your TSTiles account.\n\nYour account is scheduled for deletion on ${deletionDate}.\n\nDuring the grace period, workspace access and delivery services may be suspended. If you did not request this deletion or want to cancel it, sign in and review account settings.\n\n--\nThe TSTiles Team`;
  },
};
