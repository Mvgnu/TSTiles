import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const workspaceInvitationHandler: EmailTemplateHandler = {
  templateKey: "workspace_invitation",
  subject: "You've been invited to join a workspace",
  validateParams(params) {
    return validateRequiredParams(params, ["inviteUrl", "workspaceName", "inviterName"]);
  },
  renderHtml(params) {
    const rawWorkspaceName = String(params.workspaceName);
    const workspaceName = escapeHtml(rawWorkspaceName);
    const inviterName = escapeHtml(params.inviterName);
    const inviteUrl = escapeHtml(params.inviteUrl);
    const content = `
      <h1>Join the ${workspaceName} workspace</h1>
      <p>${inviterName} has invited you to join the <strong>${workspaceName}</strong> workspace on TSTiles.</p>
      <p>Click the button below to accept the invitation and join their team.</p>
      <a href="${inviteUrl}" class="btn">Accept invitation</a>
      <p>If the button doesn't work, copy and paste this link into your browser:</p>
      <div class="code-block">${inviteUrl}</div>
      <p class="muted">This invitation is valid for 7 days. If you were not expecting this invitation, you can safely ignore this email.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: `Join the ${rawWorkspaceName} workspace on TSTiles.` });
  },
  renderText(params) {
    const workspaceName = String(params.workspaceName);
    const inviterName = String(params.inviterName);
    const inviteUrl = String(params.inviteUrl);
    return `Join the ${workspaceName} workspace\n\n${inviterName} has invited you to join the "${workspaceName}" workspace on TSTiles. Please accept the invitation by visiting the following link:\n\n${inviteUrl}\n\nThis invitation is valid for 7 days. If you were not expecting this invitation, you can safely ignore this email.\n\n--\nThe TSTiles Team`;
  },
};
