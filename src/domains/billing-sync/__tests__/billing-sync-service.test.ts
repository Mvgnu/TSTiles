import { strict as assert } from "node:assert";
import { prisma } from "../../../config/db";
import { createProject, listProjectsByWorkspace } from "../../projects/projects.service";
import {
  applyStripeWebhookEvent,
  createBillingPortalSession,
  createCheckoutSession,
  getWorkspaceBilling,
} from "../billing-sync.service";
import { BillingSyncError, BillingSyncErrorCode } from "../types";

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

process.env.STRIPE_SECRET_KEY = "sk_test_billing_sync";
process.env.STRIPE_PRICE_ID_PRO = "price_pro_test";
process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.NODE_ENV = "development";
process.env.ALLOWED_ORIGINS = "*";
process.env.ALLOWED_TILES_TOKENS = "billing-sync-tile-token";

test("unknown workspaces default to free billing state", async () => {
  const snapshot = await getWorkspaceBilling("workspace-free");
  assert.equal(snapshot.workspaceId, "workspace-free");
  assert.equal(snapshot.planId, "free");
  assert.equal(snapshot.subscriptionStatus, "free");
  assert.equal(snapshot.cancelAtPeriodEnd, false);
});

test("checkout completion and subscription updates hydrate billing state", async () => {
  const restoreFetch = mockStripeFetch({
    "/v1/checkout/sessions": {
      id: "cs_paid_123",
      url: "https://checkout.stripe.com/pay/cs_paid_123",
      expires_at: 1770000000,
    },
    "/v1/billing_portal/sessions": {
      id: "bps_paid_123",
      url: "https://billing.stripe.com/session/bps_paid_123",
      created: 1770000300,
    },
  });
  try {
    const checkout = await createCheckoutSession({
      workspaceId: "workspace-paid",
      planId: "pro",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });

    const afterCheckout = await applyStripeWebhookEvent({
      type: "checkout.session.completed",
      sessionId: checkout.sessionId,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_checkout_123",
      billingEmail: "billing@example.com",
      occurredAt: "2026-03-06T10:00:00.000Z",
    });
    assert.equal(afterCheckout.subscriptionStatus, "checkout_pending");
    assert.equal(afterCheckout.planId, "pro");
    assert.equal(afterCheckout.stripeCustomerId, "cus_123");
    assert.equal(afterCheckout.stripeSubscriptionId, "sub_checkout_123");

    const afterSubscription = await applyStripeWebhookEvent({
      type: "customer.subscription.created",
      workspaceId: "workspace-paid",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      planId: "pro",
      subscriptionStatus: "active",
      currentPeriodEnd: "2026-04-01T00:00:00.000Z",
      occurredAt: "2026-03-06T10:01:00.000Z",
    });
    assert.equal(afterSubscription.subscriptionStatus, "active");
    assert.equal(afterSubscription.stripeSubscriptionId, "sub_123");
    assert.equal(afterSubscription.currentPeriodEnd, "2026-04-01T00:00:00.000Z");

    const portal = await createBillingPortalSession({
      workspaceId: "workspace-paid",
      returnUrl: "https://example.com/app/billing",
    });
    assert.equal(portal.workspaceId, "workspace-paid");
    assert.equal(portal.url.includes("billing.stripe.com"), true);
  } finally {
    restoreFetch();
  }
});

