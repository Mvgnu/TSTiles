import type { EmailTemplateKey } from "../types";
import type { EmailTemplateHandler } from "./layout";
import { emailVerificationHandler } from "./email_verification";
import { welcomeHandler } from "./welcome";
import { passwordResetHandler } from "./password_reset";
import { magicLinkHandler } from "./magic_link";
import { workspaceInvitationHandler } from "./workspace_invitation";
import { memberRemovedHandler } from "./member_removed";
import { billingReceiptHandler } from "./billing_receipt";
import { quotaApproachingHandler } from "./quota_approaching";
import { quotaExceededHandler } from "./quota_exceeded";
import { keyRotatedReceiptHandler } from "./key_rotated_receipt";
import { abuseWarningHandler } from "./abuse_warning";
import { planChangeConfirmationHandler } from "./plan_change_confirmation";
import { accountDeletionInitiatedHandler } from "./account_deletion_initiated";
import { accountDeletionCompletedHandler } from "./account_deletion_completed";
import { dataExportReadyHandler } from "./data_export_ready";

export * from "./layout";

const handlers: Record<EmailTemplateKey, EmailTemplateHandler> = {
  email_verification: emailVerificationHandler,
  welcome: welcomeHandler,
  password_reset: passwordResetHandler,
  magic_link: magicLinkHandler,
  workspace_invitation: workspaceInvitationHandler,
  member_removed: memberRemovedHandler,
  billing_receipt: billingReceiptHandler,
  quota_approaching: quotaApproachingHandler,
  quota_exceeded: quotaExceededHandler,
  key_rotated_receipt: keyRotatedReceiptHandler,
  abuse_warning: abuseWarningHandler,
  plan_change_confirmation: planChangeConfirmationHandler,
  account_deletion_initiated: accountDeletionInitiatedHandler,
  account_deletion_completed: accountDeletionCompletedHandler,
  data_export_ready: dataExportReadyHandler,
};

export function getTemplateHandler(key: EmailTemplateKey): EmailTemplateHandler | undefined {
  return handlers[key];
}

export function getAllTemplateKeys(): EmailTemplateKey[] {
  return Object.keys(handlers) as EmailTemplateKey[];
}
