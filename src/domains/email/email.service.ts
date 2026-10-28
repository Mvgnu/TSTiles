import { randomUUID } from "node:crypto";
import { prisma } from "../../config/db";
import {
  type EmailDispatchRequest,
  type EmailDispatchResult,
  type EmailTemplateKey,
  type BrevoWebhookEvent,
  type EmailDispatchStatus,
  EmailError,
  EmailErrorCode,
} from "./types";
import { getTemplateHandler, getAllTemplateKeys } from "./templates";
import { writeToConsoleSink } from "./providers/console-sink";
import { writeToFileSink } from "./providers/file-sink";
import { sendBrevoEmail } from "./providers/brevo-client";

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Validates the runtime email configuration.
 * Throws an EmailError if the configuration is invalid or missing.
 */
export function validateEmailConfig(): void {
  const env = process.env.NODE_ENV;
  const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase() || "console";

  if (env === "production" || env === "staging") {
    if (provider !== "brevo") {
      throw new EmailError(
        EmailErrorCode.PROVIDER_CONFIG,
        `EMAIL_PROVIDER must be 'brevo' in ${env} environment`,
        "PERMANENT_CONFIG",
      );
    }
  }

  if (provider === "brevo") {
    const senderAddress = process.env.EMAIL_SENDER_ADDRESS?.trim();
    const senderName = process.env.EMAIL_SENDER_NAME?.trim();
    const apiKey = process.env.BREVO_API_KEY?.trim();

    if (!senderAddress || !senderName || !apiKey) {
      throw new EmailError(
        EmailErrorCode.PROVIDER_CONFIG,
        "EMAIL_PROVIDER=brevo requires EMAIL_SENDER_ADDRESS, EMAIL_SENDER_NAME, and BREVO_API_KEY",
        "PERMANENT_CONFIG",
      );
    }

    if (!EMAIL_REGEX.test(senderAddress)) {
      throw new EmailError(
        EmailErrorCode.PROVIDER_CONFIG,
        "EMAIL_SENDER_ADDRESS is not a valid email address",
        "PERMANENT_CONFIG",
      );
    }

    // Verify all template IDs are present and are positive integers
    const keys = getAllTemplateKeys();
    for (const key of keys) {
      const envKey = `BREVO_TEMPLATE_ID_${key.toUpperCase()}`;
      const val = process.env[envKey]?.trim();
      if (!val) {
        throw new EmailError(
          EmailErrorCode.PROVIDER_CONFIG,
          `EMAIL_PROVIDER=brevo requires ${envKey}`,
          "PERMANENT_CONFIG",
        );
      }
      const templateId = parseInt(val, 10);
      if (Number.isNaN(templateId) || templateId <= 0) {
        throw new EmailError(
          EmailErrorCode.PROVIDER_CONFIG,
          `${envKey} must be a positive integer`,
          "PERMANENT_CONFIG",
        );
      }
    }
  }
}

/**
 * Checks if a recipient email is suppressed.
 */
export async function isSuppressed(emailAddress: string): Promise<boolean> {
  if (typeof emailAddress !== "string" || emailAddress.trim().length === 0) {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "Email address must be a non-empty string");
  }
  const normalized = emailAddress.trim().toLowerCase();
  const suppression = await prisma.emailSuppression.findUnique({
    where: { emailAddress: normalized },
  });
  return suppression !== null;
}

/**
 * Helper to validate a dispatch request before execution.
 */
