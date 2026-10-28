import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const quotaApproachingHandler: EmailTemplateHandler = {
  templateKey: "quota_approaching",
  subject: "Your workspace is approaching its usage limit",
  validateParams(params) {
    return validateRequiredParams(params, ["workspaceName", "usagePercentage"]);
  },
  renderHtml(params) {
    const rawWorkspaceName = String(params.workspaceName);
    const workspaceName = escapeHtml(rawWorkspaceName);
    const usagePercentage = Number(params.usagePercentage);
    const content = `
      <h1>Usage threshold reached</h1>
      <p>The <strong>${workspaceName}</strong> workspace has used <strong>${usagePercentage}%</strong> of its monthly request allowance.</p>
      <p>Review usage and billing before delivery reaches the workspace limit. Project tokens continue to work normally while quota remains available.</p>
      <a href="https://tstiles.com/app/billing" class="btn">Review usage and billing</a>
      <p class="muted">If usage is unexpected, review project activity and rotate exposed tokens from the dashboard.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: `Workspace ${rawWorkspaceName} has reached ${usagePercentage}% quota.` });
  },
  renderText(params) {
    const workspaceName = String(params.workspaceName);
    const usagePercentage = Number(params.usagePercentage);
    return `Usage threshold reached\n\nThe "${workspaceName}" workspace has used ${usagePercentage}% of its monthly request allowance.\n\nReview usage and billing before delivery reaches the workspace limit:\n\nhttps://tstiles.com/app/billing\n\nIf usage is unexpected, review project activity and rotate exposed tokens from the dashboard.\n\n--\nThe TSTiles Team`;
  },
};
