import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { identityDemoSignInRoute } from "../../identity/routes/demo-sign-in-route";
import { billingSummaryRoute } from "../routes/billing-route";
import { billingCheckoutRoute } from "../routes/checkout-route";
import { billingPortalRoute } from "../routes/portal-route";
import { stripeWebhookRoute } from "../routes/webhook-route";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

const originalFetch = globalThis.fetch;

function mockStripeFetch(payloads: Readonly<Record<string, Record<string, unknown>>>): () => void {
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url).pathname;
    const payload = payloads[path];
    if (!payload) {
      return new Response(JSON.stringify({
        error: {
          message: `unexpected stripe path ${path}`,
        },
      }), {
        status: 500,
        headers: {
          "content-type": "application/json",
        },
      });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function buildStripeSignature(body: string, secret: string, timestamp: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

process.env.STRIPE_SECRET_KEY = "sk_test_billing_routes";
process.env.STRIPE_PRICE_ID_PRO = "price_pro_test";
process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.NODE_ENV = "development";
process.env.ALLOWED_ORIGINS = "*";
process.env.ALLOWED_TILES_TOKENS = "billing-routes-tile-token";

async function issueBillingSession(workspaceId = "route-billing"): Promise<string> {
  const response = await identityDemoSignInRoute({
    method: "POST",
    path: "/auth/demo/sign-in",
    body: {
      userId: `billing-${workspaceId}`,
      workspaceId,
    },
  });
  const body = JSON.parse(response.body ?? "{}") as { token?: string };
  return body.token ?? "";
}

test("billing routes expose hosted checkout, mirrored billing, and portal flows", async () => {
  const restoreFetch = mockStripeFetch({
    "/v1/checkout/sessions": {
      id: "cs_route_123",
      url: "https://checkout.stripe.com/pay/cs_route_123",
      expires_at: 1772000000,
    },
    "/v1/billing_portal/sessions": {
      id: "bps_route_123",
      url: "https://billing.stripe.com/session/bps_route_123",
      created: 1772000300,
    },
  });
  try {
    const token = await issueBillingSession();
    const checkout = await billingCheckoutRoute({
      method: "POST",
      path: "/billing/checkout",
      headers: {
        "x-session-token": token,
        origin: "https://example.com",
      },
      body: {
        planId: "pro",
        successUrl: "https://example.com/app/billing?checkout=success",
        cancelUrl: "https://example.com/pricing?checkout=cancel",
      },
    });
    assert.equal(checkout.status, 201);
    const checkoutBody = JSON.parse(checkout.body ?? "{}") as { sessionId?: string; url?: string };
    const sessionId = checkoutBody.sessionId ?? "";
    assert.equal(sessionId.length > 0, true);
    assert.equal(checkoutBody.url?.includes("checkout.stripe.com"), true);

    const webhook = await stripeWebhookRoute({
      method: "POST",
      path: "/webhooks/stripe",
      body: {
        type: "checkout.session.completed",
        sessionId,
        stripeCustomerId: "cus_route",
      },
    });
    assert.equal(webhook.status, 200);

    const billing = await billingSummaryRoute({
      method: "GET",
      path: "/app-api/billing",
      headers: {
        "x-session-token": token,
      },
    });
    assert.equal(billing.status, 200);

    const portal = await billingPortalRoute({
      method: "POST",
      path: "/billing/portal",
      headers: {
        "x-session-token": token,
        origin: "https://example.com",
      },
      body: {
        returnUrl: "https://example.com/app/billing",
      },
    });
    assert.equal(portal.status, 201);
  } finally {
    restoreFetch();
  }
});

test("billing routes reject invalid methods and paths", async () => {
  const options = await billingCheckoutRoute({
    method: "OPTIONS",
    path: "/billing/checkout",
    headers: {},
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers["access-control-allow-headers"].includes("x-session-token"), true);
  assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-user-id"), false);
  assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-workspace-id"), false);

  const badPath = await stripeWebhookRoute({
    method: "POST",
    path: "/webhooks/other",
    headers: {},
    body: {},
  });
  assert.equal(badPath.status, 404);

  const unauthorized = await billingSummaryRoute({
    method: "GET",
    path: "/app-api/billing",
    headers: {},
  });
  assert.equal(unauthorized.status, 401);

  const malformedSummary = await billingSummaryRoute(
    null as unknown as Parameters<typeof billingSummaryRoute>[0],
  );
  assert.equal(malformedSummary.status, 400);

  const malformedCheckout = await billingCheckoutRoute({
    method: "POST",
    path: 42 as unknown as string,
    headers: {},
    body: {},
  });
  assert.equal(malformedCheckout.status, 400);

  const malformedCheckoutBody = await billingCheckoutRoute({
    method: "POST",
    path: "/billing/checkout",
    headers: {},
    body: "pro" as unknown as Record<string, unknown>,
  });
  assert.equal(malformedCheckoutBody.status, 400);

  const malformedPortalHeaders = await billingPortalRoute({
    method: "POST",
    path: "/billing/portal",
    headers: {
      origin: 42 as unknown as string,
    },
    body: {},
  });
  assert.equal(malformedPortalHeaders.status, 400);

  const malformedPortalBody = await billingPortalRoute({
    method: "POST",
    path: "/billing/portal",
    headers: {},
    body: "https://example.com/app/billing" as unknown as Record<string, unknown>,
  });
  assert.equal(malformedPortalBody.status, 400);

  const malformedWebhookHeaders = await stripeWebhookRoute({
    method: "POST",
    path: "/webhooks/stripe",
    headers: {
      "stripe-signature": 42 as unknown as string,
    },
    body: {},
  });
  assert.equal(malformedWebhookHeaders.status, 400);

  const webhookOptions = await stripeWebhookRoute({
    method: "OPTIONS",
    path: "/webhooks/stripe",
    headers: {},
  });
  assert.equal(webhookOptions.status, 204);
  assert.equal(webhookOptions.headers["access-control-allow-headers"].includes("stripe-signature"), true);
});

test("billing routes accept managed-auth header sessions when explicitly enabled", async () => {
  const restoreFetch = mockStripeFetch({
    "/v1/checkout/sessions": {
      id: "cs_route_managed_123",
      url: "https://checkout.stripe.com/pay/cs_route_managed_123",
      expires_at: 1772000000,
    },
    "/v1/billing_portal/sessions": {
      id: "bps_route_managed_123",
      url: "https://billing.stripe.com/session/bps_route_managed_123",
      created: 1772000300,
    },
  });
  const previousNodeEnv = process.env.NODE_ENV;
  const previousManagedMode = process.env.IDENTITY_MANAGED_AUTH_MODE;
  try {
    process.env.NODE_ENV = "production";
    process.env.IDENTITY_MANAGED_AUTH_MODE = "header";
    const options = await billingCheckoutRoute({
      method: "OPTIONS",
      path: "/billing/checkout",
      headers: {},
    });
    assert.equal(options.status, 204);
    assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-user-id"), true);
    assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-workspace-id"), true);
    assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-session-id"), true);

    const managedHeaders = {
      "x-auth-user-id": "managed-billing-user",
      "x-auth-email": "managed-billing@example.com",
      "x-auth-workspace-id": "managed-billing-workspace",
      "x-auth-workspace-name": "Managed Billing Workspace",
      "x-auth-role": "member",
    };

    const summary = await billingSummaryRoute({
      method: "GET",
      path: "/app-api/billing",
      headers: managedHeaders,
    });
    assert.equal(summary.status, 200);
    const summaryBody = JSON.parse(summary.body ?? "{}") as { workspaceId?: string; planId?: string };
    assert.equal(summaryBody.workspaceId, "managed-billing-workspace");
    assert.equal(summaryBody.planId, "free");

    const checkout = await billingCheckoutRoute({
      method: "POST",
      path: "/billing/checkout",
      headers: {
        ...managedHeaders,
        origin: "https://example.com",
      },
      body: {
        planId: "pro",
        successUrl: "https://example.com/app/billing?checkout=success",
        cancelUrl: "https://example.com/pricing?checkout=cancel",
      },
    });
    assert.equal(checkout.status, 201);
    const checkoutBody = JSON.parse(checkout.body ?? "{}") as { sessionId?: string; url?: string };
    assert.equal(checkoutBody.url?.includes("checkout.stripe.com"), true);

    const webhook = await stripeWebhookRoute({
      method: "POST",
      path: "/webhooks/stripe",
      body: {
        type: "checkout.session.completed",
        sessionId: checkoutBody.sessionId,
        stripeCustomerId: "cus_managed_billing",
      },
    });
    assert.equal(webhook.status, 200);

    const portal = await billingPortalRoute({
      method: "POST",
      path: "/billing/portal",
      headers: {
        ...managedHeaders,
        origin: "https://example.com",
      },
      body: {
        returnUrl: "https://example.com/app/billing",
      },
    });
    assert.equal(portal.status, 201);
    const portalBody = JSON.parse(portal.body ?? "{}") as { url?: string };
    assert.equal(portalBody.url?.includes("billing.stripe.com"), true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.IDENTITY_MANAGED_AUTH_MODE = previousManagedMode;
    restoreFetch();
  }
});

test("billing webhook route accepts raw Uint8Array bodies when Stripe signing is enabled", async () => {
  const previousWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_route_bytes";
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      workspaceId: "route-billing-bytes",
      stripeCustomerId: "cus_route_bytes",
      planId: "pro",
    });
    const timestamp = "1772000000";
    const signature = buildStripeSignature(payload, process.env.STRIPE_WEBHOOK_SECRET, timestamp);
    const webhook = await stripeWebhookRoute({
      method: "POST",
      path: "/webhooks/stripe",
      headers: {
        "stripe-signature": signature,
      },
      body: new TextEncoder().encode(payload),
    });
    assert.equal(webhook.status, 200);
    const body = JSON.parse(webhook.body ?? "{}") as { workspaceId?: string; planId?: string };
    assert.equal(body.workspaceId, "route-billing-bytes");
    assert.equal(body.planId, "pro");
  } finally {
    if (previousWebhookSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = previousWebhookSecret;
    }
  }
});

test("billing routes reject cross-origin and out-of-surface hosted redirects", async () => {
  const restoreFetch = mockStripeFetch({
    "/v1/checkout/sessions": {
      id: "cs_route_redirect_123",
      url: "https://checkout.stripe.com/pay/cs_route_redirect_123",
      expires_at: 1772000000,
    },
    "/v1/billing_portal/sessions": {
      id: "bps_route_redirect_123",
      url: "https://billing.stripe.com/session/bps_route_redirect_123",
      created: 1772000300,
    },
  });
  try {
    const token = await issueBillingSession("route-billing-redirect");
    const checkout = await billingCheckoutRoute({
      method: "POST",
      path: "/billing/checkout",
      headers: {
        "x-session-token": token,
        origin: "https://example.com",
      },
      body: {
        planId: "pro",
        successUrl: "https://evil.example/app/billing?checkout=success",
        cancelUrl: "https://example.com/pricing?checkout=cancel",
      },
    });
    assert.equal(checkout.status, 400);
    const checkoutBody = JSON.parse(checkout.body ?? "{}") as { code?: string; error?: string };
    assert.equal(checkoutBody.code, "BILLING_SYNC_BAD_REQUEST");
    assert.equal(checkoutBody.error, "successUrl must stay on the current app origin");

    const webhook = await stripeWebhookRoute({
      method: "POST",
      path: "/webhooks/stripe",
      body: {
        type: "checkout.session.completed",
        workspaceId: "route-billing-redirect",
        stripeCustomerId: "cus_route_redirect",
      },
    });
    assert.equal(webhook.status, 400);
    const webhookBody = JSON.parse(webhook.body ?? "{}") as { code?: string; error?: string };
    assert.equal(webhookBody.code, "BILLING_SYNC_BAD_REQUEST");
    assert.equal(webhookBody.error, "planId is required for checkout completion events");

    const portal = await billingPortalRoute({
      method: "POST",
      path: "/billing/portal",
      headers: {
        "x-session-token": token,
        origin: "https://example.com",
      },
      body: {
        returnUrl: "https://example.com/docs/openapi.json",
      },
    });
    assert.equal(portal.status, 400);
    const portalBody = JSON.parse(portal.body ?? "{}") as { code?: string; error?: string };
    assert.equal(portalBody.code, "BILLING_SYNC_BAD_REQUEST");
    assert.equal(portalBody.error, "returnUrl must target /app or /pricing");
  } finally {
    restoreFetch();
  }
});

test("billing routes accept forwarded host origin fallback and reject malformed forwarded host values", async () => {
  const restoreFetch = mockStripeFetch({
    "/v1/checkout/sessions": {
      id: "cs_route_forwarded_123",
      url: "https://checkout.stripe.com/pay/cs_route_forwarded_123",
      expires_at: 1772000000,
    },
  });
  try {
    const token = await issueBillingSession("route-billing-forwarded");
    const checkout = await billingCheckoutRoute({
      method: "POST",
      path: "/billing/checkout",
      headers: {
        "x-session-token": token,
        "x-forwarded-proto": "https",
        "x-forwarded-host": "proxy.example.com",
      },
      body: {
        planId: "pro",
        successUrl: "https://proxy.example.com/app/billing?checkout=success",
        cancelUrl: "https://proxy.example.com/pricing?checkout=cancel",
      },
    });
    assert.equal(checkout.status, 201);

    const malformedForwardedHost = await billingCheckoutRoute({
      method: "POST",
      path: "/billing/checkout",
      headers: {
        "x-session-token": token,
        "x-forwarded-proto": "https",
        "x-forwarded-host": "proxy.example.com/app",
      },
      body: {
        planId: "pro",
        successUrl: "https://proxy.example.com/app/billing?checkout=success",
        cancelUrl: "https://proxy.example.com/pricing?checkout=cancel",
      },
    });
    assert.equal(malformedForwardedHost.status, 400);
    const malformedBody = JSON.parse(malformedForwardedHost.body ?? "{}") as { code?: string; error?: string };
    assert.equal(malformedBody.code, "BILLING_SYNC_BAD_REQUEST");
    assert.equal(malformedBody.error, "host header must resolve to a clean http(s) origin");
  } finally {
    restoreFetch();
  }
});

test("billing webhook route accepts signed Stripe event envelopes", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_route_test";
  try {
    const payload = JSON.stringify({
      id: `evt_route_${Math.random().toString(16).slice(2, 10)}`,
      type: "customer.subscription.updated",
      created: 1773000000,
      data: {
        object: {
          id: "sub_route_123",
          customer: "cus_route_signed",
          status: "active",
          current_period_end: 1775000000,
          cancel_at_period_end: false,
          metadata: {
            workspaceId: "route-billing-signed",
            planId: "pro",
          },
          items: {
            data: [{
              price: {
                id: "price_pro_test",
              },
            }],
          },
        },
      },
    });
    const signature = buildStripeSignature(payload, "whsec_route_test", "1773000000");
    const response = await stripeWebhookRoute({
      method: "POST",
      path: "/webhooks/stripe",
      headers: {
        "stripe-signature": signature,
      },
      body: payload,
    });
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body ?? "{}") as { planId?: string; stripeSubscriptionId?: string };
    assert.equal(body.planId, "pro");
    assert.equal(body.stripeSubscriptionId, "sub_route_123");

    const mixedCaseHeaderResponse = await stripeWebhookRoute({
      method: "POST",
      path: "/webhooks/stripe",
      headers: {
        "Stripe-Signature": signature,
      },
      body: payload,
    });
    assert.equal(mixedCaseHeaderResponse.status, 200);
  } finally {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
});

test("billing webhook route maps invoice envelopes into mirrored period-end data", async () => {
  const payload = {
    id: `evt_route_invoice_${Math.random().toString(16).slice(2, 10)}`,
    type: "invoice.paid",
    created: 1773000100,
    data: {
      object: {
        id: "in_123",
        customer: "cus_route_invoice",
        subscription: "sub_route_invoice",
        customer_email: "invoice@example.com",
        metadata: {
          workspaceId: "route-billing-invoice",
          planId: "pro",
        },
        lines: {
          data: [{
            price: {
              id: "price_pro_test",
            },
            period: {
              end: 1776000000,
            },
          }],
        },
      },
    },
  };

  const response = await stripeWebhookRoute({
    method: "POST",
    path: "/webhooks/stripe",
    body: payload,
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body ?? "{}") as {
    planId?: string;
    billingEmail?: string;
    currentPeriodEnd?: string;
    subscriptionStatus?: string;
  };
  assert.equal(body.planId, "pro");
  assert.equal(body.billingEmail, "invoice@example.com");
  assert.equal(body.currentPeriodEnd, "2026-04-12T13:20:00.000Z");
  assert.equal(body.subscriptionStatus, "active");
});