test("invoice and cancellation events update mirrored status", async () => {
  await createProject({
    name: "Workspace Status One",
    workspaceId: "workspace-status",
    planId: "free",
  });
  await createProject({
    name: "Workspace Status Two",
    workspaceId: "workspace-status",
    planId: "free",
  });
  const restoreFetch = mockStripeFetch({
    "/v1/checkout/sessions": {
      id: "cs_status_123",
      url: "https://checkout.stripe.com/pay/cs_status_123",
      expires_at: 1771000000,
    },
  });
  try {
    await createCheckoutSession({
      workspaceId: "workspace-status",
      planId: "pro",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
  } finally {
    restoreFetch();
  }
  await applyStripeWebhookEvent({
    type: "customer.subscription.updated",
    workspaceId: "workspace-status",
    stripeCustomerId: "cus_status",
    stripeSubscriptionId: "sub_status",
    planId: "pro",
    subscriptionStatus: "active",
  });
  assert.equal((await listProjectsByWorkspace("workspace-status")).every((entry) => entry.planId === "pro"), true);

  const pastDue = await applyStripeWebhookEvent({
    type: "invoice.payment_failed",
    workspaceId: "workspace-status",
    stripeCustomerId: "cus_status",
    stripeSubscriptionId: "sub_status",
  });
  assert.equal(pastDue.subscriptionStatus, "past_due");

  const recovered = await applyStripeWebhookEvent({
    type: "invoice.paid",
    workspaceId: "workspace-status",
    stripeCustomerId: "cus_status",
    stripeSubscriptionId: "sub_status",
    billingEmail: "billing-status@example.com",
    currentPeriodEnd: "2026-05-01T00:00:00.000Z",
  });
  assert.equal(recovered.subscriptionStatus, "active");
  assert.equal(recovered.billingEmail, "billing-status@example.com");
  assert.equal(recovered.currentPeriodEnd, "2026-05-01T00:00:00.000Z");

  const recoveredWithBlankEmail = await applyStripeWebhookEvent({
    type: "invoice.paid",
    workspaceId: "workspace-status",
    stripeCustomerId: "cus_status",
    stripeSubscriptionId: "sub_status",
    billingEmail: "   ",
  });
  assert.equal(recoveredWithBlankEmail.subscriptionStatus, "active");
  assert.equal(recoveredWithBlankEmail.billingEmail, "billing-status@example.com");

  const recoveredWithBlankOptionalWebhookFields = await applyStripeWebhookEvent({
    type: "invoice.paid",
    workspaceId: "workspace-status",
    stripeCustomerId: "   ",
    stripeSubscriptionId: "   ",
    currentPeriodEnd: "   ",
    occurredAt: "   ",
  });
  assert.equal(recoveredWithBlankOptionalWebhookFields.subscriptionStatus, "active");
  assert.equal(recoveredWithBlankOptionalWebhookFields.stripeCustomerId, "cus_status");
  assert.equal(recoveredWithBlankOptionalWebhookFields.stripeSubscriptionId, "sub_status");
  assert.equal(recoveredWithBlankOptionalWebhookFields.currentPeriodEnd, "2026-05-01T00:00:00.000Z");
  assert.equal(recoveredWithBlankOptionalWebhookFields.billingEmail, "billing-status@example.com");

  const canceled = await applyStripeWebhookEvent({
    type: "customer.subscription.deleted",
    workspaceId: "workspace-status",
    stripeCustomerId: "cus_status",
    stripeSubscriptionId: "sub_status",
  });
  assert.equal(canceled.subscriptionStatus, "canceled");
  assert.equal(canceled.planId, "free");
  assert.equal(canceled.cancelAtPeriodEnd, false);
  assert.equal((await listProjectsByWorkspace("workspace-status")).every((entry) => entry.planId === "free"), true);
});

test("invoice.paid can recover a free workspace into an active paid snapshot and sync project plans", async () => {
  await createProject({
    name: "Workspace Invoice Recovery One",
    workspaceId: "workspace-invoice-recovery",
    planId: "free",
  });
  await createProject({
    name: "Workspace Invoice Recovery Two",
    workspaceId: "workspace-invoice-recovery",
    planId: "free",
  });

  const recovered = await applyStripeWebhookEvent({
    type: "invoice.paid",
    workspaceId: "workspace-invoice-recovery",
    stripeCustomerId: "cus_invoice_recovery",
    stripeSubscriptionId: "sub_invoice_recovery",
    planId: "pro",
    billingEmail: "recovery@example.com",
    currentPeriodEnd: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(recovered.planId, "pro");
  assert.equal(recovered.subscriptionStatus, "active");
  assert.equal(recovered.billingEmail, "recovery@example.com");
  assert.equal((await listProjectsByWorkspace("workspace-invoice-recovery")).every((entry) => entry.planId === "pro"), true);
});

test("billing sync validates inputs and portal availability", async () => {
  await assert.rejects(async () => {
    await createCheckoutSession({
      workspaceId: "workspace-invalid",
      planId: "enterprise",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
  }, /BILLING_SYNC_BAD_REQUEST|METERING_BAD_IDENTITY/);

  await assert.rejects(async () => {
    await createBillingPortalSession({
      workspaceId: "workspace-free",
      returnUrl: "https://example.com/app",
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.CONFLICT);
    }
    return true;
  });
});

test("billing sync service fails closed on non-string direct inputs", async () => {
  await assert.rejects(async () => {
    await createCheckoutSession(null as unknown as Parameters<typeof createCheckoutSession>[0]);
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "checkout session input is required");
    }
    return true;
  });

  await assert.rejects(async () => {
    await createBillingPortalSession(null as unknown as Parameters<typeof createBillingPortalSession>[0]);
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "billing portal input is required");
    }
    return true;
  });

  await assert.rejects(async () => {
    await applyStripeWebhookEvent(null as unknown as Parameters<typeof applyStripeWebhookEvent>[0]);
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "stripe webhook event is required");
    }
    return true;
  });

  await assert.rejects(async () => {
    await getWorkspaceBilling(123 as unknown as string);
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "workspaceId must be a string");
    }
    return true;
  });

  await assert.rejects(async () => {
    await createCheckoutSession({
      workspaceId: "workspace-non-string-url",
      planId: "pro",
      successUrl: { href: "https://example.com/success" } as unknown as string,
      cancelUrl: "https://example.com/cancel",
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "successUrl must be a string");
    }
    return true;
  });

  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: "invoice.paid",
      workspaceId: "workspace-non-string-date",
      planId: "pro",
      currentPeriodEnd: 1776000000 as unknown as string,
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "currentPeriodEnd must be a string");
    }
    return true;
  });

  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: "customer.subscription.updated",
      workspaceId: "workspace-non-boolean-cancel",
      planId: "pro",
      subscriptionStatus: "active",
      cancelAtPeriodEnd: "true" as unknown as boolean,
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "cancelAtPeriodEnd must be boolean");
    }
    return true;
  });

  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: 42 as unknown as Parameters<typeof applyStripeWebhookEvent>[0]["type"],
      workspaceId: "workspace-non-string-type",
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "type must be a string");
    }
    return true;
  });

  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: "customer.subscription.updated",
      workspaceId: "workspace-non-string-status",
      planId: "pro",
      subscriptionStatus: 42 as unknown as Parameters<typeof applyStripeWebhookEvent>[0]["subscriptionStatus"],
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "subscriptionStatus must be a string");
    }
    return true;
  });

  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: "invoice.paid",
      workspaceId: "workspace-non-string-email",
      planId: "pro",
      billingEmail: 42 as unknown as Parameters<typeof applyStripeWebhookEvent>[0]["billingEmail"],
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "billingEmail must be a string");
    }
    return true;
  });
});

