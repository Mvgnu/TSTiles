import { strict as assert } from "node:assert";
import { prisma } from "../../../config/db";
import { createProject, rotateApiKey } from "../../projects/projects.service";
import {
  consumeRequestUnit,
  computeBillingEstimate,
  getBillingPlan,
  getUsageSummary,
  listBillingPlans,
  recordDeliverySignal,
} from "../metering.service";
import { loadConfig } from "../../../config/load-config";
import { MeteringError, MeteringErrorCode, type BillingPlan, type UsageCounterWindow, type UsageSummary } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.NODE_ENV = "development";
process.env.ALLOWED_ORIGINS = "*";

loadConfig();

function makeProjectWithPolicy(policy?: Parameters<typeof createProject>[0]["policy"]): ReturnType<typeof createProject> {
  return createProject({
    name: `Metering Project ${Math.random().toString().slice(2)}`,
    workspaceId: `metering-workspace-${Math.random().toString().slice(2)}`,
    policy,
    planId: "pro",
  });
}

async function withFrozenTime<T>(isoTimestamp: string, fn: () => T | Promise<T>): Promise<T> {
  const fixedTimeMs = new Date(isoTimestamp).getTime();
  const previousNow = Date.now;
  Date.now = () => fixedTimeMs;
  try {
    return await fn();
  } finally {
    Date.now = previousNow;
  }
}

test("consumeRequestUnit allows and tracks usage", async () => {
  const project = makeProjectWithPolicy({
    quotas: {
      monthlyRequests: 2,
    },
  });
  const key = await rotateApiKey((await project).id);

  const allow = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "tiles",
  );

  const allowAgain = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "tiles",
  );

  assert.equal(allow.allow, true);
  assert.equal(typeof allow.remaining, "number");
  assert.equal(allowAgain.allow, true);

  const minuteSummary = await getUsageSummary((await project).id, "minute");
  const tileMinutes = minuteSummary.find((entry: UsageSummary) => entry.endpointGroup === "tiles");
  assert.equal(tileMinutes?.keyHash, (await key).keyHash);
  assert.equal(tileMinutes?.planId, (await project).planId);
  assert.equal(tileMinutes?.requestCount >= 2, true);

  const malformedProjectSummary = await getUsageSummary(`${(await project).id}|bad`, "minute");
  assert.equal(malformedProjectSummary.length, 0);

  const malformedWindowSummary = await getUsageSummary((await project).id, 42 as unknown as UsageCounterWindow);
  assert.equal(malformedWindowSummary.length, 0);

  const invalidWindowSummary = await getUsageSummary((await project).id, "year" as unknown as UsageCounterWindow);
  assert.equal(invalidWindowSummary.length, 0);
});

test("billing plan lookups expose stable plan metadata", async () => {
  const free = getBillingPlan("free");
  const fallback = getBillingPlan("unknown-plan");
  const paddedPro = getBillingPlan(" PRO ");
  const typedFallback = getBillingPlan(42 as unknown as string);
  const plans = listBillingPlans();

  assert.equal(free.planId, "free");
  assert.equal(free.freeAllowancePerMonth, 100_000);
  assert.equal(fallback.planId, "free");
  assert.equal(paddedPro.planId, "pro");
  assert.equal(typedFallback.planId, "free");
  assert.equal(plans.some((entry) => entry.planId === "free"), true);
  assert.equal(plans.some((entry) => entry.planId === "pro"), true);
});

test("consumeRequestUnit blocks after quotas are exceeded", async () => {
  const project = makeProjectWithPolicy({
    quotas: {
      dailyRequests: 1,
      monthlyRequests: 1,
    },
  });
  const key = await rotateApiKey((await project).id);

  const first = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "raster",
  );
  const second = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "raster",
  );

  assert.equal(first.allow, true);
  assert.equal(second.allow, false);
  assert.equal(second.denyReason, "quota");
});

