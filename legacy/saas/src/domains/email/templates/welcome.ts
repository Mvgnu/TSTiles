import { escapeHtml, type EmailTemplateHandler, renderEmailLayout, validateRequiredParams } from "./layout";

export const welcomeHandler: EmailTemplateHandler = {
  templateKey: "welcome",
  subject: "Welcome to TSTiles",
  validateParams(params) {
    return validateRequiredParams(params, ["name", "email"]);
  },
  renderHtml(params) {
    const name = escapeHtml(params.name);
    const content = `
      <h1>Welcome to TSTiles</h1>
      <p>Hi ${name},</p>
      <p>Your workspace is ready. You can create a project, publish or select a style, and issue a delivery token from the dashboard.</p>
      <p>Before embedding maps in production, review the quickstart and use a project-scoped token for delivery requests.</p>
      <a href="https://tstiles.com/app/projects" class="btn">Open projects</a>
      <p>&bull; <a href="https://tstiles.com/docs/quickstart">Read the quickstart</a></p>
      <p>&bull; <a href="https://tstiles.com/docs/authentication">Review delivery authentication</a></p>
      <p class="muted">This message confirms account setup for the email address used during sign-up.</p>
    `;
    return renderEmailLayout(content, { title: this.subject, preheader: "Your TSTiles workspace is ready." });
  },
  renderText(params) {
    const name = String(params.name);
    return `Hi ${name},\n\nWelcome to TSTiles.\n\nYour workspace is ready. You can create a project, publish or select a style, and issue a delivery token from the dashboard.\n\nOpen projects:\n\nhttps://tstiles.com/app/projects\n\nRead the quickstart:\n\nhttps://tstiles.com/docs/quickstart\n\nReview delivery authentication:\n\nhttps://tstiles.com/docs/authentication\n\n--\nThe TSTiles Team`;
  },
};
