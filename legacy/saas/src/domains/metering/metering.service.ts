import type { DeliverySignal, QuotaThresholdEvent } from "../../contracts/types";
import { loadConfig } from "../../config/load-config";
import { getProjectPolicy } from "../projects/projects.service";
import type { ProjectPolicy } from "../projects/types";
import { prisma } from "../../config/db";
import { emitDeliverySignalToSink } from "../observability/analytics/log-sink";
import { MeteringErrorCode, MeteringError } from "./types";
import { randomUUID } from "node:crypto";
import { contractEventEmitter } from "../../contracts/contracts";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneDeliverySignal(signal: unknown): DeliverySignal | null {
  if (!isRecord(signal)) {
    return null;
  }
  const {
    schemaVersion,
    artifactVersion,
    tilePath,
    cacheStatus,
    originRead,
    responseBytes,
    latencyMs,
    statusCode,
    normalizedMethod,
    receivedAt,
  } = signal;
  if (
    typeof schemaVersion !== "number"
    || schemaVersion !== 1
    || typeof artifactVersion !== "string"
    || typeof tilePath !== "string"
    || (cacheStatus !== "hit" && cacheStatus !== "miss")
    || typeof originRead !== "boolean"
    || typeof responseBytes !== "number"
    || typeof latencyMs !== "number"
    || typeof statusCode !== "number"
    || (normalizedMethod !== "GET" && normalizedMethod !== "HEAD" && normalizedMethod !== "OPTIONS")
    || typeof receivedAt !== "string"
  ) {
    return null;
  }
  return {
    schemaVersion,
    artifactVersion,
    tilePath,
    cacheStatus,
    originRead,
    responseBytes,
    latencyMs,
    statusCode,
    normalizedMethod,
    receivedAt,
  };
}

function emitBufferedDeliverySignal(signal: DeliverySignal): void {
  try {
    const config = loadConfig();
    emitDeliverySignalToSink(config.observability.logSink, signal);
  } catch {
    // Telemetry emission must never break the request path; bad runtime config
    // (caught here only for resilience) defers to the sink module's no-op
    // behavior under errors.
  }
}

function throwMeteringError(code: MeteringErrorCode, details: string): never {
  throw new MeteringError(code, details);
}

function normalizeEndpointGroup(endpointGroup: unknown): EndpointGroup | null {
  if (typeof endpointGroup !== "string") {
    return null;
  }
  const normalized = endpointGroup.trim().toLowerCase();
  if (normalized === "tiles" || normalized === "raster" || normalized === "static") {
    return normalized as EndpointGroup;
  }
  return null;
}

function normalizeUsageWindow(window: unknown): UsageCounterWindow | null {
  if (typeof window !== "string") {
    return null;
  }
  const normalized = window.trim().toLowerCase();
  if (normalized === "minute" || normalized === "day" || normalized === "month") {
    return normalized as UsageCounterWindow;
  }
  return null;
}

function isSafeCounterToken(value: string | undefined): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.trim().length > 0
    && value.trim() === value
    && value !== "."
    && !value.includes("|")
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("..")
  );
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

async function cleanupUsageBuckets(now = new Date(Date.now())): Promise<void> {
  const minuteCutoff = usageRetentionCutoff("minute", now);
  const dayCutoff = usageRetentionCutoff("day", now);
  const monthCutoff = usageRetentionCutoff("month", now);

  await prisma.usageBucket.deleteMany({
    where: { window: "minute", bucket: { lt: minuteCutoff } }
  });
  await prisma.usageBucket.deleteMany({
    where: { window: "day", bucket: { lt: dayCutoff } }
  });
  await prisma.usageBucket.deleteMany({
    where: { window: "month", bucket: { lt: monthCutoff } }
  });
  await prisma.globalBudgetBucket.deleteMany({
    where: { bucket: { lt: minuteCutoff } }
  });
}

