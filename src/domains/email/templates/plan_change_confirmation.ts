import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const planChangeConfirmationHandler: EmailTemplateHandler = {
  templateKey: "plan_change_confirmation",
  subject: "Your TSTiles plan was updated successfully",
  validateParams(params) {
    return validateRequiredParams(params, ["workspaceName", "newPlanName"]);
  },
  renderHtml(params) {
    const rawWorkspaceName = String(params.workspaceName);
    const rawNewPlanName = String(params.newPlanName);
    const workspaceName = escapeHtml(rawWorkspaceName);
    const newPlanName = escapeHtml(rawNewPlanName);
    const content = `
      <h1>Subscription plan updated</h1>
      <p>This email confirms that the subscription plan for your workspace <strong>${workspaceName}</strong> was successfully updated to the <strong>${newPlanName}</strong> tier.</p>
      <p>Your new request limits and pricing terms are now active. You will see these changes reflected in your next monthly billing statement.</p>
      <a href="https://tstiles.com/app/billing" class="btn">View billing settings</a>
      <p class="muted">Thank you for scaling your maps with TSTiles. If you did not make this change, please contact workspace owners immediately.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: `Workspace ${rawWorkspaceName} updated to plan ${rawNewPlanName}.` });
  },
  renderText(params) {
    const workspaceName = String(params.workspaceName);
    const newPlanName = String(params.newPlanName);
    return `Subscription Plan Updated\n\nThis email confirms that the subscription plan for your workspace "${workspaceName}" was successfully updated to the "${newPlanName}" tier.\n\nYour new request limits and pricing terms are now active. You will see these changes reflected in your next monthly billing statement.\n\nBilling Settings: https://tstiles.com/app/billing\n\n--\nThe TSTiles Team`;
  },
};