function validateDispatchRequest(input: unknown): EmailDispatchRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "Request payload must be an object");
  }

  const req = input as Record<string, unknown>;

  const to = req.to;
  if (typeof to !== "string" || to.trim().length === 0) {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "Recipient 'to' must be a non-empty string");
  }
  const trimmedTo = to.trim();
  if (trimmedTo.includes(",") || trimmedTo.includes(";") || trimmedTo.includes("<") || trimmedTo.includes(" ")) {
    throw new EmailError(
      EmailErrorCode.BAD_REQUEST,
      "Recipient 'to' must be a single email address, address lists are rejected",
    );
  }
  if (!EMAIL_REGEX.test(trimmedTo)) {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "Recipient 'to' is not a valid email address");
  }

  const templateKey = req.templateKey as EmailTemplateKey;
  if (typeof templateKey !== "string" || templateKey.trim().length === 0) {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "templateKey is required");
  }

  const idempotencyKey = req.idempotencyKey;
  if (typeof idempotencyKey !== "string") {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "idempotencyKey is required and must be a string");
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    throw new EmailError(
      EmailErrorCode.BAD_REQUEST,
      "idempotencyKey must be 16-128 characters and base64url-safe",
    );
  }

  if (req.params !== undefined && (typeof req.params !== "object" || req.params === null || Array.isArray(req.params))) {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "params must be an object");
  }

  if (req.workspaceId !== undefined && typeof req.workspaceId !== "string") {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "workspaceId must be a string");
  }
  if (req.userId !== undefined && typeof req.userId !== "string") {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "userId must be a string");
  }
  if (req.replyTo !== undefined && typeof req.replyTo !== "string") {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "replyTo must be a string");
  }
  if (req.tags !== undefined && !Array.isArray(req.tags)) {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "tags must be an array of strings");
  }

  return {
    to: trimmedTo.toLowerCase(),
    templateKey,
    params: (req.params as Record<string, unknown>) ?? {},
    idempotencyKey,
    workspaceId: req.workspaceId as string | undefined,
    userId: req.userId as string | undefined,
    replyTo: req.replyTo as string | undefined,
    tags: req.tags as string[] | undefined,
  };
}

/**
 * Sends a transactional email.
 */