function maybeCleanupUsageBuckets(now = new Date(Date.now())): void {
  requestsSinceCleanup += 1;
  if (requestsSinceCleanup < cleanupIntervalRequests) {
    return;
  }
  requestsSinceCleanup = 0;
  // Fire and forget
  cleanupUsageBuckets(now).catch(() => {});
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
  let selected: { limit: number; remaining: number; window: UsageCounterWindow } | undefined;

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

export async function consumeRequestUnit(identity: ProjectUsageIdentity | null, endpointGroup: string): Promise<QuotaDecision> {
  maybeCleanupUsageBuckets();
  if (!isValidUsageIdentity(identity)) {
    return { allow: false, denyReason: "quota", remaining: 0, limit: 0 };
  }

  const group = normalizeEndpointGroup(endpointGroup);
  if (group === null) {
    return { allow: false, denyReason: "quota", remaining: 0, limit: 0 };
  }

  let policy: ProjectPolicy;
  try {
    policy = await getProjectPolicy(identity.projectId);
  } catch {
    return { allow: false, denyReason: "quota", remaining: 0, limit: 0 };
  }
  if (!isEndpointAllowed(policy, group)) {
    return { allow: false, denyReason: "quota", remaining: 0, limit: 0 };
  }

  let isSuspended = false;
  let workspaceId = "default-workspace";
  try {
    const project = await prisma.project.findUnique({
      where: { id: identity.projectId },
      select: { workspaceId: true },
    });
    if (project) {
      workspaceId = project.workspaceId;
      const workspace = await prisma.identityWorkspace.findUnique({
        where: { id: project.workspaceId },
        select: { suspendedAt: true },
      });
      if (workspace && workspace.suspendedAt) {
        isSuspended = true;
      }
    }
  } catch {
    // DB error, proceed as not suspended
  }

  const minuteLimit = parseSafePositiveInt(policy.quotas?.minuteRequests);
  const dailyLimit = parseSafePositiveInt(policy.quotas?.dailyRequests);
  const monthlyLimit = parseSafePositiveInt(policy.quotas?.monthlyRequests);
  const runtimeConfig = loadConfig();
  const globalMinuteBudgetLimit = parseSafePositiveInt(runtimeConfig.tileDeliveryPolicy.globalRequestBudgetPerMinute);
  const now = new Date(Date.now());
  
  const globalMinuteBudgetKey = bucketWindow("minute", now);
  const minuteBucketStr = bucketWindow("minute", now);
  const dayBucketStr = bucketWindow("day", now);
  const monthBucketStr = bucketWindow("month", now);

  const minuteKey = counterKey(identity.projectId, identity.keyHash, identity.planId, group, "minute", minuteBucketStr);
  const dayKey = counterKey(identity.projectId, identity.keyHash, identity.planId, group, "day", dayBucketStr);
  const monthKey = counterKey(identity.projectId, identity.keyHash, identity.planId, group, "month", monthBucketStr);
  return prisma.$transaction(async (tx) => {
    const [globalEntity, minuteEntity, dayEntity, monthEntity] = await Promise.all([
      tx.globalBudgetBucket.findUnique({ where: { bucket: globalMinuteBudgetKey } }),
      tx.usageBucket.findUnique({ where: { compositeKey: minuteKey } }),
      tx.usageBucket.findUnique({ where: { compositeKey: dayKey } }),
      tx.usageBucket.findUnique({ where: { compositeKey: monthKey } }),
    ]);

    const currentGlobalMinuteBudget = globalEntity?.requestCount ?? 0;
    const currentMinute = minuteEntity?.requestCount ?? 0;
    const currentDay = dayEntity?.requestCount ?? 0;
    const currentMonth = monthEntity?.requestCount ?? 0;

    const minuteState: WindowCounterState = { window: "minute", key: minuteKey, limit: minuteLimit, current: currentMinute, next: currentMinute + 1 };
    const dayState: WindowCounterState = { window: "day", key: dayKey, limit: dailyLimit, current: currentDay, next: currentDay + 1 };
    const monthState: WindowCounterState = { window: "month", key: monthKey, limit: monthlyLimit, current: currentMonth, next: currentMonth + 1 };
    const globalMinuteState: WindowCounterState = { window: "minute", key: globalMinuteBudgetKey, limit: globalMinuteBudgetLimit, current: currentGlobalMinuteBudget, next: currentGlobalMinuteBudget + 1 };

    if (globalMinuteState.limit !== undefined && globalMinuteState.current >= globalMinuteState.limit) {
      return { allow: false, denyReason: "rate_limit", remaining: 0, limit: globalMinuteState.limit } satisfies QuotaDecision;
    }
    if (minuteState.limit !== undefined && minuteState.current >= minuteState.limit) {
      return { allow: false, denyReason: "rate_limit", remaining: 0, limit: minuteState.limit } satisfies QuotaDecision;
    }
    if (dayState.limit !== undefined && dayState.current >= dayState.limit) {
      return { allow: false, denyReason: "quota", remaining: 0, limit: dayState.limit } satisfies QuotaDecision;
    }
    if (monthState.limit !== undefined && monthState.current >= monthState.limit) {
      return { allow: false, denyReason: "quota", remaining: 0, limit: monthState.limit } satisfies QuotaDecision;
    }

    await Promise.all([
      tx.globalBudgetBucket.upsert({
        where: { bucket: globalMinuteState.key },
        update: { requestCount: { increment: 1 } },
        create: { bucket: globalMinuteState.key, requestCount: 1 }
      }),
      tx.usageBucket.upsert({
        where: { compositeKey: minuteState.key },
        update: { requestCount: { increment: 1 } },
        create: { compositeKey: minuteState.key, projectId: identity.projectId, keyHash: identity.keyHash, planId: identity.planId, endpointGroup: group, window: "minute", bucket: minuteBucketStr, requestCount: 1 }
      }),
      tx.usageBucket.upsert({
        where: { compositeKey: dayState.key },
        update: { requestCount: { increment: 1 } },
        create: { compositeKey: dayState.key, projectId: identity.projectId, keyHash: identity.keyHash, planId: identity.planId, endpointGroup: group, window: "day", bucket: dayBucketStr, requestCount: 1 }
      }),
      tx.usageBucket.upsert({
        where: { compositeKey: monthState.key },
        update: { requestCount: { increment: 1 } },
        create: { compositeKey: monthState.key, projectId: identity.projectId, keyHash: identity.keyHash, planId: identity.planId, endpointGroup: group, window: "month", bucket: monthBucketStr, requestCount: 1 }
      })
    ]);

    if (monthlyLimit !== undefined) {
      const usagePercentBefore = (currentMonth / monthlyLimit) * 100;
      const usagePercentAfter = ((currentMonth + 1) / monthlyLimit) * 100;

      const checkAndEmit = async (threshold: 80 | 100) => {
        if (usagePercentBefore < threshold && usagePercentAfter >= threshold) {
          const monthlyWindowStart = monthBucketStr;
          const thresholdReason = `monthly_quota_${threshold}_percent_crossed:${monthlyWindowStart}`;
          const existingEvent = await tx.identityAuthEvent.findFirst({
            where: {
              workspaceId,
              eventType: "QUOTA_THRESHOLD_CROSSED",
              reason: thresholdReason,
            },
          });
          if (!existingEvent) {
            const eventId = `evt_${randomUUID().replace(/-/g, "")}`;
            await tx.identityAuthEvent.create({
              data: {
                id: eventId,
                eventType: "QUOTA_THRESHOLD_CROSSED",
                workspaceId,
                outcome: "success",
                reason: thresholdReason,
                recordedAt: now.toISOString(),
              },
            });

            const eventPayload: QuotaThresholdEvent = {
              eventId,
              workspaceId,
              planId: identity.planId,
              thresholdPercent: threshold,
              usagePercent: usagePercentAfter,
              windowKind: "month",
              windowStart: monthlyWindowStart,
              recordedAt: now.toISOString(),
            };

            queueMicrotask(() => {
              contractEventEmitter.emit("quota.threshold_crossed", eventPayload);
            });
          }
        }
      };

      await checkAndEmit(80);
      await checkAndEmit(100);
    }

    if (isSuspended) {
      return { allow: false, denyReason: "workspace_suspended", remaining: 0, limit: monthlyLimit ?? 0 } satisfies QuotaDecision;
    }

    const primary = selectPrimaryLimit([globalMinuteState, minuteState, dayState, monthState]);
    return {
      allow: true,
      remaining: primary.remaining,
      limit: primary.limit,
    } satisfies QuotaDecision;
  });
}

export function recordDeliverySignal(signal: DeliverySignal): void {
  const snapshot = cloneDeliverySignal(signal);
  if (snapshot === null) {
    return;
  }
  queueMicrotask(() => {
    emitBufferedDeliverySignal(snapshot);
  });
}

export async function getUsageSummary(projectId: string, window: UsageCounterWindow): Promise<UsageSummary[]> {
  await cleanupUsageBuckets();
  const normalizedWindow = normalizeUsageWindow(window);
  if (!isSafeCounterToken(projectId) || normalizedWindow === null) {
    return [];
  }
  
  const bucket = bucketWindow(normalizedWindow);
  const rows = await prisma.usageBucket.findMany({
    where: { projectId, window: normalizedWindow, bucket }
  });

  return rows
    .map((row) => normalizeUsageSummaryRow(row))
    .filter((row): row is UsageSummary => row !== null);
}

function resolveBillingPlan(planId: unknown): BillingPlan {
  const normalizedPlanId = normalizeBillingPlanKey(planId);
  const matched = normalizedPlanId ? billingPlansById.get(normalizedPlanId) : undefined;
  if (matched) {
    return matched;
  }
  const fallback = billingPlansById.get("free");
  if (fallback) {
    return fallback;
  }
  throwMeteringError(MeteringErrorCode.BAD_IDENTITY, "free billing plan is missing");
}

function normalizeBillingPlanKey(planId: unknown): string | undefined {
  if (planId === undefined) {
    return undefined;
  }
  if (typeof planId !== "string") {
    return undefined;
  }
  const normalized = planId.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function isUsageSummaryRecord(value: unknown): value is UsageSummary {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.projectId === "string"
    && typeof value.keyHash === "string"
    && typeof value.planId === "string"
    && (value.window === "minute" || value.window === "day" || value.window === "month")
    && typeof value.bucket === "string"
    && (value.endpointGroup === "tiles" || value.endpointGroup === "raster" || value.endpointGroup === "static")
    && typeof value.requestCount === "number"
    && value.unit === "request"
  );
}

function normalizeUsageSummaryRow(value: unknown): UsageSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const projectId = typeof value.projectId === "string" ? value.projectId : undefined;
  const keyHash = typeof value.keyHash === "string" ? value.keyHash : undefined;
  const planId = typeof value.planId === "string" ? value.planId : undefined;
  const window = normalizeUsageWindow(value.window);
  const endpointGroup = normalizeEndpointGroup(value.endpointGroup);
  const bucket = value.bucket;
  const requestCount = value.requestCount;
  if (
    !isSafeCounterToken(projectId)
    || !isSafeCounterToken(keyHash)
    || !isSafeCounterToken(planId)
    || window === null
    || endpointGroup === null
    || typeof bucket !== "string"
    || bucket.trim().length === 0
    || typeof requestCount !== "number"
    || !Number.isFinite(requestCount)
    || !Number.isInteger(requestCount)
    || requestCount < 0
  ) {
    return null;
  }
  return {
    projectId,
    keyHash,
    planId,
    window,
    bucket,
    endpointGroup,
    requestCount,
    unit: "request",
  };
}

