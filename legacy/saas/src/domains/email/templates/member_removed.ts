import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const memberRemovedHandler: EmailTemplateHandler = {
  templateKey: "member_removed",
  subject: "Your workspace membership was updated",
  validateParams(params) {
    return validateRequiredParams(params, ["workspaceName", "memberName"]);
  },
  renderHtml(params) {
    const rawWorkspaceName = String(params.workspaceName);
    const workspaceName = escapeHtml(rawWorkspaceName);
    const memberName = escapeHtml(params.memberName);
    const content = `
      <h1>Membership removed</h1>
      <p>Hi ${memberName},</p>
      <p>This is to confirm that you have been removed from the <strong>${workspaceName}</strong> workspace on TSTiles.</p>
      <p>You will no longer have access to this workspace's projects, styles, or billing details. If this was done in error, please contact a workspace administrator.</p>
      <p class="muted">If you need to create your own personal workspace, you can log in at any time and create one.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: `You were removed from ${rawWorkspaceName} workspace.` });
  },
  renderText(params) {
    const workspaceName = String(params.workspaceName);
    const memberName = String(params.memberName);
    return `Hi ${memberName},\n\nThis is to confirm that you have been removed from the "${workspaceName}" workspace on TSTiles.\n\nYou will no longer have access to this workspace's projects, styles, or billing details. If this was done in error, please contact a workspace administrator.\n\n--\nThe TSTiles Team`;
  },
};