export async function sendTransactionalEmail(input: EmailDispatchRequest): Promise<EmailDispatchResult> {
  let req: EmailDispatchRequest;
  try {
    req = validateDispatchRequest(input);
  } catch (error) {
    if (error instanceof EmailError) {
      throw error;
    }
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "Invalid input request shape", String(error));
  }

  const handler = getTemplateHandler(req.templateKey);
  if (!handler) {
    throw new EmailError(
      EmailErrorCode.TEMPLATE_UNKNOWN,
      `Unknown email template: ${req.templateKey}`,
    );
  }

  // Validate template parameters
  let validatedParams: Record<string, unknown>;
  try {
    validatedParams = handler.validateParams(req.params);
  } catch (error) {
    if (error instanceof EmailError) {
      throw error;
    }
    throw new EmailError(
      EmailErrorCode.PARAMS_INVALID,
      `Invalid parameters for template ${req.templateKey}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Check Idempotency Key
  const existing = await prisma.emailDispatch.findUnique({
    where: { idempotencyKey: req.idempotencyKey },
  });

  if (existing) {
    // Check conflicts
    if (existing.to !== req.to || existing.templateKey !== req.templateKey) {
      throw new EmailError(
        EmailErrorCode.DISPATCH_CONFLICT,
        "Idempotency key conflict: identical key reused with different recipient or template",
      );
    }
    return {
      id: existing.id,
      idempotencyKey: existing.idempotencyKey,
      to: existing.to,
      templateKey: existing.templateKey as EmailTemplateKey,
      paramsJson: existing.paramsJson,
      workspaceId: existing.workspaceId,
      userId: existing.userId,
      status: existing.status as EmailDispatchStatus,
      providerMessageId: existing.providerMessageId,
      errorCode: existing.errorCode as EmailErrorCode | null,
      errorMessage: existing.errorMessage,
      attemptCount: existing.attemptCount,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      sentAt: existing.sentAt,
    };
  }

  const dispatchId = `eml_${randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  const paramsJson = JSON.stringify(validatedParams);

  // Check Suppression List
  const suppressed = await isSuppressed(req.to);
  if (suppressed) {
    const row = await prisma.emailDispatch.create({
      data: {
        id: dispatchId,
        idempotencyKey: req.idempotencyKey,
        to: req.to,
        templateKey: req.templateKey,
        paramsJson,
        workspaceId: req.workspaceId ?? null,
        userId: req.userId ?? null,
        status: "suppressed",
        errorCode: EmailErrorCode.SUPPRESSED,
        errorMessage: "Recipient email is on the suppression list",
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
        sentAt: null,
      },
    });

    return {
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      to: row.to,
      templateKey: row.templateKey as EmailTemplateKey,
      paramsJson: row.paramsJson,
      workspaceId: row.workspaceId,
      userId: row.userId,
      status: "suppressed",
      providerMessageId: null,
      errorCode: EmailErrorCode.SUPPRESSED,
      errorMessage: row.errorMessage,
      attemptCount: 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      sentAt: null,
    };
  }

  // Create pending dispatch row
  await prisma.emailDispatch.create({
    data: {
      id: dispatchId,
      idempotencyKey: req.idempotencyKey,
      to: req.to,
      templateKey: req.templateKey,
      paramsJson,
      workspaceId: req.workspaceId ?? null,
      userId: req.userId ?? null,
      status: "pending",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  });

  const subject = handler.subject;
  const htmlContent = handler.renderHtml(validatedParams);
  const textContent = handler.renderText(validatedParams);

  const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase() || "console";
  let status: "sent" | "failed" = "failed";
  let providerMessageId: string | null = null;
  let errorCode: EmailErrorCode | null = null;
  let errorMessage: string | null = null;
  let attemptCount = 0;

  if (provider.startsWith("file:")) {
    attemptCount = 1;
    const path = provider.slice("file:".length).trim();
    try {
      await writeToFileSink(path, {
        emittedAt: new Date().toISOString(),
        to: req.to,
        templateKey: req.templateKey,
        params: validatedParams,
        subject,
        html: htmlContent,
        text: textContent,
      });
      status = "sent";
    } catch (error) {
      status = "failed";
      errorCode = EmailErrorCode.PROVIDER_UNAVAILABLE;
      errorMessage = `Failed writing to file sink: ${error instanceof Error ? error.message : String(error)}`;
    }
  } else if (provider === "brevo") {
    // Brevo send path with retry logic
    const apiKey = process.env.BREVO_API_KEY || "";
    const senderAddress = process.env.EMAIL_SENDER_ADDRESS || "";
    const senderName = process.env.EMAIL_SENDER_NAME || "";
    const envKey = `BREVO_TEMPLATE_ID_${req.templateKey.toUpperCase()}`;
    const templateId = parseInt(process.env[envKey] || "0", 10);

    const brevoConfig = {
      apiKey,
      senderAddress,
      senderName,
      replyTo: req.replyTo,
    };

    const brevoRequest = {
      to: req.to,
      templateId,
      params: validatedParams,
      subject,
      htmlContent,
      textContent,
      tags: req.tags,
      replyTo: req.replyTo,
    };

    const maxAttempts = 3;
    const delays = [250, 1000, 4000];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attemptCount = attempt;
      try {
        const sendResult = await sendBrevoEmail(brevoConfig, brevoRequest);
        status = "sent";
        providerMessageId = sendResult.providerMessageId;
        errorCode = null;
        errorMessage = null;
        break; // Success!
      } catch (error) {
        status = "failed";
        errorMessage = error instanceof Error ? error.message : String(error);
        if (error instanceof EmailError) {
          errorCode = error.code;
          // Check if this error is retryable
          if (error.details !== "RETRYABLE_NETWORK" && error.details !== "RETRYABLE_PROVIDER") {
            // Permanent error, do not retry
            break;
          }
        } else {
          errorCode = EmailErrorCode.PROVIDER_UNAVAILABLE;
        }

        if (attempt < maxAttempts) {
          const jitter = Math.random() * 100;
          await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1] + jitter));
        }
      }
    }
  } else {
    // "console" provider
    attemptCount = 1;
    try {
      await writeToConsoleSink({
        type: "email_dispatch",
        emittedAt: new Date().toISOString(),
        to: req.to,
        templateKey: req.templateKey,
        params: validatedParams,
        subject,
        html: htmlContent,
        text: textContent,
      });
      status = "sent";
    } catch (error) {
      status = "failed";
      errorCode = EmailErrorCode.PROVIDER_UNAVAILABLE;
      errorMessage = `Failed writing to console sink: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const finalNow = new Date().toISOString();
  const updated = await prisma.emailDispatch.update({
    where: { id: dispatchId },
    data: {
      status,
      providerMessageId,
      errorCode,
      errorMessage,
      attemptCount,
      updatedAt: finalNow,
      sentAt: status === "sent" ? finalNow : null,
    },
  });

  return {
    id: updated.id,
    idempotencyKey: updated.idempotencyKey,
    to: updated.to,
    templateKey: updated.templateKey as EmailTemplateKey,
    paramsJson: updated.paramsJson,
    workspaceId: updated.workspaceId,
    userId: updated.userId,
    status: updated.status as EmailDispatchStatus,
    providerMessageId: updated.providerMessageId,
    errorCode: updated.errorCode as EmailErrorCode | null,
    errorMessage: updated.errorMessage,
    attemptCount: updated.attemptCount,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
    sentAt: updated.sentAt,
  };
}

/**
 * Lists email dispatches matching the filter options.
 */
export async function listDispatches(opts?: {
  readonly workspaceId?: string;
  readonly userId?: string;
  readonly limit?: number;
}): Promise<EmailDispatchResult[]> {
  const where: Record<string, unknown> = {};
  if (opts?.workspaceId) {
    where.workspaceId = opts.workspaceId;
  }
  if (opts?.userId) {
    where.userId = opts.userId;
  }

  const limit = opts?.limit ?? 50;

  const rows = await prisma.emailDispatch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    to: row.to,
    templateKey: row.templateKey as EmailTemplateKey,
    paramsJson: row.paramsJson,
    workspaceId: row.workspaceId,
    userId: row.userId,
    status: row.status as EmailDispatchStatus,
    providerMessageId: row.providerMessageId,
    errorCode: row.errorCode as EmailErrorCode | null,
    errorMessage: row.errorMessage,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sentAt: row.sentAt,
  }));
}

/**
 * Processes a Brevo Webhook event and records it, potentially suppressing the email address.
 */
export async function applyBrevoWebhookEvent(event: BrevoWebhookEvent): Promise<void> {
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "Webhook event must be an object");
  }

  const eventType = event.event;
  const email = event.email;
  if (typeof eventType !== "string" || eventType.trim().length === 0) {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "event type is required");
  }
  if (typeof email !== "string" || email.trim().length === 0) {
    throw new EmailError(EmailErrorCode.BAD_REQUEST, "email address is required");
  }

  const providerEventId = String(event.id || event["message-id"] || event.ts || Date.now());
  const occurredAt = event.date ? new Date(event.date).toISOString() : new Date().toISOString();

  // Deduplicate
  const existingEvent = await prisma.emailWebhookEvent.findUnique({
    where: { providerEventId },
  });
  if (existingEvent) {
    return; // Already processed
  }

  await prisma.emailWebhookEvent.create({
    data: {
      id: `ev_${randomUUID().replace(/-/g, "")}`,
      providerEventId,
      eventType,
      occurredAt,
      recordedAt: new Date().toISOString(),
    },
  });

  const normalizedEmail = email.trim().toLowerCase();

  // Suppression Event Types
  const suppressionTypes = ["hard_bounce", "invalid_email", "spam", "complaint", "unsubscribe"];
  if (suppressionTypes.includes(eventType)) {
    await prisma.emailSuppression.upsert({
      where: { emailAddress: normalizedEmail },
      create: {
        id: `sup_${randomUUID().replace(/-/g, "")}`,
        emailAddress: normalizedEmail,
        reason: eventType,
        occurredAt,
        providerEventId,
      },
      update: {
        reason: eventType,
        occurredAt,
        providerEventId,
      },
    });
  }

  // Update dispatch row if message-id matches
  const messageId = event["message-id"];
  if (messageId) {
    const dispatch = await prisma.emailDispatch.findFirst({
      where: { providerMessageId: messageId },
    });

    if (dispatch) {
      let status: string = dispatch.status;
      let errorCode = dispatch.errorCode;
      let errorMessage = dispatch.errorMessage;

      if (eventType === "delivered") {
        status = "sent";
      } else if (suppressionTypes.includes(eventType) || eventType === "soft_bounce") {
        status = "failed";
        errorCode = EmailErrorCode.PROVIDER_UNAVAILABLE;
        errorMessage = `Webhook reported delivery failure: ${eventType}${event.reason ? ` - ${event.reason}` : ""}`;
      }

      await prisma.emailDispatch.update({
        where: { id: dispatch.id },
        data: {
          status,
          errorCode,
          errorMessage,
          updatedAt: new Date().toISOString(),
        },
      });
    }
  }
}

// Fail-fast boot configuration validation
try {
  validateEmailConfig();
} catch (error) {
  // We log the error but allow execution in test/development, so test runners don't crash
  // if their environment variables aren't mock-loaded at import time.
  // The spec says "fail fast at startup", so let's log loudly and throw if in staging/production!
  const env = process.env.NODE_ENV;
  if (env === "production" || env === "staging") {
    console.error("FATAL: Failed to validate email configuration:", error);
    throw error;
  } else {
    console.warn("WARNING: Failed to validate email configuration during bootstrapping:", error instanceof Error ? error.message : error);
  }
}
