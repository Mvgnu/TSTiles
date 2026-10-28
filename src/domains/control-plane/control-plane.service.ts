import { createHash } from "node:crypto";
import { loadConfig } from "../../config/load-config";
import { prisma } from "../../config/db";
import { ConfigError } from "../../config/types";
import { runIngestPipeline, buildDefaultSnapshot } from "../ingest/ingest.service";
import {
  listArtifacts,
  promoteArtifact,
  rollbackArtifact,
  registerArtifact,
} from "../artifact/artifact.service";
import type { ArtifactSummary, AuditEvent, HealthStatus, JobMetadata } from "./types";
import { ArtifactError, ArtifactErrorCode } from "../artifact/types";
import {
  ControlPlaneErrorCode,
  ControlPlaneError,
} from "./types";
import type { IngestRunReport } from "../ingest/types";
import { isAuthorized, normalizeAdminToken } from "./auth/admin-auth";
import { createProject, listProjects, rotateApiKey } from "../projects/projects.service";
import { ProjectsError, ProjectsErrorCode, type ProjectCreationInput, type ProjectPolicy } from "../projects/types";
import { createStyleVersion, publishStyleVersion } from "../styles/styles.service";
import { StyleError, StyleErrorCode } from "../styles/types";
import { getUsageSummary } from "../metering/metering.service";
import type { UsageCounterWindow } from "../metering/types";
import { getSession } from "../identity/identity.service";

const jobCounter = new Map<string, number>();
const recentJobs = new Map<string, JobMetadata>();
const jobHistory: JobMetadata[] = [];
const auditLog: AuditEvent[] = [];

const AUDIT_RETENTION = 50;
const JOB_RETENTION = 25;
// Persistent audit/job retention bounds. Sweeps run amortized after each
// mutating write so retention does not require an external cron job.
const PERSISTENT_AUDIT_RETENTION_DAYS = 30;
const PERSISTENT_JOB_RETENTION_DAYS = 30;
const SWEEP_INTERVAL_WRITES = 64;
let writeCountSinceLastSweep = 0;

async function sweepPersistentRetention(): Promise<void> {
  const now = Date.now();
  const auditCutoffIso = new Date(now - PERSISTENT_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const jobCutoffIso = new Date(now - PERSISTENT_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    await prisma.adminAuditEvent.deleteMany({
      where: { recordedAt: { lt: auditCutoffIso } },
    });
    await prisma.adminJob.deleteMany({
      where: {
        recordedAt: { lt: jobCutoffIso },
        status: { in: ["finished", "failed"] },
      },
    });
  } catch {
    // Retention sweeps are best-effort; do not fail mutating writes if the
    // sweep itself errors. The next sweep window will retry.
  }
}

function maybeScheduleRetentionSweep(): void {
  writeCountSinceLastSweep += 1;
  if (writeCountSinceLastSweep < SWEEP_INTERVAL_WRITES) {
    return;
  }
  writeCountSinceLastSweep = 0;
  void sweepPersistentRetention();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeAllowedOrigin(origin: string): string {
  const trimmed = origin.trim();
  if (trimmed.length === 0) {
    throw new ControlPlaneError(
      ControlPlaneErrorCode.BAD_REQUEST,
      "policy.allowedOrigins entries must be non-empty strings",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ControlPlaneError(
      ControlPlaneErrorCode.BAD_REQUEST,
      "policy.allowedOrigins entries must be absolute http(s) origins",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ControlPlaneError(
      ControlPlaneErrorCode.BAD_REQUEST,
      "policy.allowedOrigins entries must be absolute http(s) origins",
    );
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new ControlPlaneError(
      ControlPlaneErrorCode.BAD_REQUEST,
      "policy.allowedOrigins entries must not include credentials",
    );
  }
  if (parsed.pathname !== "/" || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new ControlPlaneError(
      ControlPlaneErrorCode.BAD_REQUEST,
      "policy.allowedOrigins entries must be bare origins without path, query, or fragment",
    );
  }
  return parsed.origin;
}

function normalizeProjectPlanId(planId: string | undefined): string | undefined {
  if (planId === undefined) {
    return undefined;
  }
  const normalized = planId.trim();
  if (normalized.length === 0) {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "planId must be non-empty");
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(normalized)) {
    throw new ControlPlaneError(
      ControlPlaneErrorCode.BAD_REQUEST,
      "planId must be alphanumeric (plus _ or -)",
    );
  }
  return normalized.toLowerCase();
}

function normalizeProjectName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "Project name is required");
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "Project name is required");
  }
  return normalized;
}

