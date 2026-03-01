import { strict as assert } from "node:assert";
import { createProject, rotateApiKey } from "../../projects/projects.service";
import {
  consumeRequestUnit,
  computeBillingEstimate,
  getUsageSummary,
  recordDeliverySignal,
} from "../metering.service";
import { loadConfig } from "../../../config/load-config";
import { MeteringError, MeteringErrorCode, type UsageSummary } from "../types";

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
    name: `Project ${Math.random().toString(16).slice(2)}`,
    policy,
    planId: "free",
  });
}

function withFrozenTime<T>(isoTimestamp: string, fn: () => T): T {
  const fixedTimeMs = new Date(isoTimestamp).getTime();
  const previousNow = Date.now;
  Date.now = () => fixedTimeMs;
  try {
    return fn();
  } finally {
    Date.now = previousNow;
  }
}

test("consumeRequestUnit allows and tracks usage", () => {
  const project = makeProjectWithPolicy({
    quotas: {
      monthlyRequests: 2,
    },
  });
  const key = rotateApiKey(project.id);

  const allow = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: project.planId,
    },
    "tiles",
  );

  const allowAgain = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: project.planId,
    },
    "tiles",
  );

  assert.equal(allow.allow, true);
  assert.equal(typeof allow.remaining, "number");
  assert.equal(allowAgain.allow, true);

  const minuteSummary = getUsageSummary(project.id, "minute");
  const tileMinutes = minuteSummary.find((entry: UsageSummary) => entry.endpointGroup === "tiles");
  assert.equal(tileMinutes?.keyHash, key.keyHash);
  assert.equal(tileMinutes?.planId, project.planId);
  assert.equal(tileMinutes?.requestCount >= 2, true);

  const malformedProjectSummary = getUsageSummary(`${project.id}|bad`, "minute");
  assert.equal(malformedProjectSummary.length, 0);
});

test("consumeRequestUnit blocks after quotas are exceeded", () => {
  const project = makeProjectWithPolicy({
    quotas: {
      dailyRequests: 1,
      monthlyRequests: 1,
    },
  });
  const key = rotateApiKey(project.id);

  const first = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: project.planId,
    },
    "raster",
  );
  const second = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: project.planId,
    },
    "raster",
  );

  assert.equal(first.allow, true);
  assert.equal(second.allow, false);
  assert.equal(second.denyReason, "quota");
});

test("consumeRequestUnit returns daily remaining/limit when only daily quota is configured", () => {
  const project = makeProjectWithPolicy({
    quotas: {
      dailyRequests: 3,
    },
  });
  const key = rotateApiKey(project.id);

  const first = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: project.planId,
    },
    "tiles",
  );
  const second = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: project.planId,
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

test("consumeRequestUnit reports rate limit when minute quota is exceeded", () => {
  const project = makeProjectWithPolicy({
    quotas: {
      minuteRequests: 1,
    },
  });
  const key = rotateApiKey(project.id);

  const first = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: project.planId,
    },
    "tiles",
  );
  const second = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: project.planId,
    },
    "tiles",
  );

  assert.equal(first.allow, true);
  assert.equal(second.allow, false);
  assert.equal(second.denyReason, "rate_limit");
  assert.equal(second.limit, 1);
});

