import type { DeliverySignal } from "../../contracts/types";
import { getProjectPolicy } from "../projects/projects.service";
import type { ProjectPolicy } from "../projects/types";
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
const cleanupIntervalRequests = 256;
const usageBucketRetentionWindows: Readonly<Record<UsageCounterWindow, number>> = {
  minute: 180,
  day: 14,
  month: 18,
};
let requestsSinceCleanup = 0;

type EndpointGroup = MeteringEndpointGroup;

interface ProjectUsageIdentity {
  readonly projectId: string;
  readonly keyHash: string;
  readonly planId: string;
}

interface WindowCounterState {
  readonly window: UsageCounterWindow;
  readonly key: string;
  readonly limit?: number;
  readonly current: number;
  readonly next: number;
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

function bucketWindow(window: UsageCounterWindow, date = new Date(Date.now())): string {
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

function subtractWindow(date: Date, window: UsageCounterWindow, amount: number): Date {
  const shifted = new Date(date.getTime());
  if (window === "minute") {
    shifted.setUTCMinutes(shifted.getUTCMinutes() - amount);
    return shifted;
  }
  if (window === "day") {
    shifted.setUTCDate(shifted.getUTCDate() - amount);
    return shifted;
  }
  shifted.setUTCMonth(shifted.getUTCMonth() - amount);
  return shifted;
}

function usageRetentionCutoff(window: UsageCounterWindow, now = new Date(Date.now())): string {
  return bucketWindow(window, subtractWindow(now, window, usageBucketRetentionWindows[window]));
}

function cleanupUsageBuckets(now = new Date(Date.now())): void {
  const minuteCutoff = usageRetentionCutoff("minute", now);
  const dayCutoff = usageRetentionCutoff("day", now);
  const monthCutoff = usageRetentionCutoff("month", now);

  for (const key of usageBuckets.keys()) {
    const parts = key.split("|");
    if (parts.length !== 6) {
      usageBuckets.delete(key);
      continue;
    }
    const entryWindow = parts[4];
    const entryBucket = parts[5];
    if (!isUsageWindow(entryWindow) || !isSafeCounterToken(entryBucket)) {
      usageBuckets.delete(key);
      continue;
    }
    const cutoff = entryWindow === "minute"
      ? minuteCutoff
      : entryWindow === "day"
        ? dayCutoff
        : monthCutoff;
    if (entryBucket < cutoff) {
      usageBuckets.delete(key);
    }
  }
}

function maybeCleanupUsageBuckets(now = new Date(Date.now())): void {
  requestsSinceCleanup += 1;
  if (requestsSinceCleanup < cleanupIntervalRequests) {
    return;
  }
  requestsSinceCleanup = 0;
  cleanupUsageBuckets(now);
}

function parseSafePositiveInt(limit: number | undefined): number | undefined {
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

function windowPriority(window: UsageCounterWindow): number {
  if (window === "minute") {
    return 0;
  }
  if (window === "day") {
    return 1;
  }
  return 2;
}

function selectPrimaryLimit(
  windows: readonly WindowCounterState[],
): { readonly limit?: number; readonly remaining?: number } {
  let selected:
    | {
      readonly limit: number;
      readonly remaining: number;
      readonly window: UsageCounterWindow;
    }
    | undefined;

  for (const entry of windows) {
    if (entry.limit === undefined) {
      continue;
    }
    const remaining = buildRemaining(entry.limit, entry.next);
    if (remaining === undefined) {
      continue;
    }
    if (
      selected === undefined
      || remaining < selected.remaining
      || (remaining === selected.remaining && windowPriority(entry.window) < windowPriority(selected.window))
    ) {
      selected = {
        limit: entry.limit,
        remaining,
        window: entry.window,
      };
    }
  }

  if (selected === undefined) {
    return {};
  }
  return {
    limit: selected.limit,
    remaining: selected.remaining,
  };
}

export function consumeRequestUnit(identity: ProjectUsageIdentity | null, endpointGroup: string): QuotaDecision {
  maybeCleanupUsageBuckets();
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

  const minuteLimit = parseSafePositiveInt(policy.quotas?.minuteRequests);
  const dailyLimit = parseSafePositiveInt(policy.quotas?.dailyRequests);
  const monthlyLimit = parseSafePositiveInt(policy.quotas?.monthlyRequests);
  const now = new Date(Date.now());
  const minuteKey = counterKey(
    identity.projectId,
    identity.keyHash,
    identity.planId,
    group,
    "minute",
    bucketWindow("minute", now),
  );
  const dayKey = counterKey(
    identity.projectId,
    identity.keyHash,
    identity.planId,
    group,
    "day",
    bucketWindow("day", now),
  );
  const monthKey = counterKey(
    identity.projectId,
    identity.keyHash,
    identity.planId,
    group,
    "month",
    bucketWindow("month", now),
  );
  // TODO: Back counters with shared atomic storage for multi-process deployments.
  const currentMinute = usageBuckets.get(minuteKey) ?? 0;
  const currentDay = usageBuckets.get(dayKey) ?? 0;
  const currentMonth = usageBuckets.get(monthKey) ?? 0;
  const minuteState: WindowCounterState = {
    window: "minute",
    key: minuteKey,
    limit: minuteLimit,
    current: currentMinute,
    next: currentMinute + 1,
  };
  const dayState: WindowCounterState = {
    window: "day",
    key: dayKey,
    limit: dailyLimit,
    current: currentDay,
    next: currentDay + 1,
  };
  const monthState: WindowCounterState = {
    window: "month",
    key: monthKey,
    limit: monthlyLimit,
    current: currentMonth,
    next: currentMonth + 1,
  };

  if (minuteState.limit !== undefined) {
    if (minuteState.current >= minuteState.limit) {
      return {
        allow: false,
        denyReason: "rate_limit",
        remaining: 0,
        limit: minuteState.limit,
      };
    }
  }

  if (dayState.limit !== undefined) {
    if (dayState.current >= dayState.limit) {
      return {
        allow: false,
        denyReason: "quota",
        remaining: 0,
        limit: dayState.limit,
      };
    }
  }
  if (monthState.limit !== undefined) {
    if (monthState.current >= monthState.limit) {
      return {
        allow: false,
        denyReason: "quota",
        remaining: 0,
        limit: monthState.limit,
      };
    }
  }

  usageBuckets.set(minuteState.key, minuteState.next);
  usageBuckets.set(dayState.key, dayState.next);
  usageBuckets.set(monthState.key, monthState.next);

  const primary = selectPrimaryLimit([minuteState, dayState, monthState]);

  return {
    allow: true,
    remaining: primary.remaining,
    limit: primary.limit,
  };
}

export function recordDeliverySignal(signal: DeliverySignal): void {
  setTimeout(() => {
    if (deliverySignalBuffer.length >= maxDeliverySignalBuffer) {
      deliverySignalBuffer.shift();
    }
    deliverySignalBuffer.push(signal);
  }, 0);
}

export function getUsageSummary(projectId: string, window: UsageCounterWindow): UsageSummary[] {
  cleanupUsageBuckets();
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