function parseProjectPolicyInput(policy: unknown): Partial<ProjectPolicy> | undefined {
  if (policy === undefined) {
    return undefined;
  }
  if (!isRecord(policy)) {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy must be an object");
  }

  let allowedOrigins: readonly string[] | undefined;
  if (policy.allowedOrigins !== undefined) {
    if (!Array.isArray(policy.allowedOrigins)) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.allowedOrigins must be an array");
    }
    const origins: string[] = [];
    const seenOrigins = new Set<string>();
    for (const entry of policy.allowedOrigins) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        throw new ControlPlaneError(
          ControlPlaneErrorCode.BAD_REQUEST,
          "policy.allowedOrigins entries must be non-empty strings",
        );
      }
      const normalizedOrigin = normalizeAllowedOrigin(entry);
      if (seenOrigins.has(normalizedOrigin)) {
        continue;
      }
      seenOrigins.add(normalizedOrigin);
      origins.push(normalizedOrigin);
    }
    allowedOrigins = origins;
  }

  let allowedEndpoints: ProjectPolicy["allowedEndpoints"] | undefined;
  if (policy.allowedEndpoints !== undefined) {
    if (!isRecord(policy.allowedEndpoints)) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.allowedEndpoints must be an object");
    }
    const tiles = policy.allowedEndpoints.tiles;
    const raster = policy.allowedEndpoints.raster;
    const staticMaps = policy.allowedEndpoints.staticMaps;
    if (tiles !== undefined && typeof tiles !== "boolean") {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.allowedEndpoints.tiles must be boolean");
    }
    if (raster !== undefined && typeof raster !== "boolean") {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.allowedEndpoints.raster must be boolean");
    }
    if (staticMaps !== undefined && typeof staticMaps !== "boolean") {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.allowedEndpoints.staticMaps must be boolean");
    }
    allowedEndpoints = {
      tiles: tiles ?? true,
      raster: raster ?? true,
      staticMaps: staticMaps ?? true,
    };
  }

  let quotas: ProjectPolicy["quotas"] | undefined;
  if (policy.quotas !== undefined) {
    if (!isRecord(policy.quotas)) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.quotas must be an object");
    }
    const dailyRequests = policy.quotas.dailyRequests;
    const monthlyRequests = policy.quotas.monthlyRequests;
    const minuteRequests = policy.quotas.minuteRequests;
    if (dailyRequests !== undefined && !isPositiveInteger(dailyRequests)) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.quotas.dailyRequests must be a positive integer");
    }
    if (monthlyRequests !== undefined && !isPositiveInteger(monthlyRequests)) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.quotas.monthlyRequests must be a positive integer");
    }
    if (minuteRequests !== undefined && !isPositiveInteger(minuteRequests)) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.quotas.minuteRequests must be a positive integer");
    }
    quotas = {
      dailyRequests,
      monthlyRequests,
      minuteRequests,
    };
  }

  let cache: ProjectPolicy["cache"] | undefined;
  if (policy.cache !== undefined) {
    if (!isRecord(policy.cache)) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.cache must be an object");
    }
    const tileTtlSeconds = policy.cache.tileTtlSeconds;
    const metadataTtlSeconds = policy.cache.metadataTtlSeconds;
    if (tileTtlSeconds !== undefined && !isPositiveInteger(tileTtlSeconds)) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.cache.tileTtlSeconds must be a positive integer");
    }
    if (metadataTtlSeconds !== undefined && !isPositiveInteger(metadataTtlSeconds)) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "policy.cache.metadataTtlSeconds must be a positive integer");
    }
    cache = {
      tileTtlSeconds,
      metadataTtlSeconds,
    };
  }

  return {
    ...(allowedOrigins === undefined ? {} : { allowedOrigins }),
    ...(allowedEndpoints === undefined ? {} : { allowedEndpoints }),
    ...(quotas === undefined ? {} : { quotas }),
    ...(cache === undefined ? {} : { cache }),
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && isRecord(error)) {
    const code = error.code;
    if (typeof code === "string") {
      const details = extractErrorDetails(error, code);
      return `${code}: ${details}`;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

function extractErrorDetails(error: Error, code?: string): string {
  if (isRecord(error)) {
    const details = error.details;
    if (typeof details === "string" && details.trim().length > 0) {
      return details.trim();
    }
  }
  if (
    typeof code === "string"
    && code.length > 0
    && error.message.startsWith(`${code}:`)
  ) {
    return error.message.slice(code.length + 1).trim();
  }
  return error.message;
}

function buildArtifactMetadata(report: IngestRunReport): {
  readonly id: string;
  readonly key: string;
  readonly checksum: string;
  readonly byteSize: number;
  readonly createdAt: string;
  readonly validated: boolean;
} {
  return {
    id: report.artifactId,
    key: report.artifactKey,
    checksum: report.checksum,
    byteSize: report.byteSize,
    createdAt: report.completedAt,
    validated: report.validated,
  };
}

function nextJobId(): string {
  const next = (jobCounter.get("jobs") ?? 0) + 1;
  jobCounter.set("jobs", next);
  return `job-${next}`;
}

async function toPublicActor(token: unknown): Promise<string> {
  const normalized = normalizeAdminToken(token);
  if (!normalized) {
    return "anonymous";
  }
  const config = loadConfig();
  if (normalized === config.security.adminToken) {
    const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
    return `admin:${digest}`;
  }
  const session = await getSession(normalized);
  if (session?.sessionKind === "ops") {
    return `operator:${session.user.id}`;
  }
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `admin:${digest}`;
}

async function addAudit(event: Omit<AuditEvent, "id">): Promise<void> {
  const id = `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const recordedAt = new Date().toISOString();
  await prisma.adminAuditEvent.create({
    data: {
      id,
      actor: event.actor,
      operation: event.operation,
      outcome: event.outcome,
      startedAt: event.startedAt,
      completedAt: event.completedAt,
      message: event.message,
      recordedAt,
    },
  });
  auditLog.unshift({
    ...event,
    id,
  });
  if (auditLog.length > AUDIT_RETENTION) {
    auditLog.length = AUDIT_RETENTION;
  }
  maybeScheduleRetentionSweep();
}

async function addJob(job: JobMetadata): Promise<void> {
  const recordedAt = new Date().toISOString();
  await prisma.adminJob.upsert({
    where: { jobId: job.jobId },
    update: {
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      actor: job.actor,
      snapshotId: job.snapshotId,
      outcome: job.outcome,
      recordedAt,
    },
    create: {
      jobId: job.jobId,
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      actor: job.actor,
      snapshotId: job.snapshotId,
      outcome: job.outcome,
      recordedAt,
    },
  });
  jobHistory.unshift(job);
  recentJobs.set(job.jobId, job);
  if (jobHistory.length > JOB_RETENTION) {
    jobHistory.length = JOB_RETENTION;
  }
  const retainedJobIds = new Set(jobHistory.map((entry) => entry.jobId));
  for (const jobId of recentJobs.keys()) {
    if (!retainedJobIds.has(jobId)) {
      recentJobs.delete(jobId);
    }
  }
}

function normalizeRequiredId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, `${label} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, `${label} is required`);
  }
  if (
    normalized.includes("/")
    || normalized.includes("\\")
    || normalized === "."
    || normalized === ".."
    || normalized.includes("..")
  ) {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, `${label} contains unsupported path characters`);
  }
  return normalized;
}

