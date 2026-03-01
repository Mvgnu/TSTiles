import type { DeliverySignal } from "../../contracts/types";
import { getProjectPolicy } from "../projects/projects.service";
import type { ProjectPolicy } from "../projects/types";
import type { RuntimeConfig } from "../../config/types";
import { loadConfig } from "../../config/load-config";
import type {
  BillingEstimate,
  BillingPlan,
  MeteringEndpointGroup,
  QuotaDecision,
  UsageCounterWindow,
  UsageSummary,
} from "./types";

const billingPlansById: ReadonlyMap<string, BillingPlan> = new Map<string, BillingPlan>([
  ["free", {
    planId: "free",
    freeAllowancePerMonth: 100_000,
    unitPricePerThousandRequests: 0.5,
    currency: "USD",
  }],
  ["pro", {
    planId: "pro",
    freeAllowancePerMonth: 500_000,
    unitPricePerThousandRequests: 0.2,
    currency: "USD",
  }],
]);

const usageBuckets = new Map<string, number>();
const deliverySignalBuffer: DeliverySignal[] = [];
const maxDeliverySignalBuffer = 500;

type EndpointGroup = MeteringEndpointGroup;

interface ProjectUsageIdentity {
  readonly projectId: string;
  readonly keyHash: string;
  readonly planId: string;
}

function getRuntimeConfig(): RuntimeConfig {
  return loadConfig();
}

function normalizeEndpointGroup(endpointGroup: string): EndpointGroup | null {
  const normalized = endpointGroup.trim().toLowerCase();
  if (normalized === "tiles" || normalized === "raster" || normalized === "static") {
    return normalized;
  }
  return null;
}

function isUsageWindow(window: string): window is UsageCounterWindow {
  return window === "minute" || window === "day" || window === "month";
}

function isEndpointGroup(endpointGroup: string): endpointGroup is EndpointGroup {
  return endpointGroup === "tiles" || endpointGroup === "raster" || endpointGroup === "static";
}

function isSafeCounterToken(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("|");
}

function isValidUsageIdentity(identity: ProjectUsageIdentity | null): identity is ProjectUsageIdentity {
  if (identity === null) {
    return false;
  }
  return (
    isSafeCounterToken(identity.projectId)
    && isSafeCounterToken(identity.keyHash)
    && isSafeCounterToken(identity.planId)
  );
}

function isEndpointAllowed(policy: ProjectPolicy, endpointGroup: EndpointGroup): boolean {
  if (endpointGroup === "raster") {
    return policy.allowedEndpoints.raster;
  }
  if (endpointGroup === "static") {
    return policy.allowedEndpoints.staticMaps;
  }
  return policy.allowedEndpoints.tiles;
}

function bucketWindow(window: UsageCounterWindow, date = new Date()): string {
  if (window === "day") {
    return date.toISOString().slice(0, 10);
  }
  if (window === "month") {
    return date.toISOString().slice(0, 7);
  }
  return date.toISOString().slice(0, 16);
}

function counterKey(
  projectId: string,
  keyHash: string,
  planId: string,
  endpointGroup: EndpointGroup,
  window: UsageCounterWindow,
  bucket: string,
): string {
  return `${projectId}|${keyHash}|${planId}|${endpointGroup}|${window}|${bucket}`;
}

function readCounter(
  projectId: string,
  keyHash: string,
  planId: string,
  endpointGroup: EndpointGroup,
  window: UsageCounterWindow,
): number {
  const key = counterKey(projectId, keyHash, planId, endpointGroup, window, bucketWindow(window));
  return usageBuckets.get(key) ?? 0;
}

function incrementCounter(
  projectId: string,
  keyHash: string,
  planId: string,
  endpointGroup: EndpointGroup,
  window: UsageCounterWindow,
): void {
  const key = counterKey(projectId, keyHash, planId, endpointGroup, window, bucketWindow(window));
  const current = usageBuckets.get(key) ?? 0;
  usageBuckets.set(key, current + 1);
}

function parseMinuteQuota(limit: number | undefined): number | undefined {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return undefined;
  }
  return Math.floor(limit);
}

function buildRemaining(limit: number | undefined, count: number): number | undefined {
  if (limit === undefined) {
    return undefined;
  }
  const remaining = Math.max(limit - count, 0);
  return remaining;
}

function selectPrimaryLimit(
  minuteLimit: number | undefined,
  dailyLimit: number | undefined,
  monthlyLimit: number | undefined,
): { readonly limit?: number; readonly window?: UsageCounterWindow } {
  if (monthlyLimit !== undefined) {
    return { limit: monthlyLimit, window: "month" };
  }
  if (dailyLimit !== undefined) {
    return { limit: dailyLimit, window: "day" };
  }
  if (minuteLimit !== undefined) {
    return { limit: minuteLimit, window: "minute" };
  }
  return {};
}