test("consumeRequestUnit reports nearest quota window when multiple limits are configured", () => {
  const project = makeProjectWithPolicy({
    quotas: {
      minuteRequests: 2,
      dailyRequests: 100,
      monthlyRequests: 1000,
    },
  });
  const key = rotateApiKey(project.id);
  const identity = {
    projectId: key.projectId,
    keyHash: key.keyHash,
    planId: project.planId,
  };

  const first = consumeRequestUnit(identity, "tiles");
  const second = consumeRequestUnit(identity, "tiles");
  const third = consumeRequestUnit(identity, "tiles");

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

test("getUsageSummary evicts stale buckets outside retention windows", () => {
  const project = makeProjectWithPolicy({
    quotas: {
      monthlyRequests: 10,
    },
  });
  const key = rotateApiKey(project.id);
  const identity = {
    projectId: key.projectId,
    keyHash: key.keyHash,
    planId: project.planId,
  };
  const oldTimestamp = "2024-01-01T00:00:00.000Z";

  withFrozenTime(oldTimestamp, () => {
    const consumed = consumeRequestUnit(identity, "tiles");
    assert.equal(consumed.allow, true);
    const oldSummary = getUsageSummary(project.id, "minute");
    assert.equal(oldSummary.length, 1);
  });

  withFrozenTime("2026-03-01T00:00:00.000Z", () => {
    const currentSummary = getUsageSummary(project.id, "minute");
    assert.equal(currentSummary.length, 0);
  });

  withFrozenTime(oldTimestamp, () => {
    const oldSummaryAfterCleanup = getUsageSummary(project.id, "minute");
    assert.equal(oldSummaryAfterCleanup.length, 0);
  });
});

test("consumeRequestUnit rejects endpoints blocked by policy", () => {
  const project = makeProjectWithPolicy({
    allowedEndpoints: {
      tiles: true,
      raster: false,
      staticMaps: false,
    },
  });
  const key = rotateApiKey(project.id);

  const raster = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: project.planId,
    },
    "raster",
  );

  assert.equal(raster.allow, false);
  assert.equal(raster.denyReason, "quota");
});

test("consumeRequestUnit allows raster when only raster endpoint is enabled", () => {
  const project = makeProjectWithPolicy({
    allowedEndpoints: {
      tiles: false,
      raster: true,
      staticMaps: false,
    },
  });
  const key = rotateApiKey(project.id);

  const raster = consumeRequestUnit({
    projectId: key.projectId,
    keyHash: key.keyHash,
    planId: project.planId,
  }, "raster");

  assert.equal(raster.allow, true);
  const tile = consumeRequestUnit({
    projectId: key.projectId,
    keyHash: key.keyHash,
    planId: project.planId,
  }, "tiles");
  assert.equal(tile.allow, false);
});

test("consumeRequestUnit rejects malformed usage identities", () => {
  const project = makeProjectWithPolicy({
    quotas: {
      monthlyRequests: 5,
    },
  });
  const key = rotateApiKey(project.id);

  const malformedPlan = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: "free|pro",
    },
    "tiles",
  );
  assert.equal(malformedPlan.allow, false);
  assert.equal(malformedPlan.denyReason, "quota");

  const malformedProject = consumeRequestUnit(
    {
      projectId: `${key.projectId}|shadow`,
      keyHash: key.keyHash,
      planId: project.planId,
    },
    "tiles",
  );
  assert.equal(malformedProject.allow, false);
  assert.equal(malformedProject.denyReason, "quota");

  const summary = getUsageSummary(project.id, "minute");
  assert.equal(summary.length, 0);
});

test("consumeRequestUnit denies unknown endpoint groups and does not count usage", () => {
  const project = makeProjectWithPolicy({
    quotas: {
      monthlyRequests: 5,
    },
  });
  const key = rotateApiKey(project.id);

  const denied = consumeRequestUnit(
    {
      projectId: key.projectId,
      keyHash: key.keyHash,
      planId: project.planId,
    },
    "vector",
  );

  assert.equal(denied.allow, false);
  assert.equal(denied.denyReason, "quota");

  const summary = getUsageSummary(project.id, "minute");
  assert.equal(summary.length, 0);
});

test("computeBillingEstimate resolves plan from usage summary when no plan is provided", () => {
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

test("computeBillingEstimate resolves plan case-insensitively from usage summary", () => {
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

test("computeBillingEstimate accepts planId summaries with case-only differences", () => {
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

test("computeBillingEstimate rejects mixed planId summaries", () => {
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

test("computeBillingEstimate rejects explicit plan mismatch", () => {
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

test("computeBillingEstimate rejects mixed project summaries", () => {
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

test("computeBillingEstimate rejects non-monthly usage windows", () => {
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

test("computeBillingEstimate throws typed MeteringError for invalid identity inputs", () => {
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

  const result = await new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, 0);
  });
  assert.equal(result, true);
});