test("consumeRequestUnit returns daily remaining/limit when only daily quota is configured", async () => {
  const project = makeProjectWithPolicy({
    quotas: {
      dailyRequests: 3,
    },
  });
  const key = await rotateApiKey((await project).id);

  const first = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "tiles",
  );
  const second = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "tiles",
  );

  assert.equal(first.allow, true);
  assert.equal(first.limit, 3);
  assert.equal(first.remaining, 2);
  assert.equal(second.allow, true);
  assert.equal(second.limit, 3);
  assert.equal(second.remaining, 1);
});

test("consumeRequestUnit reports rate limit when minute quota is exceeded", async () => {
  const project = makeProjectWithPolicy({
    quotas: {
      minuteRequests: 1,
    },
  });
  const key = await rotateApiKey((await project).id);

  const first = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "tiles",
  );
  const second = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "tiles",
  );

  assert.equal(first.allow, true);
  assert.equal(second.allow, false);
  assert.equal(second.denyReason, "rate_limit");
  assert.equal(second.limit, 1);
});

test("consumeRequestUnit enforces minute quota under concurrent requests", async () => {
  const project = makeProjectWithPolicy({
    quotas: {
      minuteRequests: 1,
      dailyRequests: 10,
      monthlyRequests: 10,
    },
  });
  const key = await rotateApiKey((await project).id);
  const identity = {
    projectId: (await key).projectId,
    keyHash: (await key).keyHash,
    planId: (await project).planId,
  };

  const decisions = await Promise.all([
    consumeRequestUnit(identity, "tiles"),
    consumeRequestUnit(identity, "tiles"),
  ]);
  const allowedCount = decisions.filter((decision) => decision.allow).length;
  const deniedCount = decisions.filter((decision) => !decision.allow).length;

  assert.equal(allowedCount, 1);
  assert.equal(deniedCount, 1);
  assert.equal(decisions.some((decision) => decision.denyReason === "rate_limit"), true);
});

test("consumeRequestUnit reports nearest quota window when multiple limits are configured", async () => {
  const project = makeProjectWithPolicy({
    quotas: {
      minuteRequests: 2,
      dailyRequests: 100,
      monthlyRequests: 1000,
    },
  });
  const key = await rotateApiKey((await project).id);
  const identity = {
    projectId: (await key).projectId,
    keyHash: (await key).keyHash,
    planId: (await project).planId,
  };

  const first = await consumeRequestUnit(identity, "tiles");
  const second = await consumeRequestUnit(identity, "tiles");
  const third = await consumeRequestUnit(identity, "tiles");

  assert.equal(first.allow, true);
  assert.equal(first.limit, 2);
  assert.equal(first.remaining, 1);
  assert.equal(second.allow, true);
  assert.equal(second.limit, 2);
  assert.equal(second.remaining, 0);
  assert.equal(third.allow, false);
  assert.equal(third.denyReason, "rate_limit");
  assert.equal(third.limit, 2);
});

test("getUsageSummary evicts stale buckets outside retention windows", async () => {
  const project = makeProjectWithPolicy({
    quotas: {
      monthlyRequests: 10,
    },
  });
  const key = await rotateApiKey((await project).id);
  const identity = {
    projectId: (await key).projectId,
    keyHash: (await key).keyHash,
    planId: (await project).planId,
  };
  const oldTimestamp = "2024-01-01T00:00:00.000Z";

  await withFrozenTime(oldTimestamp, async () => {
    const consumed = await consumeRequestUnit(identity, "tiles");
    assert.equal(consumed.allow, true);
    const oldSummary = await getUsageSummary((await project).id, "minute");
    assert.equal(oldSummary.length, 1);
  });

  await withFrozenTime("2026-03-01T00:00:00.000Z", async () => {
    const currentSummary = await getUsageSummary((await project).id, "minute");
    assert.equal(currentSummary.length, 0);
  });

  await withFrozenTime(oldTimestamp, async () => {
    const oldSummaryAfterCleanup = await getUsageSummary((await project).id, "minute");
    assert.equal(oldSummaryAfterCleanup.length, 0);
  });
});