async function assertProjectExists(projectId: string): Promise<void> {
  const projects = await listProjects();
  if (!projects.some((project) => project.id === projectId)) {
    throw new ControlPlaneError(ControlPlaneErrorCode.CONFLICT, "project not found");
  }
}

function parseCreateProjectInput(input: unknown): ProjectCreationInput {
  if (!isRecord(input)) {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "Project payload is required");
  }
  const name = normalizeProjectName(input.name);
  const planId = input.planId;
  if (planId !== undefined && typeof planId !== "string") {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "planId must be a string");
  }
  const policy = parseProjectPolicyInput(input.policy);
  return {
    name,
    planId: normalizeProjectPlanId(planId),
    policy,
  };
}

async function assertAdmin(actorToken?: unknown): Promise<string> {
  if (!(await isAuthorized(actorToken))) {
    throw new ControlPlaneError(ControlPlaneErrorCode.UNAUTHORIZED, "Unauthorized");
  }
  return await toPublicActor(actorToken);
}

async function replaceJob(job: JobMetadata): Promise<void> {
  const recordedAt = new Date().toISOString();
  await prisma.adminJob.update({
    where: { jobId: job.jobId },
    data: {
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      actor: job.actor,
      snapshotId: job.snapshotId,
      outcome: job.outcome,
      recordedAt,
    },
  }).catch(() => {
    // Job may have been pruned from the persistent store; in that case the
    // hot cache update is the only update we can apply.
  });
  const current = recentJobs.get(job.jobId);
  if (!current) {
    return;
  }
  const index = jobHistory.findIndex((entry) => entry.jobId === job.jobId);
  if (index >= 0) {
    jobHistory[index] = job;
  }
  recentJobs.set(job.jobId, job);
}

