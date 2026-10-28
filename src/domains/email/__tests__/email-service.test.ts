import { strict as assert } from "node:assert";
import { join } from "node:path";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { prisma } from "../../../config/db";
import {
  sendTransactionalEmail,
  listDispatches,
  isSuppressed,
  applyBrevoWebhookEvent,
} from "../email.service";
import { emailWebhookRoute } from "../routes/brevo-webhook-route";
import { getTemplateHandler } from "../templates";
import { EmailError, EmailErrorCode } from "../types";
import { createHmac } from "node:crypto";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

// Setup test configuration and environment variables
const tempFilePath = join(__dirname, "test-email-sink.ndjson");

test("Email Service unit tests", async () => {
  // Reset any previous state for testing
  if (existsSync(tempFilePath)) {
    rmSync(tempFilePath);
  }

  // Ensure DB starts clean for email tables
  await prisma.emailDispatch.deleteMany();
  await prisma.emailSuppression.deleteMany();
  await prisma.emailWebhookEvent.deleteMany();

  // Test 1: validate parameters logic fails closed
  try {
    await sendTransactionalEmail({
      to: "test@example.com",
      templateKey: "email_verification",
      params: {}, // Missing required parameters
      idempotencyKey: "idem_key_11111111",
    });
    assert.fail("Should have thrown on missing parameters");
  } catch (error) {
    assert.ok(error instanceof EmailError);
    assert.equal(error.code, EmailErrorCode.PARAMS_INVALID);
  }

  // Test 2: validate bad input shape fails closed
  try {
    await sendTransactionalEmail({
      to: "not-an-email",
      templateKey: "email_verification",
      params: { name: "Test", verificationUrl: "https://example.com" },
      idempotencyKey: "idem_key_22222222",
    });
    assert.fail("Should have thrown on invalid email address");
  } catch (error) {
    assert.ok(error instanceof EmailError);
    assert.equal(error.code, EmailErrorCode.BAD_REQUEST);
  }

  // Test 3: validate single recipient policy
  try {
    await sendTransactionalEmail({
      to: "test1@example.com, test2@example.com",
      templateKey: "email_verification",
      params: { name: "Test", verificationUrl: "https://example.com" },
      idempotencyKey: "idem_key_33333333",
    });
    assert.fail("Should have thrown on multiple email recipients");
  } catch (error) {
    assert.ok(error instanceof EmailError);
    assert.equal(error.code, EmailErrorCode.BAD_REQUEST);
  }

  // Test 4: validate invalid template key fails closed
  try {
    await sendTransactionalEmail({
      to: "test@example.com",
      templateKey: "non_existent_template" as any,
      params: {},
      idempotencyKey: "idem_key_44444444",
    });
    assert.fail("Should have thrown on invalid template key");
  } catch (error) {
    assert.ok(error instanceof EmailError);
    assert.equal(error.code, EmailErrorCode.TEMPLATE_UNKNOWN);
  }

  // Test 5: validate console provider send
  process.env.EMAIL_PROVIDER = "console";
  const dispatchConsole = await sendTransactionalEmail({
    to: "test@example.com",
    templateKey: "welcome",
    params: { name: "Alice", email: "test@example.com" },
    idempotencyKey: "idem_console_555",
  });
  assert.equal(dispatchConsole.status, "sent");
  assert.equal(dispatchConsole.to, "test@example.com");

  // Check database
  const dbConsole = await prisma.emailDispatch.findUnique({
    where: { idempotencyKey: "idem_console_555" },
  });
  assert.ok(dbConsole);
  assert.equal(dbConsole.status, "sent");

  // Test 6: Idempotency check (sending same idempotencyKey returns cached result)
  const dispatchIdem = await sendTransactionalEmail({
    to: "test@example.com",
    templateKey: "welcome",
    params: { name: "Alice", email: "test@example.com" },
    idempotencyKey: "idem_console_555",
  });
  assert.equal(dispatchIdem.id, dispatchConsole.id);
  assert.equal(dispatchIdem.status, "sent");

  // Test 7: Idempotency conflict (sending same key but different template or email)
  try {
    await sendTransactionalEmail({
      to: "other@example.com",
      templateKey: "welcome",
      params: { name: "Alice", email: "test@example.com" },
      idempotencyKey: "idem_console_555",
    });
    assert.fail("Should have thrown on idempotency conflict");
  } catch (error) {
    assert.ok(error instanceof EmailError);
    assert.equal(error.code, EmailErrorCode.DISPATCH_CONFLICT);
  }

  // Test 8: validate file provider send
  process.env.EMAIL_PROVIDER = `file:${tempFilePath}`;
  const dispatchFile = await sendTransactionalEmail({
    to: "bob@example.com",
    templateKey: "password_reset",
    params: { name: "Bob", resetUrl: "https://example.com/reset" },
    idempotencyKey: "idem_file_6666666",
  });
  assert.equal(dispatchFile.status, "sent");
  assert.ok(existsSync(tempFilePath));

  // Verify file contents
  const lines = readFileSync(tempFilePath, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const parsedRecord = JSON.parse(lines[0]) as { to: string; subject: string };
  assert.equal(parsedRecord.to, "bob@example.com");
  assert.equal(parsedRecord.subject, "Reset your password");

  // Test 9: validate suppression checks
  const alreadySuppressed = await isSuppressed("suppressed@example.com");
  assert.equal(alreadySuppressed, false);

  // Insert manual suppression
  await prisma.emailSuppression.create({
    data: {
      id: "sup_manual_1",
      emailAddress: "suppressed@example.com",
      reason: "manual",
      occurredAt: new Date().toISOString(),
    },
  });

  const checkSuppressed = await isSuppressed("suppressed@example.com");
  assert.equal(checkSuppressed, true);

  // Try sending to a suppressed address
  const dispatchSuppressed = await sendTransactionalEmail({
    to: "suppressed@example.com",
    templateKey: "welcome",
    params: { name: "Suppressed User", email: "suppressed@example.com" },
    idempotencyKey: "idem_suppress_77",
  });
  assert.equal(dispatchSuppressed.status, "suppressed");
  assert.equal(dispatchSuppressed.errorCode, EmailErrorCode.SUPPRESSED);

  // Test 10: Webhook events and suppression sync
  await applyBrevoWebhookEvent({
    event: "spam",
    email: "spammer@example.com",
    id: 12345,
    date: new Date().toISOString(),
  });

  // spammer@example.com should be suppressed now
  const spammerSuppressed = await isSuppressed("spammer@example.com");
  assert.equal(spammerSuppressed, true);

  // Deduplicate check
  const webhookCounterBefore = await prisma.emailWebhookEvent.count();
  await applyBrevoWebhookEvent({
    event: "spam",
    email: "spammer@example.com",
    id: 12345, // Duplicate event ID
  });
  const webhookCounterAfter = await prisma.emailWebhookEvent.count();
  assert.equal(webhookCounterAfter, webhookCounterBefore); // No new events created

  // Test 11: listDispatches
  const dispatchesList = await listDispatches();
  assert.ok(dispatchesList.length >= 3);

  // Clean up temp test files
  if (existsSync(tempFilePath)) {
    rmSync(tempFilePath);
  }
});

test("email templates escape user-provided HTML fields", () => {
  const welcome = getTemplateHandler("welcome");
  assert.ok(welcome);
  const welcomeHtml = welcome.renderHtml({
    name: "<img src=x onerror=alert(1)>",
    email: "attacker@example.com",
  });
  assert.equal(welcomeHtml.includes("<img src=x onerror=alert(1)>"), false);
  assert.equal(welcomeHtml.includes("&lt;img src=x onerror=alert(1)&gt;"), true);

  const quota = getTemplateHandler("quota_exceeded");
  assert.ok(quota);
  const quotaHtml = quota.renderHtml({
    workspaceName: "Maps & <script>alert(1)</script>",
  });
  assert.equal(quotaHtml.includes("<script>alert(1)</script>"), false);
  assert.equal(quotaHtml.includes("Maps &amp; &lt;script&gt;alert(1)&lt;/script&gt;"), true);
});

test("Email Webhook route integration tests", async () => {
  const secret = "brevo_webhook_test_secret";
  process.env.BREVO_WEBHOOK_SECRET = secret;

  // Options route
  const options = await emailWebhookRoute({
    method: "OPTIONS",
    path: "/webhooks/brevo",
  });
  assert.equal(options.status, 204);

  // Head route
  const head = await emailWebhookRoute({
    method: "HEAD",
    path: "/webhooks/brevo",
  });
  assert.equal(head.status, 200);

  // Post without signature in production style (returns 401)
  const unauthenticatedPost = await emailWebhookRoute({
    method: "POST",
    path: "/webhooks/brevo",
    body: {
      event: "unsubscribe",
      email: "unsub@example.com",
      id: 99999,
    },
  });
  assert.equal(unauthenticatedPost.status, 401);

  // Post with valid signature
  const bodyObj = {
    event: "unsubscribe",
    email: "unsub@example.com",
    id: 99999,
  };
  const bodyText = JSON.stringify(bodyObj);
  const signature = createHmac("sha256", secret).update(bodyText).digest("hex");

  const authenticatedPost = await emailWebhookRoute({
    method: "POST",
    path: "/webhooks/brevo",
    body: bodyObj,
    headers: {
      "X-Brevo-Signature": signature,
    },
  });
  assert.equal(authenticatedPost.status, 200);

  // Check if email was suppressed
  const unsubSuppressed = await isSuppressed("unsub@example.com");
  assert.equal(unsubSuppressed, true);

  // Clean env var
  delete process.env.BREVO_WEBHOOK_SECRET;
});
