import { createHash, randomUUID, randomBytes } from "node:crypto";
import { loadConfig } from "../../config/load-config";
import {
  ProjectsError,
  ProjectsErrorCode,
  type ApiKeyRecord,
  type Project,
  type ProjectCreationInput,
  type ProjectIdentity,
  type ProjectPolicy,
} from "./types";

const defaultPlanId = "free";
const defaultPolicy: ProjectPolicy = {
  allowedEndpoints: {
    tiles: true,
    raster: true,
    staticMaps: true,
  },
  quotas: {
    dailyRequests: 100_000,
    monthlyRequests: 3_000_000,
  },
};

const projects = new Map<string, Project>();
const apiKeys = new Map<string, ApiKeyRecord>();
let initialized = false;

function buildProjectsPolicyError(message: string): ProjectsError {
  return new ProjectsError(ProjectsErrorCode.POLICY_INVALID, message);
}

function normalizeToken(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    const bearerToken = trimmed.slice(7).trim();
    return bearerToken.length > 0 ? bearerToken : undefined;
  }
  return trimmed;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function buildKeyId(rawHash: string): string {
  return `k_${rawHash.slice(0, 12)}`;
}

function keyIdHashFromKeyHash(keyHash: string): string {
  return keyHash.slice(0, 16);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeProjectName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw buildProjectsPolicyError("name must be non-empty");
  }
  return trimmed;
}

function normalizeProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (normalized.length === 0) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "projectId is required");
  }
  return normalized;
}

function normalizePlanId(planId: string | undefined): string {
  if (planId === undefined) {
    return defaultPlanId;
  }
  const trimmed = planId.trim();
  if (trimmed.length === 0) {
    throw buildProjectsPolicyError("planId must be non-empty");
  }
  // planId participates in metering composite keys, so delimiters are disallowed.
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(trimmed)) {
    throw buildProjectsPolicyError("planId must be alphanumeric (plus _ or -)");
  }
  return trimmed.toLowerCase();
}

function buildProjectId(name: string): string {
  const base = name.replace(/\W+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "project";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const candidate = `${base}-${suffix}`;
    if (!projects.has(candidate)) {
      return candidate;
    }
  }
  throw buildProjectsPolicyError("unable to allocate unique project id");
}

function validateAllowedOrigins(origins: unknown): readonly string[] | undefined {
  if (origins === undefined) {
    return undefined;
  }
  if (!Array.isArray(origins)) {
    throw buildProjectsPolicyError("allowedOrigins must be an array");
  }
  for (const origin of origins) {
    if (typeof origin !== "string" || origin.trim().length === 0) {
      throw buildProjectsPolicyError("allowedOrigins entries must be non-empty strings");
    }
  }
  return origins.map((origin) => origin.trim());
}

function validateQuotaPolicy(quotas: unknown): ProjectPolicy["quotas"] {
  if (quotas === undefined) {
    return undefined;
  }
  if (!quotas || typeof quotas !== "object" || Array.isArray(quotas)) {
    throw buildProjectsPolicyError("quotas must be an object");
  }
  const candidate = quotas as {
    readonly dailyRequests?: unknown;
    readonly monthlyRequests?: unknown;
    readonly minuteRequests?: unknown;
  };
  if (candidate.dailyRequests !== undefined && !isPositiveInteger(candidate.dailyRequests)) {
    throw buildProjectsPolicyError("dailyRequests must be a positive integer");
  }
  if (candidate.monthlyRequests !== undefined && !isPositiveInteger(candidate.monthlyRequests)) {
    throw buildProjectsPolicyError("monthlyRequests must be a positive integer");
  }
  if (candidate.minuteRequests !== undefined && !isPositiveInteger(candidate.minuteRequests)) {
    throw buildProjectsPolicyError("minuteRequests must be a positive integer");
  }
  return {
    dailyRequests: candidate.dailyRequests,
    monthlyRequests: candidate.monthlyRequests,
    minuteRequests: candidate.minuteRequests,
  };
}

function validateCachePolicy(cache: unknown): ProjectPolicy["cache"] {
  if (cache === undefined) {
    return undefined;
  }
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
    throw buildProjectsPolicyError("cache must be an object");
  }
  const candidate = cache as {
    readonly tileTtlSeconds?: unknown;
    readonly metadataTtlSeconds?: unknown;
  };
  if (candidate.tileTtlSeconds !== undefined && !isPositiveInteger(candidate.tileTtlSeconds)) {
    throw buildProjectsPolicyError("tileTtlSeconds must be a positive integer");
  }
  if (candidate.metadataTtlSeconds !== undefined && !isPositiveInteger(candidate.metadataTtlSeconds)) {
    throw buildProjectsPolicyError("metadataTtlSeconds must be a positive integer");
  }
  return {
    tileTtlSeconds: candidate.tileTtlSeconds,
    metadataTtlSeconds: candidate.metadataTtlSeconds,
  };
}

function validateAllowedEndpoints(endpoints: unknown): ProjectPolicy["allowedEndpoints"] {
  if (endpoints === undefined) {
    return defaultPolicy.allowedEndpoints;
  }
  if (!endpoints || typeof endpoints !== "object" || Array.isArray(endpoints)) {
    throw buildProjectsPolicyError("allowedEndpoints must be an object");
  }
  const candidate = endpoints as {
    readonly tiles?: unknown;
    readonly raster?: unknown;
    readonly staticMaps?: unknown;
  };
  if (candidate.tiles !== undefined && typeof candidate.tiles !== "boolean") {
    throw buildProjectsPolicyError("allowedEndpoints.tiles must be boolean");
  }
  if (candidate.raster !== undefined && typeof candidate.raster !== "boolean") {
    throw buildProjectsPolicyError("allowedEndpoints.raster must be boolean");
  }
  if (candidate.staticMaps !== undefined && typeof candidate.staticMaps !== "boolean") {
    throw buildProjectsPolicyError("allowedEndpoints.staticMaps must be boolean");
  }
  return {
    tiles: candidate.tiles ?? true,
    raster: candidate.raster ?? true,
    staticMaps: candidate.staticMaps ?? true,
  };
}