test("hosted Stripe session responses must return absolute http(s) urls", async () => {
  const restoreFetch = mockStripeFetch({
    "/v1/checkout/sessions": {
      id: "cs_bad_url",
      url: "javascript:alert('xss')",
      expires_at: 1770000000,
    },
    "/v1/billing_portal/sessions": {
      id: "bps_bad_url",
      url: "/portal/session/bps_bad_url",
      created: 1770000300,
    },
  });

  try {
    await assert.rejects(async () => {
      await createCheckoutSession({
        workspaceId: "workspace-bad-checkout-url",
        planId: "pro",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      });
    }, (error: unknown) => {
      assert.equal(error instanceof BillingSyncError, true);
      if (error instanceof BillingSyncError) {
        assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
        assert.equal(error.details, "stripe checkout session url must be an absolute http(s) URL");
      }
      return true;
    });

    await applyStripeWebhookEvent({
      type: "customer.subscription.updated",
      workspaceId: "workspace-bad-portal-url",
      stripeCustomerId: "cus_bad_portal_url",
      stripeSubscriptionId: "sub_bad_portal_url",
      planId: "pro",
      subscriptionStatus: "active",
    });

    await assert.rejects(async () => {
      await createBillingPortalSession({
        workspaceId: "workspace-bad-portal-url",
        returnUrl: "https://example.com/app/billing",
      });
    }, (error: unknown) => {
      assert.equal(error instanceof BillingSyncError, true);
      if (error instanceof BillingSyncError) {
        assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
        assert.equal(error.details, "stripe billing portal session url must be an absolute http(s) URL");
      }
      return true;
    });
  } finally {
    restoreFetch();
  }
});