function isBillingPlanRecord(value: unknown): value is BillingPlan {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.planId === "string"
    && typeof value.freeAllowancePerMonth === "number"
    && Number.isFinite(value.freeAllowancePerMonth)
    && value.freeAllowancePerMonth >= 0
    && Number.isInteger(value.freeAllowancePerMonth)
    && typeof value.unitPricePerThousandRequests === "number"
    && Number.isFinite(value.unitPricePerThousandRequests)
    && value.unitPricePerThousandRequests >= 0
    && typeof value.currency === "string"
  );
}

export function getBillingPlan(planId: string): BillingPlan {
  return {
    ...resolveBillingPlan(planId),
  };
}

export function listBillingPlans(): BillingPlan[] {
  return [...billingPlansById.values()].map((plan) => ({
    ...plan,
  }));
}

export function computeBillingEstimate(summary: UsageSummary | UsageSummary[], plan?: BillingPlan): BillingEstimate {
  const items = Array.isArray(summary) ? summary : [summary];
  if (items.some((item) => !isUsageSummaryRecord(item))) {
    throwMeteringError(MeteringErrorCode.BAD_IDENTITY, "billing estimate requires valid usage summaries");
  }
  if (plan !== undefined && !isBillingPlanRecord(plan)) {
    throwMeteringError(MeteringErrorCode.BAD_IDENTITY, "billing estimate requires a valid billing plan");
  }
  if (items.some((item) => item.window !== "month")) {
    throwMeteringError(MeteringErrorCode.BAD_IDENTITY, "billing estimate requires monthly usage windows");
  }
  if (items.some((item) => !Number.isFinite(item.requestCount) || item.requestCount < 0)) {
    throwMeteringError(MeteringErrorCode.BAD_IDENTITY, "billing estimate requires non-negative finite request counts");
  }
  const firstProjectId = items[0]?.projectId;
  if (firstProjectId !== undefined && items.some((item) => item.projectId !== firstProjectId)) {
    throwMeteringError(MeteringErrorCode.BAD_IDENTITY, "billing estimate requires a single projectId");
  }
  const firstPlanId = normalizeBillingPlanKey(items[0]?.planId);
  if (firstPlanId !== undefined && items.some((item) => normalizeBillingPlanKey(item.planId) !== firstPlanId)) {
    throwMeteringError(MeteringErrorCode.BAD_IDENTITY, "billing estimate requires a single planId");
  }
  const summaryPlanId = normalizeBillingPlanKey(items[0]?.planId) ?? "free";
  const resolvedPlan = plan ?? resolveBillingPlan(summaryPlanId);
  if (plan && items.length > 0 && normalizeBillingPlanKey(plan.planId) !== summaryPlanId) {
    throwMeteringError(MeteringErrorCode.BAD_IDENTITY, "explicit billing plan does not match usage summary");
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