test("consumeRequestUnit rejects endpoints blocked by policy", async () => {
  const project = makeProjectWithPolicy({
    allowedEndpoints: {
      tiles: true,
      raster: false,
      staticMaps: false,
    },
  });
  const key = await rotateApiKey((await project).id);

  const raster = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "raster",
  );

  assert.equal(raster.allow, false);
  assert.equal(raster.denyReason, "quota");
});

test("consumeRequestUnit allows raster when only raster endpoint is enabled", async () => {
  const project = makeProjectWithPolicy({
    allowedEndpoints: {
      tiles: false,
      raster: true,
      staticMaps: false,
    },
  });
  const key = await rotateApiKey((await project).id);

  const raster = await consumeRequestUnit({
    projectId: (await key).projectId,
    keyHash: (await key).keyHash,
    planId: (await project).planId,
  }, "raster");

  assert.equal(raster.allow, true);
  const tile = await consumeRequestUnit({
    projectId: (await key).projectId,
    keyHash: (await key).keyHash,
    planId: (await project).planId,
  }, "tiles");
  assert.equal(tile.allow, false);
});

test("consumeRequestUnit rejects malformed usage identities", async () => {
  const project = makeProjectWithPolicy({
    quotas: {
      monthlyRequests: 5,
    },
  });
  const key = await rotateApiKey((await project).id);

  const malformedPlan = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: "free|pro",
    },
    "tiles",
  );
  assert.equal(malformedPlan.allow, false);
  assert.equal(malformedPlan.denyReason, "quota");

  const malformedProject = await consumeRequestUnit(
    {
      projectId: `${(await key).projectId}|shadow`,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "tiles",
  );
  assert.equal(malformedProject.allow, false);
  assert.equal(malformedProject.denyReason, "quota");

  const malformedKeyHash = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: `${(await key).keyHash}/shadow`,
      planId: (await project).planId,
    },
    "tiles",
  );
  assert.equal(malformedKeyHash.allow, false);
  assert.equal(malformedKeyHash.denyReason, "quota");

  const paddedPlan = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: ` ${(await project).planId} `,
    },
    "tiles",
  );
  assert.equal(paddedPlan.allow, false);
  assert.equal(paddedPlan.denyReason, "quota");

  const dotProjectId = await consumeRequestUnit(
    {
      projectId: ".",
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "tiles",
  );
  assert.equal(dotProjectId.allow, false);
  assert.equal(dotProjectId.denyReason, "quota");

  const summary = await getUsageSummary((await project).id, "minute");
  assert.equal((await summary).length, 0);
});

test("consumeRequestUnit denies unknown endpoint groups and does not count usage", async () => {
  const project = makeProjectWithPolicy({
    quotas: {
      monthlyRequests: 5,
    },
  });
  const key = await rotateApiKey((await project).id);

  const denied = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    "vector",
  );

  assert.equal(denied.allow, false);
  assert.equal(denied.denyReason, "quota");

  const summary = await getUsageSummary((await project).id, "minute");
  assert.equal((await summary).length, 0);

  const typedDenied = await consumeRequestUnit(
    {
      projectId: (await key).projectId,
      keyHash: (await key).keyHash,
      planId: (await project).planId,
    },
    42 as unknown as string,
  );
  assert.equal(typedDenied.allow, false);
  assert.equal(typedDenied.denyReason, "quota");
});

test("consumeRequestUnit enforces global minute budget across endpoint groups", async () => {
  const originalGlobalBudget = process.env.GLOBAL_REQUEST_BUDGET_PER_MINUTE;
  process.env.GLOBAL_REQUEST_BUDGET_PER_MINUTE = "2";
  const project = makeProjectWithPolicy({
    quotas: {
      minuteRequests: 100,
      dailyRequests: 100,
      monthlyRequests: 100,
    },
  });
  const key = await rotateApiKey((await project).id);
  const identity = {
    projectId: (await key).projectId,
    keyHash: (await key).keyHash,
    planId: (await project).planId,
  };

  await withFrozenTime("2026-06-15T12:34:00.000Z", async () => {
    const first = await consumeRequestUnit(identity, "tiles");
    const second = await consumeRequestUnit(identity, "raster");
    const third = await consumeRequestUnit(identity, "static");
    assert.equal(first.allow, true);
    assert.equal(second.allow, true);
    assert.equal(third.allow, false);
    assert.equal(third.denyReason, "rate_limit");
    assert.equal(third.limit, 2);
  });

  if (originalGlobalBudget === undefined) {
    delete process.env.GLOBAL_REQUEST_BUDGET_PER_MINUTE;
  } else {
    process.env.GLOBAL_REQUEST_BUDGET_PER_MINUTE = originalGlobalBudget;
  }
});