test("checkout completion fails closed when no paid plan can be resolved", async () => {
  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: "checkout.session.completed",
      workspaceId: "workspace-checkout-free",
      stripeCustomerId: "cus_checkout_free",
      occurredAt: "2026-03-06T10:00:00.000Z",
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "planId is required for checkout completion events");
    }
    return true;
  });
});

test("billing sync service rejects malformed identifiers and invalid mirrored webhook plan ids", async () => {
  await assert.rejects(async () => {
    await getWorkspaceBilling("workspace/invalid");
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "workspaceId contains unsupported characters");
    }
    return true;
  });

  await assert.rejects(async () => {
    await createCheckoutSession({
      workspaceId: "..",
      planId: "pro",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "workspaceId contains unsupported characters");
    }
    return true;
  });

  await assert.rejects(async () => {
    await createCheckoutSession({
      workspaceId: "workspace..invalid",
      planId: "pro",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "workspaceId contains unsupported characters");
    }
    return true;
  });

  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: "invoice.payment_failed",
      workspaceId: "workspace-invalid-plan",
      stripeCustomerId: "cus..invalid",
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "stripeCustomerId contains unsupported characters");
    }
    return true;
  });

  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: "invoice.payment_failed",
      workspaceId: "workspace-invalid-plan",
      planId: "enterprise",
    });
  }, /BILLING_SYNC_BAD_REQUEST|METERING_BAD_IDENTITY/);

  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: "customer.subscription.created",
      workspaceId: "workspace-missing-subscription-plan",
      stripeCustomerId: "cus_missing_plan",
      stripeSubscriptionId: "sub_missing_plan",
      subscriptionStatus: "active",
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "planId is required for subscription events");
    }
    return true;
  });

  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: "invoice.payment_failed",
      workspaceId: "workspace-missing-invoice-plan",
      stripeCustomerId: "cus_missing_invoice_plan",
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "planId is required for invoice events");
    }
    return true;
  });

  await assert.rejects(async () => {
    await applyStripeWebhookEvent({
      type: "invoice.paid",
      workspaceId: "workspace-missing-invoice-plan-paid",
      stripeCustomerId: "cus_missing_invoice_plan_paid",
      billingEmail: "missing-plan@example.com",
    });
  }, (error: unknown) => {
    assert.equal(error instanceof BillingSyncError, true);
    if (error instanceof BillingSyncError) {
      assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
      assert.equal(error.details, "planId is required for invoice events");
    }
    return true;
  });
});

