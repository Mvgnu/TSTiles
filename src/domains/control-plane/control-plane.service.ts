import { loadConfig } from "../../config/load-config";
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
import { isAuthorized } from "./auth/admin-auth";
import { createProject, rotateApiKey } from "../projects/projects.service";
import { ProjectsError, ProjectsErrorCode, type ProjectCreationInput, type ProjectPolicy } from "../projects/types";
import { createStyleVersion, publishStyleVersion } from "../styles/styles.service";
import { StyleError, StyleErrorCode } from "../styles/types";
import { getUsageSummary } from "../metering/metering.service";
import type { UsageCounterWindow } from "../metering/types";

const jobCounter = new Map<string, number>();
const recentJobs = new Map<string, JobMetadata>();
const jobHistory: JobMetadata[] = [];
const auditLog: AuditEvent[] = [];

const AUDIT_RETENTION = 50;
const JOB_RETENTION = 25;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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
    for (const entry of policy.allowedOrigins) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        throw new ControlPlaneError(
          ControlPlaneErrorCode.BAD_REQUEST,
          "policy.allowedOrigins entries must be non-empty strings",
        );
      }
      origins.push(entry.trim());
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
      return `${code}: ${error.message}`;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
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

function toPublicActor(token: string | undefined): string {
  if (!token) {
    return "anonymous";
  }
  if (token.length <= 6) {
    return `${token[0] ?? "?"}...`;
  }
  return `${token.slice(0, 3)}...${token.slice(-3)}`;
}