function toControlPlaneError(error: unknown): never {
  if (error instanceof ControlPlaneError) {
    throw error;
  }
  if (error instanceof ProjectsError) {
    const details = extractErrorDetails(error, error.code);
    if (error.code === ProjectsErrorCode.PROJECT_NOT_FOUND) {
      throw new ControlPlaneError(ControlPlaneErrorCode.CONFLICT, details);
    }
    if (error.code === ProjectsErrorCode.POLICY_INVALID || error.code === ProjectsErrorCode.KEY_INVALID) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, details);
    }
    throw new ControlPlaneError(ControlPlaneErrorCode.DEPENDENCY_FAILED, details);
  }
  if (error instanceof StyleError) {
    const details = extractErrorDetails(error, error.code);
    if (
      error.code === StyleErrorCode.NOT_FOUND
      || error.code === StyleErrorCode.VERSION_NOT_FOUND
      || error.code === StyleErrorCode.PUBLISH_CONFLICT
    ) {
      throw new ControlPlaneError(ControlPlaneErrorCode.CONFLICT, details);
    }
    if (error.code === StyleErrorCode.BAD_REQUEST || error.code === StyleErrorCode.INVALID_DOCUMENT) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, details);
    }
    throw new ControlPlaneError(ControlPlaneErrorCode.DEPENDENCY_FAILED, details);
  }
  if (error instanceof ArtifactError) {
    const details = extractErrorDetails(error, error.code);
    if (error.code === ArtifactErrorCode.NOT_FOUND || error.code === ArtifactErrorCode.PROMOTION_CONFLICT || error.code === ArtifactErrorCode.ROLLBACK_UNAVAILABLE) {
      throw new ControlPlaneError(ControlPlaneErrorCode.CONFLICT, details);
    }
    if (error.code === ArtifactErrorCode.NOT_VALIDATED) {
      throw new ControlPlaneError(ControlPlaneErrorCode.FORBIDDEN, details);
    }
    throw new ControlPlaneError(ControlPlaneErrorCode.DEPENDENCY_FAILED, details);
  }
  if (error instanceof ConfigError) {
    throw new ControlPlaneError(ControlPlaneErrorCode.DEPENDENCY_FAILED, error.message);
  }
  throw new ControlPlaneError(ControlPlaneErrorCode.DEPENDENCY_FAILED, "Control plane operation failed");
}

function summarizeArtifactList(artifacts: Awaited<ReturnType<typeof listArtifacts>>): ArtifactSummary[] {
  return artifacts.map((artifact) => ({
    id: artifact.id,
    key: artifact.key,
    checksum: artifact.checksum,
    byteSize: artifact.byteSize,
    createdAt: artifact.createdAt,
    validated: artifact.validated,
  }));
}