function deriveProjectPolicy(input?: Partial<ProjectPolicy>): ProjectPolicy {
  const normalizedAllowedOrigins = validateAllowedOrigins(input?.allowedOrigins);
  const validatedQuotas = validateQuotaPolicy(input?.quotas);
  const validatedCache = validateCachePolicy(input?.cache);
  const validatedAllowedEndpoints = validateAllowedEndpoints(input?.allowedEndpoints);
  return {
    allowedEndpoints: validatedAllowedEndpoints,
    quotas: {
      ...defaultPolicy.quotas,
      ...validatedQuotas,
    },
    allowedOrigins: normalizedAllowedOrigins,
    cache: {
      ...defaultPolicy.cache,
      ...validatedCache,
    },
  };
}

function bootstrapLegacyProjects(): void {
  if (initialized) {
    return;
  }
  // Mark initialization before seeding to avoid recursive bootstrap via exported createProject().
  initialized = true;
  const config = loadConfig();
  if (config.security.allowedTokens.length === 0) {
    return;
  }
  const legacy = createProjectRecord({
    name: "legacy",
  });
  for (const rawToken of config.security.allowedTokens) {
    registerApiKey(legacy.id, rawToken);
  }
}

function registerApiKey(projectId: string, rawToken: string): ApiKeyRecord {
  const keyHash = hashToken(rawToken);
  const keyId = buildKeyId(keyHash);
  const project = projects.get(projectId);
  if (!project) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "project not found");
  }
  const record: ApiKeyRecord = {
    projectId,
    keyId,
    keyHash,
    keyIdHash: keyIdHashFromKeyHash(keyHash),
    createdAt: new Date().toISOString(),
    revoked: false,
  };
  apiKeys.set(keyHash, record);
  return record;
}

export function verifyApiKey(rawToken: string): ApiKeyRecord | null {
  bootstrapLegacyProjects();
  const token = normalizeToken(rawToken);
  if (!token) {
    return null;
  }
  const keyHash = hashToken(token);
  const record = apiKeys.get(keyHash);
  if (!record || record.revoked) {
    return null;
  }
  return record;
}

export function resolveProjectIdentity(input: { rawToken?: string } | string): ProjectIdentity | null {
  const rawToken = typeof input === "string" ? input : input.rawToken;
  const record = verifyApiKey(rawToken ?? "");
  if (!record) {
    return null;
  }
  const project = projects.get(record.projectId);
  if (!project) {
    return null;
  }
  return {
    projectId: project.id,
    keyId: record.keyId,
    keyHash: record.keyHash,
    keyIdHash: record.keyIdHash,
    planId: project.planId,
  };
}

export function listProjects(): Project[] {
  bootstrapLegacyProjects();
  return [...projects.values()];
}

export function getProjectPolicy(projectId: string): Project["policy"] {
  bootstrapLegacyProjects();
  const normalizedProjectId = normalizeProjectId(projectId);
  const project = projects.get(normalizedProjectId);
  if (!project) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "project not found");
  }
  return project.policy;
}

export function createProject(input: ProjectCreationInput): Project {
  bootstrapLegacyProjects();
  return createProjectRecord(input);
}

function createProjectRecord(input: ProjectCreationInput): Project {
  const name = normalizeProjectName(input.name);
  const normalizedPlanId = normalizePlanId(input.planId);
  const project: Project = {
    id: buildProjectId(name),
    name,
    policy: deriveProjectPolicy(input.policy),
    planId: normalizedPlanId,
    createdAt: new Date().toISOString(),
  };
  projects.set(project.id, project);
  return project;
}

export function rotateApiKey(projectId: string): ApiKeyRecord {
  bootstrapLegacyProjects();
  const normalizedProjectId = normalizeProjectId(projectId);
  const project = projects.get(normalizedProjectId);
  if (!project) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "project not found");
  }
  for (const [keyHash, record] of apiKeys.entries()) {
    if (record.projectId === project.id && !record.revoked) {
      apiKeys.set(keyHash, {
        ...record,
        revoked: true,
      });
    }
  }
  const rawKey = randomBytes(24).toString("base64url");
  return registerApiKey(project.id, rawKey);
}

export function revokeApiKey(projectId: string, keyId: string): ApiKeyRecord {
  bootstrapLegacyProjects();
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedKeyId = keyId.trim();
  if (normalizedKeyId.length === 0) {
    throw new ProjectsError(ProjectsErrorCode.KEY_INVALID, "keyId is required");
  }
  for (const [hash, record] of apiKeys.entries()) {
    if (record.projectId !== normalizedProjectId || record.keyId !== normalizedKeyId) {
      continue;
    }
    if (record.revoked) {
      return record;
    }
    const revokedRecord: ApiKeyRecord = {
      ...record,
      revoked: true,
    };
    apiKeys.set(hash, revokedRecord);
    return revokedRecord;
  }
  throw new ProjectsError(ProjectsErrorCode.KEY_INVALID, "key not found");
}

export function deleteProject(projectId: string): void {
  bootstrapLegacyProjects();
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!projects.delete(normalizedProjectId)) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "project not found");
  }
  for (const [hash, record] of apiKeys.entries()) {
    if (record.projectId === normalizedProjectId) {
      apiKeys.delete(hash);
    }
  }
}