export function consumeRequestUnit(identity: ProjectUsageIdentity | null, endpointGroup: string): QuotaDecision {
  getRuntimeConfig();
  if (!isValidUsageIdentity(identity)) {
    return {
      allow: false,
      denyReason: "quota",
      remaining: 0,
      limit: 0,
    };
  }

  const group = normalizeEndpointGroup(endpointGroup);
  if (group === null) {
    return {
      allow: false,
      denyReason: "quota",
      remaining: 0,
      limit: 0,
    };
  }
  let policy: ProjectPolicy;
  try {
    policy = getProjectPolicy(identity.projectId);
  } catch {
    return {
      allow: false,
      denyReason: "quota",
      remaining: 0,
      limit: 0,
    };
  }
  if (!isEndpointAllowed(policy, group)) {
    return {
      allow: false,
      denyReason: "quota",
      remaining: 0,
      limit: 0,
    };
  }

  const minuteLimit = parseMinuteQuota(policy.quotas?.minuteRequests);
  const dailyLimit = parseMinuteQuota(policy.quotas?.dailyRequests);
  const monthlyLimit = parseMinuteQuota(policy.quotas?.monthlyRequests);

  if (minuteLimit !== undefined) {
    const minuteCount = readCounter(identity.projectId, identity.keyHash, identity.planId, group, "minute");
    if (minuteCount >= minuteLimit) {
      return {
        allow: false,
        denyReason: "rate_limit",
        remaining: 0,
        limit: minuteLimit,
      };
    }
  }

  if (dailyLimit !== undefined) {
    const dailyCount = readCounter(identity.projectId, identity.keyHash, identity.planId, group, "day");
    if (dailyCount >= dailyLimit) {
      return {
        allow: false,
        denyReason: "quota",
        remaining: 0,
        limit: dailyLimit,
      };
    }
  }
  if (monthlyLimit !== undefined) {
    const monthlyCount = readCounter(identity.projectId, identity.keyHash, identity.planId, group, "month");
    if (monthlyCount >= monthlyLimit) {
      return {
        allow: false,
        denyReason: "quota",
        remaining: 0,
        limit: monthlyLimit,
      };
    }
  }

  incrementCounter(identity.projectId, identity.keyHash, identity.planId, group, "minute");
  incrementCounter(identity.projectId, identity.keyHash, identity.planId, group, "day");
  incrementCounter(identity.projectId, identity.keyHash, identity.planId, group, "month");

  const monthCount = readCounter(identity.projectId, identity.keyHash, identity.planId, group, "month");
  const dayCount = readCounter(identity.projectId, identity.keyHash, identity.planId, group, "day");
  const minuteCount = readCounter(identity.projectId, identity.keyHash, identity.planId, group, "minute");
  const primary = selectPrimaryLimit(minuteLimit, dailyLimit, monthlyLimit);
  const primaryCount = primary.window === "month"
    ? monthCount
    : primary.window === "day"
      ? dayCount
      : minuteCount;

  return {
    allow: true,
    remaining: buildRemaining(primary.limit, primaryCount),
    limit: primary.limit,
  };
}

export function recordDeliverySignal(signal: DeliverySignal): void {
  setTimeout(() => {
    deliverySignalBuffer.push(signal);
    if (deliverySignalBuffer.length > maxDeliverySignalBuffer) {
      deliverySignalBuffer.length = maxDeliverySignalBuffer;
    }
  }, 0);
}

export function getUsageSummary(projectId: string, window: UsageCounterWindow): UsageSummary[] {
  if (!isSafeCounterToken(projectId)) {
    return [];
  }
  const bucket = bucketWindow(window);
  const out: UsageSummary[] = [];
  for (const [key, value] of usageBuckets.entries()) {
    const parts = key.split("|");
    if (parts.length !== 6) {
      continue;
    }
    const [entryProject, entryKeyHash, entryPlanId, endpointGroup, entryWindow, entryBucket] = parts;
    if (
      !isSafeCounterToken(entryProject)
      || !isSafeCounterToken(entryKeyHash)
      || !isSafeCounterToken(entryPlanId)
      || !isSafeCounterToken(entryBucket)
    ) {
      continue;
    }
    if (entryProject !== projectId || entryWindow !== window || entryBucket !== bucket) {
      continue;
    }
    if (!isUsageWindow(entryWindow)) {
      continue;
    }
    if (!isEndpointGroup(endpointGroup)) {
      continue;
    }
    out.push({
      projectId: entryProject,
      keyHash: entryKeyHash,
      planId: entryPlanId,
      window: entryWindow,
      bucket: entryBucket,
      endpointGroup: endpointGroup,
      requestCount: value,
      unit: "request",
    });
  }
  return out;
}

function resolveBillingPlan(planId: string): BillingPlan {
  return billingPlansById.get(planId.toLowerCase()) ?? billingPlansById.get("free")!;
}

export function computeBillingEstimate(summary: UsageSummary | UsageSummary[], plan?: BillingPlan): BillingEstimate {
  const items = Array.isArray(summary) ? summary : [summary];
  if (items.some((item) => item.window !== "month")) {
    throw new Error("METERING_BAD_IDENTITY:billing estimate requires monthly usage windows");
  }
  const firstProjectId = items[0]?.projectId;
  if (firstProjectId !== undefined && items.some((item) => item.projectId !== firstProjectId)) {
    throw new Error("METERING_BAD_IDENTITY:billing estimate requires a single projectId");
  }
  const firstPlanId = items[0]?.planId.toLowerCase();
  if (firstPlanId !== undefined && items.some((item) => item.planId.toLowerCase() !== firstPlanId)) {
    throw new Error("METERING_BAD_IDENTITY:billing estimate requires a single planId");
  }
  const summaryPlanId = (items[0]?.planId ?? "free").toLowerCase();
  const resolvedPlan = plan ?? resolveBillingPlan(summaryPlanId);
  if (plan && items.length > 0 && plan.planId.toLowerCase() !== summaryPlanId) {
    throw new Error("METERING_BAD_IDENTITY:explicit billing plan does not match usage summary");
  }
  const requestCount = items.reduce((total: number, item) => total + item.requestCount, 0);
  const billableUnits = Math.max(requestCount - resolvedPlan.freeAllowancePerMonth, 0);
  return {
    planId: resolvedPlan.planId,
    requestCount,
    freeAllowance: resolvedPlan.freeAllowancePerMonth,
    billedUnits: billableUnits,
    unitPricePerThousand: resolvedPlan.unitPricePerThousandRequests,
    estimatedCost: (billableUnits / 1000) * resolvedPlan.unitPricePerThousandRequests,
    currency: resolvedPlan.currency,
  };
}