export async function triggerIngest(actorToken?: string): Promise<JobMetadata> {
  const actor = await assertAdmin(actorToken);
  const id = nextJobId();
  const snapshot = buildDefaultSnapshot();
  const startedAt = new Date().toISOString();
  const job: JobMetadata = {
    jobId: id,
    status: "started",
    startedAt,
    actor,
  };
  await addJob({
    ...job,
    snapshotId: snapshot.snapshotId,
  });

  void runIngestPipeline(snapshot)
    .then(async (report): Promise<void> => {
      await registerArtifact(buildArtifactMetadata(report));
      const completedJob: JobMetadata = {
        ...job,
        status: "finished",
        completedAt: new Date().toISOString(),
        outcome: "ok",
      };
      await replaceJob(completedJob);
      await addAudit({
        actor,
        operation: "ingest",
        outcome: "ok",
        startedAt,
        completedAt: completedJob.completedAt,
        message: report.artifactId,
      });
    })
    .catch(async (error: unknown): Promise<void> => {
      const failureMessage = normalizeErrorMessage(error);
      const failedJob: JobMetadata = {
        ...job,
        status: "failed",
        completedAt: new Date().toISOString(),
        outcome: "failed",
      };
      await replaceJob(failedJob);
      await addAudit({
        actor,
        operation: "ingest",
        outcome: "failed",
        startedAt,
        completedAt: failedJob.completedAt,
        message: failureMessage,
      });
    });
  return {
    ...job,
  };
}

export async function listArtifactsEndpoint(actorToken?: string): Promise<ArtifactSummary[]> {
  const actor = await assertAdmin(actorToken);
  const artifacts = await listArtifacts();
  await addAudit({
    actor,
    operation: "list_artifacts",
    outcome: "ok",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    message: `${artifacts.length} artifacts listed`,
  });
  return summarizeArtifactList(artifacts);
}

export async function promoteArtifactEndpoint(versionId: string, actorToken?: string): Promise<Awaited<ReturnType<typeof promoteArtifact>>> {
  const actor = await assertAdmin(actorToken);
  const normalizedVersionId = normalizeRequiredId(versionId, "versionId");
  const startedAt = new Date().toISOString();
  try {
    const pointer = await promoteArtifact(normalizedVersionId);
    await addAudit({
      actor,
      operation: "promote_artifact",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizedVersionId,
    });
    return pointer;
  } catch (error: unknown) {
    await addAudit({
      actor,
      operation: "promote_artifact",
      outcome: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizeErrorMessage(error),
    });
    toControlPlaneError(error);
  }
}

export async function rollbackArtifactEndpoint(actorToken?: string): Promise<Awaited<ReturnType<typeof rollbackArtifact>>> {
  const actor = await assertAdmin(actorToken);
  const startedAt = new Date().toISOString();
  try {
    const pointer = await rollbackArtifact();
    await addAudit({
      actor,
      operation: "rollback_artifact",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
    });
    return pointer;
  } catch (error: unknown) {
    await addAudit({
      actor,
      operation: "rollback_artifact",
      outcome: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizeErrorMessage(error),
    });
    toControlPlaneError(error);
  }
}

export async function createProjectEndpoint(input: unknown, actorToken?: string): Promise<Awaited<ReturnType<typeof createProject>>> {
  const actor = await assertAdmin(actorToken);
  const startedAt = new Date().toISOString();
  try {
    const parsedInput = parseCreateProjectInput(input);
    const created = await createProject(parsedInput);
    await addAudit({
      actor,
      operation: "create_project",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: created.id,
    });
    return created;
  } catch (error: unknown) {
    await addAudit({
      actor,
      operation: "create_project",
      outcome: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizeErrorMessage(error),
    });
    toControlPlaneError(error);
  }
}

export async function rotateApiKeyEndpoint(projectId: string, actorToken?: string): Promise<Awaited<ReturnType<typeof rotateApiKey>>> {
  const actor = await assertAdmin(actorToken);
  const normalizedProjectId = normalizeRequiredId(projectId, "projectId");
  const startedAt = new Date().toISOString();
  try {
    const key = await rotateApiKey(normalizedProjectId);
    await addAudit({
      actor,
      operation: "rotate_api_key",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizedProjectId,
    });
    return key;
  } catch (error: unknown) {
    await addAudit({
      actor,
      operation: "rotate_api_key",
      outcome: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizeErrorMessage(error),
    });
    toControlPlaneError(error);
  }
}

export async function getProjectUsageEndpoint(projectId: string, window: UsageCounterWindow, actorToken?: string): Promise<Awaited<ReturnType<typeof getUsageSummary>>> {
  const actor = await assertAdmin(actorToken);
  const normalizedProjectId = normalizeRequiredId(projectId, "projectId");
  const startedAt = new Date().toISOString();
  try {
    await assertProjectExists(normalizedProjectId);
    const usage = await getUsageSummary(normalizedProjectId, window);
    await addAudit({
      actor,
      operation: "get_project_usage",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: `${normalizedProjectId}:${window}:${usage.length}`,
    });
    return usage;
  } catch (error: unknown) {
    await addAudit({
      actor,
      operation: "get_project_usage",
      outcome: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizeErrorMessage(error),
    });
    toControlPlaneError(error);
  }
}