test("computeBillingEstimate resolves plan from usage summary when no plan is provided", async () => {
  const summary: UsageSummary = {
    projectId: "project-1",
    keyHash: "key-1",
    planId: "pro",
    window: "month",
    bucket: "2026-02",
    endpointGroup: "tiles",
    requestCount: 150_000,
    unit: "request",
  };

  const estimate = computeBillingEstimate(summary);
  assert.equal(estimate.planId, "pro");
  assert.equal(estimate.requestCount, 150_000);
  assert.equal(estimate.billedUnits, 0);
  assert.equal(typeof estimate.estimatedCost, "number");
  assert.equal(estimate.currency, "USD");
});

test("computeBillingEstimate resolves plan case-insensitively from usage summary", async () => {
  const summary: UsageSummary = {
    projectId: "project-1",
    keyHash: "key-1",
    planId: "PRO",
    window: "month",
    bucket: "2026-02",
    endpointGroup: "tiles",
    requestCount: 150_000,
    unit: "request",
  };

  const estimate = computeBillingEstimate(summary);
  assert.equal(estimate.planId, "pro");
  assert.equal(estimate.freeAllowance, 500_000);
});

test("computeBillingEstimate accepts planId summaries with case-only differences", async () => {
  const estimate = computeBillingEstimate([
    {
      projectId: "project-1",
      keyHash: "key-1",
      planId: "PRO",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "tiles",
      requestCount: 50_000,
      unit: "request",
    },
    {
      projectId: "project-1",
      keyHash: "key-2",
      planId: "pro",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "raster",
      requestCount: 25_000,
      unit: "request",
    },
  ]);
  assert.equal(estimate.planId, "pro");
  assert.equal(estimate.requestCount, 75_000);
});

test("computeBillingEstimate rejects malformed request counts", () => {
  assert.throws(() => {
    computeBillingEstimate(null as unknown as Parameters<typeof computeBillingEstimate>[0]);
  }, /METERING_BAD_IDENTITY/);

  assert.throws(() => {
    computeBillingEstimate([42 as unknown as UsageSummary]);
  }, /METERING_BAD_IDENTITY/);

  assert.throws(() => {
    computeBillingEstimate({
      projectId: "project-1",
      keyHash: "key-1",
      planId: "pro",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "tiles",
      requestCount: -1,
      unit: "request",
    });
  }, /METERING_BAD_IDENTITY/);

  assert.throws(() => {
    computeBillingEstimate({
      projectId: "project-1",
      keyHash: "key-1",
      planId: "pro",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "tiles",
      requestCount: Number.NaN,
      unit: "request",
    });
  }, /METERING_BAD_IDENTITY/);
});

test("computeBillingEstimate accepts planId summaries with trim-and-case differences", async () => {
  const estimate = computeBillingEstimate([
    {
      projectId: "project-1",
      keyHash: "key-1",
      planId: " PRO ",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "tiles",
      requestCount: 50_000,
      unit: "request",
    },
    {
      projectId: "project-1",
      keyHash: "key-2",
      planId: "pro",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "raster",
      requestCount: 25_000,
      unit: "request",
    },
  ], {
    planId: " PRO ",
    freeAllowancePerMonth: 500_000,
    unitPricePerThousandRequests: 0.2,
    currency: "USD",
  });
  assert.equal(estimate.planId, " PRO ");
  assert.equal(estimate.requestCount, 75_000);
});