test("billing snapshot reads fail closed on malformed persisted state", async () => {
  const originalUpsert = prisma.billingSnapshot.upsert.bind(prisma.billingSnapshot);

  (prisma.billingSnapshot as { upsert: typeof prisma.billingSnapshot.upsert }).upsert = ((async (...args: Parameters<typeof prisma.billingSnapshot.upsert>) => {
    const workspaceId = args[0]?.where && "workspaceId" in args[0].where ? args[0].where.workspaceId : undefined;
    if (workspaceId === "workspace-broken-snapshot-plan") {
      return {
        workspaceId: "workspace-broken-snapshot-plan",
        planId: "enterprise",
        subscriptionStatus: "free",
        cancelAtPeriodEnd: false,
      };
    }
    if (workspaceId === "workspace-broken-snapshot-status") {
      return {
        workspaceId: "workspace-broken-snapshot-status",
        planId: "free",
        subscriptionStatus: "floating",
        cancelAtPeriodEnd: false,
      };
    }
    return await originalUpsert(...args);
  }) as unknown) as typeof prisma.billingSnapshot.upsert;

  try {
    await assert.rejects(async () => {
      await getWorkspaceBilling("workspace-broken-snapshot-plan");
    }, (error: unknown) => {
      assert.equal(error instanceof BillingSyncError, true);
      if (error instanceof BillingSyncError) {
        assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
        assert.equal(error.details, "planId is not recognized");
      }
      return true;
    });

    await assert.rejects(async () => {
      await getWorkspaceBilling("workspace-broken-snapshot-status");
    }, (error: unknown) => {
      assert.equal(error instanceof BillingSyncError, true);
      if (error instanceof BillingSyncError) {
        assert.equal(error.code, BillingSyncErrorCode.BAD_REQUEST);
        assert.equal(error.details, "stored subscriptionStatus is not recognized");
      }
      return true;
    });
  } finally {
    (prisma.billingSnapshot as { upsert: typeof prisma.billingSnapshot.upsert }).upsert = originalUpsert;
  }
});

test("duplicate Stripe webhook deliveries are deduped by event id", async () => {
  const workspaceId = `workspace-dedup-${Math.random().toString(16).slice(2, 8)}`;
  const eventId = `evt_dedup_${Math.random().toString(16).slice(2, 10)}`;
  const first = await applyStripeWebhookEvent({
    type: "customer.subscription.updated",
    id: eventId,
    workspaceId,
    stripeCustomerId: `cus_${workspaceId}`,
    stripeSubscriptionId: `sub_${workspaceId}`,
    planId: "pro",
    subscriptionStatus: "active",
    occurredAt: "2026-04-01T00:00:00.000Z",
  });
  assert.equal(first.subscriptionStatus, "active");
  assert.equal(first.lastWebhookAt, "2026-04-01T00:00:00.000Z");

  // Replay the same event id; even with a stale-looking older occurredAt the
  // dedup check must short-circuit before any persistence runs.
  const replay = await applyStripeWebhookEvent({
    type: "customer.subscription.updated",
    id: eventId,
    workspaceId,
    stripeCustomerId: `cus_${workspaceId}`,
    stripeSubscriptionId: `sub_${workspaceId}`,
    planId: "pro",
    subscriptionStatus: "past_due",
    occurredAt: "2026-04-02T00:00:00.000Z",
  });
  // Replay returns the persisted snapshot unchanged: status stays active.
  assert.equal(replay.subscriptionStatus, "active");
  assert.equal(replay.lastWebhookAt, "2026-04-01T00:00:00.000Z");
});

test("out-of-order Stripe webhooks do not overwrite newer state", async () => {
  const workspaceId = `workspace-ordering-${Math.random().toString(16).slice(2, 8)}`;
  const fresh = await applyStripeWebhookEvent({
    type: "customer.subscription.updated",
    id: `evt_fresh_${Math.random().toString(16).slice(2, 10)}`,
    workspaceId,
    stripeCustomerId: `cus_${workspaceId}`,
    stripeSubscriptionId: `sub_${workspaceId}`,
    planId: "pro",
    subscriptionStatus: "active",
    occurredAt: "2026-04-10T00:00:00.000Z",
  });
  assert.equal(fresh.lastWebhookAt, "2026-04-10T00:00:00.000Z");

  const stale = await applyStripeWebhookEvent({
    type: "invoice.payment_failed",
    id: `evt_stale_${Math.random().toString(16).slice(2, 10)}`,
    workspaceId,
    stripeCustomerId: `cus_${workspaceId}`,
    stripeSubscriptionId: `sub_${workspaceId}`,
    planId: "pro",
    occurredAt: "2026-04-09T00:00:00.000Z",
  });
  // Stale webhook returns current snapshot without persisting past_due over
  // the active state from the newer webhook.
  assert.equal(stale.subscriptionStatus, "active");
  assert.equal(stale.lastWebhookAt, "2026-04-10T00:00:00.000Z");
});