export async function createStyleVersionEndpoint(styleId: string, input: unknown, actorToken?: string): Promise<Awaited<ReturnType<typeof createStyleVersion>>> {
  const actor = await assertAdmin(actorToken);
  const normalizedStyleId = normalizeRequiredId(styleId, "styleId");
  const startedAt = new Date().toISOString();
  try {
    const version = await createStyleVersion(normalizedStyleId, input);
    await addAudit({
      actor,
      operation: "create_style_version",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: `${normalizedStyleId}/${version.id}`,
    });
    return version;
  } catch (error: unknown) {
    await addAudit({
      actor,
      operation: "create_style_version",
      outcome: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizeErrorMessage(error),
    });
    toControlPlaneError(error);
  }
}

export async function publishStyleVersionEndpoint(styleId: string, versionId: string, actorToken?: string): Promise<Awaited<ReturnType<typeof publishStyleVersion>>> {
  const actor = await assertAdmin(actorToken);
  const normalizedStyleId = normalizeRequiredId(styleId, "styleId");
  const normalizedVersionId = normalizeRequiredId(versionId, "versionId");
  const startedAt = new Date().toISOString();
  try {
    const version = await publishStyleVersion(normalizedStyleId, normalizedVersionId);
    await addAudit({
      actor,
      operation: "publish_style_version",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: `${normalizedStyleId}/${normalizedVersionId}`,
    });
    return version;
  } catch (error: unknown) {
    await addAudit({
      actor,
      operation: "publish_style_version",
      outcome: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizeErrorMessage(error),
    });
    toControlPlaneError(error);
  }
}

export async function listAuditEventsEndpoint(
  actorToken?: string,
  limit = 100,
): Promise<AuditEvent[]> {
  await assertAdmin(actorToken);
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
  const rows = await prisma.adminAuditEvent.findMany({
    orderBy: { recordedAt: "desc" },
    take: safeLimit,
  });
  return rows.map((row) => ({
    id: row.id,
    actor: row.actor,
    operation: row.operation as AuditEvent["operation"],
    outcome: row.outcome as AuditEvent["outcome"],
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
    message: row.message ?? undefined,
  }));
}

export async function listJobsEndpoint(
  actorToken?: string,
  limit = 50,
): Promise<JobMetadata[]> {
  await assertAdmin(actorToken);
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  const rows = await prisma.adminJob.findMany({
    orderBy: { recordedAt: "desc" },
    take: safeLimit,
  });
  return rows.map((row) => ({
    jobId: row.jobId,
    status: row.status as JobMetadata["status"],
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
    actor: row.actor ?? undefined,
    snapshotId: row.snapshotId ?? undefined,
    outcome: (row.outcome ?? undefined) as JobMetadata["outcome"],
  }));
}

async function probeDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function countRecentAuditEvents(windowMs: number): Promise<number> {
  const cutoffIso = new Date(Date.now() - windowMs).toISOString();
  try {
    return await prisma.adminAuditEvent.count({
      where: { startedAt: { gte: cutoffIso } },
    });
  } catch {
    // If the audit table is unreachable the in-memory hot cache is the only
    // available signal; report that bounded view so callers can still see
    // whether mutating traffic recently flowed through this instance.
    const now = Date.now();
    return auditLog.filter((event) => now - Date.parse(event.startedAt) < windowMs).length;
  }
}

export async function healthStatusEndpoint(actorToken?: string): Promise<HealthStatus> {
  await assertAdmin(actorToken);
  const config = loadConfig();
  const auditWindowMs = 1000 * 60 * 5;
  const [databaseReachable, auditEventsInWindow] = await Promise.all([
    probeDatabaseReachable(),
    countRecentAuditEvents(auditWindowMs),
  ]);
  return {
    ok: databaseReachable,
    storageReachable: databaseReachable,
    configVersion: `${config.environment}-${config.storage.mode}`,
    auditEventsInWindow,
  };
}
