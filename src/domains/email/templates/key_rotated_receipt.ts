import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const keyRotatedReceiptHandler: EmailTemplateHandler = {
  templateKey: "key_rotated_receipt",
  subject: "API key rotated successfully",
  validateParams(params) {
    return validateRequiredParams(params, ["projectName", "rotatedAt"]);
  },
  renderHtml(params) {
    const rawProjectName = String(params.projectName);
    const projectName = escapeHtml(rawProjectName);
    const rotatedAt = escapeHtml(params.rotatedAt);
    const content = `
      <h1>API key rotated</h1>
      <p>This email is a receipt confirming that an API key for your project <strong>${projectName}</strong> was successfully rotated.</p>
      <p><strong>Rotation Time:</strong> ${rotatedAt}</p>
      <p>Any maps or applications using the old key must be updated to use the new credentials to prevent rendering interruptions.</p>
      <a href="https://tstiles.com/app" class="btn">Open dashboard</a>
      <p class="muted">If you did not perform this key rotation, please contact support and workspace owners immediately.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: `API key rotated for project ${rawProjectName}.` });
  },
  renderText(params) {
    const projectName = String(params.projectName);
    const rotatedAt = String(params.rotatedAt);
    return `API Key Rotated\n\nThis email is a receipt confirming that an API key for your project "${projectName}" was successfully rotated.\n\nRotation Time: ${rotatedAt}\n\nAny maps or applications using the old key must be updated to use the new credentials to prevent rendering interruptions.\n\nDashboard: https://tstiles.com/app\n\nIf you did not perform this key rotation, please contact support and workspace owners immediately.\n\n--\nThe TSTiles Team`;
  },
};
