import { EmailError, EmailErrorCode } from "../types";

export interface BrevoClientConfig {
  readonly apiKey: string;
  readonly senderAddress: string;
  readonly senderName: string;
  readonly replyTo?: string;
}

export interface BrevoSendRequest {
  readonly to: string;
  readonly templateId: number;
  readonly params: Record<string, unknown>;
  readonly subject: string;
  readonly htmlContent: string;
  readonly textContent: string;
  readonly tags?: readonly string[];
  readonly replyTo?: string;
}

export async function sendBrevoEmail(
  config: BrevoClientConfig,
  request: BrevoSendRequest,
): Promise<{ readonly providerMessageId: string }> {
  const url = "https://api.brevo.com/v3/smtp/email";

  const payload: Record<string, unknown> = {
    sender: {
      name: config.senderName,
      email: config.senderAddress,
    },
    to: [
      {
        email: request.to,
      },
    ],
    templateId: request.templateId,
    params: request.params,
  };

  if (request.tags && request.tags.length > 0) {
    payload.tags = [...request.tags];
  }

  const finalReplyTo = request.replyTo || config.replyTo;
  if (finalReplyTo) {
    payload.replyTo = {
      email: finalReplyTo,
    };
  }

  // To be absolutely robust and support both template-based render on Brevo and
  // rich client-side HTML fallback, we can also pass the subject/htmlContent/textContent.
  // Note: Brevo allows subject/htmlContent/textContent overrides even with templateId.
  payload.subject = request.subject;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": config.apiKey,
        "content-type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // Retryable network error
    throw new EmailError(
      EmailErrorCode.PROVIDER_UNAVAILABLE,
      `Network fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      "RETRYABLE_NETWORK",
    );
  }

  if (!response.ok) {
    const status = response.status;
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      // ignore
    }

    if (status === 400) {
      throw new EmailError(
        EmailErrorCode.BAD_REQUEST,
        `Brevo rejected request (400): ${bodyText}`,
        "PERMANENT_INVALID_ADDRESS",
      );
    }

    if (status === 401 || status === 403) {
      throw new EmailError(
        EmailErrorCode.PROVIDER_CONFIG,
        `Brevo authentication failed (${status}): ${bodyText}`,
        "PERMANENT_CONFIG",
      );
    }

    if (status === 429) {
      throw new EmailError(
        EmailErrorCode.PROVIDER_UNAVAILABLE,
        `Brevo rate limit exceeded (429): ${bodyText}`,
        "RETRYABLE_PROVIDER",
      );
    }

    if (status >= 500) {
      throw new EmailError(
        EmailErrorCode.PROVIDER_UNAVAILABLE,
        `Brevo server error (${status}): ${bodyText}`,
        "RETRYABLE_PROVIDER",
      );
    }

    // Default to permanent provider error
    throw new EmailError(
      EmailErrorCode.BAD_REQUEST,
      `Brevo returned error status ${status}: ${bodyText}`,
      "PERMANENT_TEMPLATE",
    );
  }

  let resultData: unknown;
  try {
    resultData = await response.json();
  } catch {
    throw new EmailError(
      EmailErrorCode.PROVIDER_UNAVAILABLE,
      "Failed to parse Brevo JSON response",
      "RETRYABLE_PROVIDER",
    );
  }

  const messageId =
    typeof resultData === "object" && resultData !== null && "messageId" in resultData
      ? String((resultData as Record<string, unknown>).messageId)
      : "";

  if (!messageId) {
    throw new EmailError(
      EmailErrorCode.PROVIDER_UNAVAILABLE,
      "Brevo response did not return a messageId",
      "RETRYABLE_PROVIDER",
    );
  }

  return { providerMessageId: messageId };
}
