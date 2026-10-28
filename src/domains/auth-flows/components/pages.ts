import { escapeHtml, renderCard, renderInput, renderButton } from "../../design-system/components";
import { type AuthShellOptions, renderAuthShell } from "./auth-shell";
import { type AuthFlowsPage } from "../types";

export function renderAuthFlowsHtml(
  page: AuthFlowsPage,
  csrfToken: string,
  alert?: {
    readonly tone: "info" | "warn" | "danger" | "success";
    readonly message: string;
  },
  extraParams: Record<string, unknown> = {},
): string {
  let title = "Authentication";
  let formAction = "";
  let bodyHtml = "";

  const csrfField = `<input type="hidden" name="_csrf" value="${csrfToken}">`;
  const queryParams = new URLSearchParams();
  if (extraParams.next) {
    queryParams.set("next", String(extraParams.next));
  }
  if (extraParams.plan === "pro") {
    queryParams.set("plan", "pro");
  }
  const authQuery = queryParams.toString();
  const authQuerySuffix = authQuery ? `?${authQuery}` : "";

  if (page === "sign-up") {
    title = "Create your account";
    formAction = `/sign-up${authQuerySuffix}`;
    const defaultEmail = String(extraParams.email || "");

    const formFields = `
      ${csrfField}
      <div class="form-group">
        ${renderInput("Email address", "email", {
          type: "email",
          value: defaultEmail,
          required: true,
          placeholder: "you@example.com",
        })}
      </div>
      <div class="form-group">
        ${renderInput("Password", "password", {
          type: "password",
          required: true,
          placeholder: "••••••••••••",
          hint: "Must be 12+ characters with at least one number and special character",
        })}
      </div>
      <div class="form-group">
        ${renderInput("Display Name (optional)", "displayName", {
          type: "text",
          placeholder: "Jane Doe",
        })}
      </div>
      <div class="form-group">
        ${renderButton("Create account", "primary", {
          type: "submit",
          className: "submit-btn",
        })}
      </div>
    `;

    bodyHtml = `
      <form action="${escapeHtml(formAction)}" method="POST">
        ${renderCard(formFields, "outlined", {
          headerHtml: `<h1 style="margin: 0; font-size: 20px; font-weight: 600;">Create your account</h1>`,
          footerHtml: `<div style="font-size: 13px; color: var(--muted); text-align: center; width: 100%;">
            Already have an account? <a href="${escapeHtml(`/sign-in${authQuerySuffix}`)}" style="color: var(--accent); text-decoration: none; font-weight: 500;">Sign in</a>
          </div>`,
        })}
      </form>
    `;
  } else if (page === "sign-in") {
    title = "Sign in to TSTiles";
    formAction = `/sign-in${authQuerySuffix}`;
    const defaultEmail = String(extraParams.email || "");

    const formFields = `
      ${csrfField}
      <div class="form-group">
        ${renderInput("Email address", "email", {
          type: "email",
          value: defaultEmail,
          required: true,
          placeholder: "you@example.com",
        })}
      </div>
      <div class="form-group">
        ${renderInput("Password", "password", {
          type: "password",
          required: true,
          placeholder: "••••••••••••",
        })}
      </div>
      <div class="form-group">
        ${renderButton("Sign in", "primary", {
          type: "submit",
          className: "submit-btn",
        })}
      </div>
      <div class="form-links">
        <a href="/forgot-password">Forgot password?</a>
        <a href="/magic-link/request">Sign in with magic link</a>
      </div>
    `;

    bodyHtml = `
      <form action="${escapeHtml(formAction)}" method="POST">
        ${renderCard(formFields, "outlined", {
          headerHtml: `<h1 style="margin: 0; font-size: 20px; font-weight: 600;">Sign in to your account</h1>`,
          footerHtml: `<div style="font-size: 13px; color: var(--muted); text-align: center; width: 100%;">
            Don't have an account? <a href="${escapeHtml(`/sign-up${authQuerySuffix}`)}" style="color: var(--accent); text-decoration: none; font-weight: 500;">Sign up</a>
          </div>`,
        })}
      </form>
    `;
  } else if (page === "verify-email") {
    title = "Verify your email";
    formAction = "/verify-email/resend";

    const cardContent = `
      ${csrfField}
      <p style="font-size: 14px; color: var(--ink-2); line-height: 1.6; margin-bottom: 24px;">
        We have sent a verification link to your email address. Please click the link in that email to verify your account.
      </p>
      ${renderButton("Resend verification email", "primary", {
        type: "submit",
        className: "submit-btn",
      })}
    `;

    bodyHtml = `
      <form action="${formAction}" method="POST">
        ${renderCard(cardContent, "outlined", {
          headerHtml: `<h1 style="margin: 0; font-size: 20px; font-weight: 600;">Check your email</h1>`,
          footerHtml: `<div style="font-size: 13px; color: var(--muted); text-align: center; width: 100%;">
            Need to change your email? <a href="/sign-up" style="color: var(--accent); text-decoration: none; font-weight: 500;">Start over</a>
          </div>`,
        })}
      </form>
    `;
  } else if (page === "forgot-password") {
    title = "Reset your password";
    formAction = "/forgot-password";

    const formFields = `
      ${csrfField}
      <div class="form-group">
        ${renderInput("Email address", "email", {
          type: "email",
          required: true,
          placeholder: "you@example.com",
        })}
      </div>
      <div class="form-group">
        ${renderButton("Send reset link", "primary", {
          type: "submit",
          className: "submit-btn",
        })}
      </div>
    `;

    bodyHtml = `
      <form action="${formAction}" method="POST">
        ${renderCard(formFields, "outlined", {
          headerHtml: `<h1 style="margin: 0; font-size: 20px; font-weight: 600;">Forgot password</h1>`,
          footerHtml: `<div style="font-size: 13px; color: var(--muted); text-align: center; width: 100%;">
            Remembered your password? <a href="/sign-in" style="color: var(--accent); text-decoration: none; font-weight: 500;">Sign in</a>
          </div>`,
        })}
      </form>
    `;
  } else if (page === "reset-password") {
    title = "Choose a new password";
    const token = String(extraParams.token || "");
    formAction = `/reset-password/${token}`;

    const formFields = `
      ${csrfField}
      <div class="form-group">
        ${renderInput("New Password", "password", {
          type: "password",
          required: true,
          placeholder: "••••••••••••",
          hint: "Must be 12+ characters with at least one number and special character",
        })}
      </div>
      <div class="form-group">
        ${renderButton("Save password", "primary", {
          type: "submit",
          className: "submit-btn",
        })}
      </div>
    `;

    bodyHtml = `
      <form action="${formAction}" method="POST">
        ${renderCard(formFields, "outlined", {
          headerHtml: `<h1 style="margin: 0; font-size: 20px; font-weight: 600;">Set new password</h1>`,
        })}
      </form>
    `;
  } else if (page === "magic-link-request") {
    title = "Sign in with magic link";
    formAction = "/magic-link/request";

    const formFields = `
      ${csrfField}
      <div class="form-group">
        ${renderInput("Email address", "email", {
          type: "email",
          required: true,
          placeholder: "you@example.com",
        })}
      </div>
      <div class="form-group">
        ${renderButton("Send magic link", "primary", {
          type: "submit",
          className: "submit-btn",
        })}
      </div>
    `;

    bodyHtml = `
      <form action="${formAction}" method="POST">
        ${renderCard(formFields, "outlined", {
          headerHtml: `<h1 style="margin: 0; font-size: 20px; font-weight: 600;">Magic link sign-in</h1>`,
          footerHtml: `<div style="font-size: 13px; color: var(--muted); text-align: center; width: 100%;">
            Back to <a href="/sign-in" style="color: var(--accent); text-decoration: none; font-weight: 500;">Password Sign In</a>
          </div>`,
        })}
      </form>
    `;
  } else if (page === "accept-invite") {
    title = "Accept Invitation";
    const token = String(extraParams.token || "");
    formAction = `/accept-invite/${token}`;

    const workspaceName = String(extraParams.workspaceName || "Workspace");
    const inviterName = String(extraParams.inviterName || "Team Member");
    const existing = !!extraParams.existingUser;

    let contentFields = `${csrfField}`;

    if (existing) {
      contentFields += `
        <p style="font-size: 14px; color: var(--ink-2); line-height: 1.6; margin-bottom: 24px;">
          You are signed in as <strong>${String(extraParams.email)}</strong>. Click the button below to join the <strong>${workspaceName}</strong> workspace instantly.
        </p>
        <div class="form-group">
          ${renderButton("Accept Invitation & Join", "primary", {
            type: "submit",
            className: "submit-btn",
          })}
        </div>
      `;
    } else {
      contentFields += `
        <p style="font-size: 14px; color: var(--ink-2); line-height: 1.6; margin-bottom: 20px;">
          ${inviterName} has invited you to join the <strong>${workspaceName}</strong> workspace. Set a password below to create your account and join.
        </p>
        <div class="form-group">
          ${renderInput("Email address", "email", {
            type: "email",
            value: String(extraParams.email || ""),
            disabled: true,
            required: true,
          })}
        </div>
        <div class="form-group">
          ${renderInput("Create Password", "password", {
            type: "password",
            required: true,
            placeholder: "••••••••••••",
            hint: "Must be 12+ characters with at least one number and special character",
          })}
        </div>
        <div class="form-group">
          ${renderInput("Display Name (optional)", "displayName", {
            type: "text",
            placeholder: "Jane Doe",
          })}
        </div>
        <div class="form-group">
          ${renderButton("Accept Invitation & Join", "primary", {
            type: "submit",
            className: "submit-btn",
          })}
        </div>
      `;
    }

    bodyHtml = `
      <form action="${formAction}" method="POST">
        ${renderCard(contentFields, "outlined", {
          headerHtml: `<h1 style="margin: 0; font-size: 20px; font-weight: 600;">Join workspace</h1>`,
        })}
      </form>
    `;
  } else if (page === "mfa-challenge") {
    title = "MFA Verification Required";
    formAction = "/sign-in/mfa"; // Custom endpoint/flow if needed, usually maps here

    const formFields = `
      ${csrfField}
      <p style="font-size: 14px; color: var(--ink-2); line-height: 1.6; margin-bottom: 20px;">
        Please enter the 6-digit verification code from your authenticator app to complete sign-in.
      </p>
      <div class="form-group">
        ${renderInput("Verification Code", "mfaCode", {
          type: "text",
          required: true,
          placeholder: "000000",
          hint: "Or enter a backup recovery code",
        })}
      </div>
      <div class="form-group">
        ${renderButton("Verify & Sign In", "primary", {
          type: "submit",
          className: "submit-btn",
        })}
      </div>
    `;

    bodyHtml = `
      <form action="${formAction}" method="POST">
        ${renderCard(formFields, "outlined", {
          headerHtml: `<h1 style="margin: 0; font-size: 20px; font-weight: 600;">MFA Verification</h1>`,
        })}
      </form>
    `;
  }

  const shellOptions: AuthShellOptions = {
    title,
    csrfToken,
    alert,
  };

  return renderAuthShell(bodyHtml, shellOptions);
}
