export {
  type EmailTemplateKey,
  type EmailDispatchRequest,
  type EmailDispatchResult,
  type EmailDispatchStatus,
  type EmailSuppressionReason,
  type EmailWebhookRouteRequest,
  type EmailWebhookRouteResponse,
  type BrevoWebhookEvent,
  EmailError,
  EmailErrorCode,
} from "./types";

export {
  sendTransactionalEmail,
  listDispatches,
  isSuppressed,
  applyBrevoWebhookEvent,
  validateEmailConfig,
} from "./email.service";

export { emailWebhookRoute } from "./routes/brevo-webhook-route";