function addAudit(event: Omit<AuditEvent, "id">): void {
  const id = `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  auditLog.unshift({
    ...event,
    id,
  });
  if (auditLog.length > AUDIT_RETENTION) {
    auditLog.length = AUDIT_RETENTION;
  }
}

function addJob(job: JobMetadata): void {
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

function normalizeRequiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, `${label} is required`);
  }
  return normalized;
}

function parseCreateProjectInput(input: unknown): ProjectCreationInput {
  if (!isRecord(input)) {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "Project payload is required");
  }
  const name = input.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "Project name is required");
  }
  const planId = input.planId;
  if (planId !== undefined && typeof planId !== "string") {
    throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, "planId must be a string");
  }
  const policy = parseProjectPolicyInput(input.policy);
  return {
    name: name.trim(),
    planId,
    policy,
  };
}

function assertAdmin(actorToken?: string): string {
  if (!isAuthorized(actorToken)) {
    throw new ControlPlaneError(ControlPlaneErrorCode.UNAUTHORIZED, "Unauthorized");
  }
  return toPublicActor(actorToken);
}

function replaceJob(job: JobMetadata): void {
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
    if (error.code === ProjectsErrorCode.PROJECT_NOT_FOUND) {
      throw new ControlPlaneError(ControlPlaneErrorCode.CONFLICT, error.message);
    }
    if (error.code === ProjectsErrorCode.POLICY_INVALID || error.code === ProjectsErrorCode.KEY_INVALID) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, error.message);
    }
    throw new ControlPlaneError(ControlPlaneErrorCode.DEPENDENCY_FAILED, error.message);
  }
  if (error instanceof StyleError) {
    if (
      error.code === StyleErrorCode.NOT_FOUND
      || error.code === StyleErrorCode.VERSION_NOT_FOUND
      || error.code === StyleErrorCode.PUBLISH_CONFLICT
    ) {
      throw new ControlPlaneError(ControlPlaneErrorCode.CONFLICT, error.message);
    }
    if (error.code === StyleErrorCode.BAD_REQUEST || error.code === StyleErrorCode.INVALID_DOCUMENT) {
      throw new ControlPlaneError(ControlPlaneErrorCode.BAD_REQUEST, error.message);
    }
    throw new ControlPlaneError(ControlPlaneErrorCode.DEPENDENCY_FAILED, error.message);
  }
  if (error instanceof ArtifactError) {
    if (error.code === ArtifactErrorCode.NOT_FOUND || error.code === ArtifactErrorCode.PROMOTION_CONFLICT || error.code === ArtifactErrorCode.ROLLBACK_UNAVAILABLE) {
      throw new ControlPlaneError(ControlPlaneErrorCode.CONFLICT, error.message);
    }
    if (error.code === ArtifactErrorCode.NOT_VALIDATED) {
      throw new ControlPlaneError(ControlPlaneErrorCode.FORBIDDEN, error.message);
    }
    throw new ControlPlaneError(ControlPlaneErrorCode.DEPENDENCY_FAILED, error.message);
  }
  if (error instanceof Error && error.name === "ConfigError") {
    throw new ControlPlaneError(ControlPlaneErrorCode.DEPENDENCY_FAILED, error.message);
  }
  throw new ControlPlaneError(ControlPlaneErrorCode.DEPENDENCY_FAILED, "Control plane operation failed");
}

function summarizeArtifactList(artifacts: ReturnType<typeof listArtifacts>): ArtifactSummary[] {
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
  loadConfig();
  const actor = assertAdmin(actorToken);
  const id = nextJobId();
  const snapshot = buildDefaultSnapshot();
  const startedAt = new Date().toISOString();
  const job: JobMetadata = {
    jobId: id,
    status: "started",
    startedAt,
    actor,
  };
  addJob({
    ...job,
    snapshotId: snapshot.snapshotId,
    outcome: "ok",
  });
  addAudit({
    actor,
    operation: "ingest",
    outcome: "ok",
    startedAt,
    completedAt: undefined,
  });

  void runIngestPipeline(snapshot)
    .then((report): void => {
      registerArtifact(buildArtifactMetadata(report));
      const completedJob: JobMetadata = {
        ...job,
        status: "finished",
        completedAt: new Date().toISOString(),
        outcome: "ok",
      };
      replaceJob(completedJob);
      addAudit({
        actor,
        operation: "ingest",
        outcome: "ok",
        startedAt,
        completedAt: completedJob.completedAt,
        message: report.artifactId,
      });
    })
    .catch((error: unknown): void => {
      const failureMessage = normalizeErrorMessage(error);
      const failedJob: JobMetadata = {
        ...job,
        status: "failed",
        completedAt: new Date().toISOString(),
        outcome: "failed",
      };
      replaceJob(failedJob);
      addAudit({
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

export function listArtifactsEndpoint(actorToken?: string): ArtifactSummary[] {
  const actor = assertAdmin(actorToken);
  const artifacts = listArtifacts();
  addAudit({
    actor,
    operation: "list_artifacts",
    outcome: "ok",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    message: `${artifacts.length} artifacts listed`,
  });
  return summarizeArtifactList(artifacts);
}

export function promoteArtifactEndpoint(versionId: string, actorToken?: string): ReturnType<typeof promoteArtifact> {
  const actor = assertAdmin(actorToken);
  const normalizedVersionId = normalizeRequiredId(versionId, "versionId");
  const startedAt = new Date().toISOString();
  try {
    const pointer = promoteArtifact(normalizedVersionId);
    addAudit({
      actor,
      operation: "promote_artifact",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizedVersionId,
    });
    return pointer;
  } catch (error: unknown) {
    addAudit({
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

export function rollbackArtifactEndpoint(actorToken?: string): ReturnType<typeof rollbackArtifact> {
  const actor = assertAdmin(actorToken);
  const startedAt = new Date().toISOString();
  try {
    const pointer = rollbackArtifact();
    addAudit({
      actor,
      operation: "rollback_artifact",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
    });
    return pointer;
  } catch (error: unknown) {
    addAudit({
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

export function createProjectEndpoint(input: unknown, actorToken?: string): ReturnType<typeof createProject> {
  const actor = assertAdmin(actorToken);
  const startedAt = new Date().toISOString();
  try {
    const parsedInput = parseCreateProjectInput(input);
    const created = createProject(parsedInput);
    addAudit({
      actor,
      operation: "create_project",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: created.id,
    });
    return created;
  } catch (error: unknown) {
    addAudit({
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

export function rotateApiKeyEndpoint(projectId: string, actorToken?: string): ReturnType<typeof rotateApiKey> {
  const actor = assertAdmin(actorToken);
  const normalizedProjectId = normalizeRequiredId(projectId, "projectId");
  const startedAt = new Date().toISOString();
  try {
    const key = rotateApiKey(normalizedProjectId);
    addAudit({
      actor,
      operation: "rotate_api_key",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: normalizedProjectId,
    });
    return key;
  } catch (error: unknown) {
    addAudit({
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

export function getProjectUsageEndpoint(projectId: string, window: UsageCounterWindow, actorToken?: string): ReturnType<typeof getUsageSummary> {
  const actor = assertAdmin(actorToken);
  const normalizedProjectId = normalizeRequiredId(projectId, "projectId");
  const startedAt = new Date().toISOString();
  const usage = getUsageSummary(normalizedProjectId, window);
  addAudit({
    actor,
    operation: "get_project_usage",
    outcome: "ok",
    startedAt,
    completedAt: new Date().toISOString(),
    message: `${normalizedProjectId}:${window}:${usage.length}`,
  });
  return usage;
}

export function createStyleVersionEndpoint(styleId: string, input: unknown, actorToken?: string): ReturnType<typeof createStyleVersion> {
  const actor = assertAdmin(actorToken);
  const normalizedStyleId = normalizeRequiredId(styleId, "styleId");
  const startedAt = new Date().toISOString();
  try {
    const version = createStyleVersion(normalizedStyleId, input);
    addAudit({
      actor,
      operation: "create_style_version",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: `${normalizedStyleId}/${version.id}`,
    });
    return version;
  } catch (error: unknown) {
    addAudit({
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

export function publishStyleVersionEndpoint(styleId: string, versionId: string, actorToken?: string): ReturnType<typeof publishStyleVersion> {
  const actor = assertAdmin(actorToken);
  const normalizedStyleId = normalizeRequiredId(styleId, "styleId");
  const normalizedVersionId = normalizeRequiredId(versionId, "versionId");
  const startedAt = new Date().toISOString();
  try {
    const version = publishStyleVersion(normalizedStyleId, normalizedVersionId);
    addAudit({
      actor,
      operation: "publish_style_version",
      outcome: "ok",
      startedAt,
      completedAt: new Date().toISOString(),
      message: `${normalizedStyleId}/${normalizedVersionId}`,
    });
    return version;
  } catch (error: unknown) {
    addAudit({
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

export function healthStatusEndpoint(actorToken?: string): HealthStatus {
  assertAdmin(actorToken);
  loadConfig();
  const now = Date.now();
  const recentAudit = auditLog.filter((event) => now - Date.parse(event.startedAt) < 1000 * 60 * 5).length;
  return {
    ok: true,
    storageReachable: true,
    configVersion: "v1",
    auditEventsInWindow: recentAudit,
  };
}
