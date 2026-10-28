import { createHmac } from "node:crypto";
import { applyBrevoWebhookEvent } from "../email.service";
import {
  type EmailWebhookRouteRequest,
  type EmailWebhookRouteResponse,
  type BrevoWebhookEvent,
  EmailError,
  EmailErrorCode,
} from "../types";

function readHeader(
  headers: Readonly<Record<string, string | undefined>> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const direct = headers[name];
  if (typeof direct === "string") {
    return direct;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function verifyBrevoSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) {
    return false;
  }
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  const expectedSignature = hmac.digest("hex");
  return expectedSignature === signature;
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? "/";
}

function isWebhookPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "/webhooks/brevo" || normalized === "/webhooks/brevo/";
}

export async function emailWebhookRoute(
  input: EmailWebhookRouteRequest,
): Promise<EmailWebhookRouteResponse> {
  const allowedMethods = "POST,HEAD,OPTIONS";

  // Cors headers
  const corsHeaders: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": allowedMethods,
    "access-control-allow-headers": "content-type,x-brevo-signature,x-sib-signature",
    vary: "origin",
  };

  if (!isWebhookPath(input.path)) {
    return {
      status: 404,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify({ error: "EMAIL_NOT_FOUND" }),
    };
  }

  if (input.method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        ...corsHeaders,
        "cache-control": "public, max-age=60",
      },
    };
  }

  if (input.method === "HEAD") {
    return {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json",
      },
    };
  }

  if (input.method !== "POST") {
    return {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const secret = process.env.BREVO_WEBHOOK_SECRET?.trim();
    const signature =
      readHeader(input.headers, "x-brevo-signature") ||
      readHeader(input.headers, "x-sib-signature");

    let rawBody = "";
    if (typeof input.body === "string") {
      rawBody = input.body;
    } else if (input.body instanceof Uint8Array) {
      rawBody = new TextDecoder().decode(input.body);
    } else if (input.body !== undefined && input.body !== null) {
      rawBody = JSON.stringify(input.body);
    }

    if (secret && secret.length > 0) {
      if (!signature || !verifyBrevoSignature(rawBody, signature, secret)) {
        return {
          status: 401,
          headers: { ...corsHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            code: EmailErrorCode.WEBHOOK_SIGNATURE_INVALID,
            error: "invalid Brevo webhook signature",
          }),
        };
      }
    }

    let parsedBody: unknown;
    try {
      parsedBody = typeof input.body === "string" ? JSON.parse(input.body) : input.body;
    } catch {
      return {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          code: EmailErrorCode.BAD_REQUEST,
          error: "Invalid JSON body",
        }),
      };
    }

    if (!parsedBody || typeof parsedBody !== "object") {
      return {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          code: EmailErrorCode.BAD_REQUEST,
          error: "Invalid webhook payload shape",
        }),
      };
    }

    // Call applyBrevoWebhookEvent
    await applyBrevoWebhookEvent(parsedBody as BrevoWebhookEvent);

    return {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    const status = error instanceof EmailError && error.code === EmailErrorCode.BAD_REQUEST ? 400 : 500;
    const code = error instanceof EmailError ? error.code : "EMAIL_INTERNAL_ERROR";
    const message = error instanceof Error ? error.message : "Internal Server Error";

    return {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
      body: JSON.stringify({ code, error: message }),
    };
  }
}
