import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const quotaExceededHandler: EmailTemplateHandler = {
  templateKey: "quota_exceeded",
  subject: "Your workspace has exceeded its usage limit",
  validateParams(params) {
    return validateRequiredParams(params, ["workspaceName"]);
  },
  renderHtml(params) {
    const rawWorkspaceName = String(params.workspaceName);
    const workspaceName = escapeHtml(rawWorkspaceName);
    const content = `
      <h1 style="color: #DC2626;">Usage limit exceeded</h1>
      <p>The <strong>${workspaceName}</strong> workspace has exceeded its monthly request allowance.</p>
      <p>Delivery requests may now be rate-limited or return quota errors until usage is reduced, the plan is updated, or the next billing period starts.</p>
      <a href="https://tstiles.com/app/billing" class="btn" style="background-color: #DC2626;">Review billing</a>
      <p class="muted">If usage is unexpected, review project activity and rotate exposed tokens from the dashboard.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: `Workspace ${rawWorkspaceName} has exceeded its quota limit.` });
  },
  renderText(params) {
    const workspaceName = String(params.workspaceName);
    return `Usage limit exceeded\n\nThe "${workspaceName}" workspace has exceeded its monthly request allowance.\n\nDelivery requests may now be rate-limited or return quota errors until usage is reduced, the plan is updated, or the next billing period starts:\n\nhttps://tstiles.com/app/billing\n\nIf usage is unexpected, review project activity and rotate exposed tokens from the dashboard.\n\n--\nThe TSTiles Team`;
  },
};