test("computeBillingEstimate rejects mixed planId summaries", async () => {
  assert.throws(() => {
    computeBillingEstimate([
      {
        projectId: "project-1",
        keyHash: "key-1",
        planId: "free",
        window: "month",
        bucket: "2026-02",
        endpointGroup: "tiles",
        requestCount: 10,
        unit: "request",
      },
      {
        projectId: "project-1",
        keyHash: "key-2",
        planId: "pro",
        window: "month",
        bucket: "2026-02",
        endpointGroup: "raster",
        requestCount: 20,
        unit: "request",
      },
    ]);
  }, /METERING_BAD_IDENTITY/);
});

test("computeBillingEstimate rejects explicit plan mismatch", async () => {
  assert.throws(() => {
    computeBillingEstimate(
      {
        projectId: "project-1",
        keyHash: "key-1",
        planId: "free",
        window: "month",
        bucket: "2026-02",
        endpointGroup: "tiles",
        requestCount: 100,
        unit: "request",
      },
      {
        planId: "pro",
        freeAllowancePerMonth: 500_000,
        unitPricePerThousandRequests: 0.2,
        currency: "USD",
      },
    );
  }, /METERING_BAD_IDENTITY/);
});

test("computeBillingEstimate rejects malformed explicit plan input", () => {
  assert.throws(() => {
    computeBillingEstimate({
      projectId: "project-1",
      keyHash: "key-1",
      planId: "free",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "tiles",
      requestCount: 100,
      unit: "request",
    }, null as unknown as BillingPlan);
  }, /METERING_BAD_IDENTITY/);

  assert.throws(() => {
    computeBillingEstimate({
      projectId: "project-1",
      keyHash: "key-1",
      planId: "free",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "tiles",
      requestCount: 100,
      unit: "request",
    }, { planId: 42 } as unknown as BillingPlan);
  }, /METERING_BAD_IDENTITY/);

  assert.throws(() => {
    computeBillingEstimate({
      projectId: "project-1",
      keyHash: "key-1",
      planId: "free",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "tiles",
      requestCount: 100,
      unit: "request",
    }, {
      planId: "free",
      freeAllowancePerMonth: Number.NaN,
      unitPricePerThousandRequests: 0.5,
      currency: "USD",
    });
  }, /METERING_BAD_IDENTITY/);

  assert.throws(() => {
    computeBillingEstimate({
      projectId: "project-1",
      keyHash: "key-1",
      planId: "free",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "tiles",
      requestCount: 100,
      unit: "request",
    }, {
      planId: "free",
      freeAllowancePerMonth: -1,
      unitPricePerThousandRequests: 0.5,
      currency: "USD",
    });
  }, /METERING_BAD_IDENTITY/);

  assert.throws(() => {
    computeBillingEstimate({
      projectId: "project-1",
      keyHash: "key-1",
      planId: "free",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "tiles",
      requestCount: 100,
      unit: "request",
    }, {
      planId: "free",
      freeAllowancePerMonth: 100_000,
      unitPricePerThousandRequests: Number.POSITIVE_INFINITY,
      currency: "USD",
    });
  }, /METERING_BAD_IDENTITY/);

  assert.throws(() => {
    computeBillingEstimate({
      projectId: "project-1",
      keyHash: "key-1",
      planId: "free",
      window: "month",
      bucket: "2026-02",
      endpointGroup: "tiles",
      requestCount: 100,
      unit: "request",
    }, {
      planId: "free",
      freeAllowancePerMonth: 100_000,
      unitPricePerThousandRequests: -0.5,
      currency: "USD",
    });
  }, /METERING_BAD_IDENTITY/);
});

test("computeBillingEstimate rejects mixed project summaries", async () => {
  assert.throws(() => {
    computeBillingEstimate([
      {
        projectId: "project-1",
        keyHash: "key-1",
        planId: "free",
        window: "month",
        bucket: "2026-02",
        endpointGroup: "tiles",
        requestCount: 10,
        unit: "request",
      },
      {
        projectId: "project-2",
        keyHash: "key-2",
        planId: "free",
        window: "month",
        bucket: "2026-02",
        endpointGroup: "raster",
        requestCount: 20,
        unit: "request",
      },
    ]);
  }, /METERING_BAD_IDENTITY/);
});

test("computeBillingEstimate rejects non-monthly usage windows", async () => {
  assert.throws(() => {
    computeBillingEstimate({
      projectId: "project-1",
      keyHash: "key-1",
      planId: "free",
      window: "day",
      bucket: "2026-02-20",
      endpointGroup: "tiles",
      requestCount: 500,
      unit: "request",
    });
  }, /METERING_BAD_IDENTITY/);
});

test("computeBillingEstimate throws typed MeteringError for invalid identity inputs", async () => {
  try {
    computeBillingEstimate({
      projectId: "project-1",
      keyHash: "key-1",
      planId: "free",
      window: "day",
      bucket: "2026-02-20",
      endpointGroup: "tiles",
      requestCount: 1,
      unit: "request",
    });
    assert.fail("expected metering bad identity error");
  } catch (error) {
    assert.equal(error instanceof MeteringError, true);
    if (error instanceof MeteringError) {
      assert.equal(error.code, MeteringErrorCode.BAD_IDENTITY);
      assert.equal(error.message.startsWith("METERING_BAD_IDENTITY"), true);
    }
  }
});

test("recordDeliverySignal is asynchronous and non-blocking", async () => {
  recordDeliverySignal({
    schemaVersion: 1,
    artifactVersion: "artifact-1",
    tilePath: "/1/2/3.mvt",
    cacheStatus: "miss",
    originRead: true,
    responseBytes: 12,
    latencyMs: 42,
    statusCode: 200,
    receivedAt: new Date().toISOString(),
    normalizedMethod: "GET",
  });

  recordDeliverySignal(null as unknown as Parameters<typeof recordDeliverySignal>[0]);
  recordDeliverySignal(42 as unknown as Parameters<typeof recordDeliverySignal>[0]);
  recordDeliverySignal({
    schemaVersion: 1,
    artifactVersion: 42 as unknown as string,
    tilePath: "/1/2/3.mvt",
    cacheStatus: "miss",
    originRead: true,
    responseBytes: 12,
    latencyMs: 42,
    statusCode: 200,
    receivedAt: new Date().toISOString(),
    normalizedMethod: "GET",
  } as unknown as Parameters<typeof recordDeliverySignal>[0]);

  const result = await new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, 0);
  });
  assert.equal(result, true);
});

test("getUsageSummary skips malformed persisted usage bucket rows", async () => {
  const originalFindMany = prisma.usageBucket.findMany.bind(prisma.usageBucket);

  (prisma.usageBucket as { findMany: typeof prisma.usageBucket.findMany }).findMany = ((async (...args: Parameters<typeof prisma.usageBucket.findMany>) => {
    const projectId = args[0]?.where && "projectId" in args[0].where ? args[0].where.projectId : undefined;
    if (projectId === "metering-bad-summary-project") {
      return [
        {
          projectId: "metering-bad-summary-project",
          keyHash: "key-valid",
          planId: "pro",
          window: "month",
          bucket: "2026-04",
          endpointGroup: "tiles",
          requestCount: 12,
        },
        {
          projectId: "metering-bad-summary-project",
          keyHash: "key/invalid",
          planId: "pro",
          window: "month",
          bucket: "2026-04",
          endpointGroup: "tiles",
          requestCount: 5,
        },
        {
          projectId: "metering-bad-summary-project",
          keyHash: "key-valid-2",
          planId: "pro",
          window: "year",
          bucket: "2026-04",
          endpointGroup: "tiles",
          requestCount: 5,
        },
      ];
    }
    return await originalFindMany(...args);
  }) as unknown) as typeof prisma.usageBucket.findMany;

  try {
    const summary = await getUsageSummary("metering-bad-summary-project", "month");
    assert.equal(summary.length, 1);
    assert.equal(summary[0]?.projectId, "metering-bad-summary-project");
    assert.equal(summary[0]?.requestCount, 12);
    assert.equal(summary[0]?.endpointGroup, "tiles");
  } finally {
    (prisma.usageBucket as { findMany: typeof prisma.usageBucket.findMany }).findMany = originalFindMany;
  }
});
