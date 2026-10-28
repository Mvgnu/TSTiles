import { createHash, randomUUID, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { loadConfig } from "../../config/load-config";
import { ConfigError, type RuntimeConfig } from "../../config/types";
import { prisma } from "../../config/db";
import {
  ProjectsError,
  ProjectsErrorCode,
  type ApiKeyRecord,
  type IssuedApiKey,
  type Project,
  type ProjectCreationInput,
  type ProjectIdentity,
  type ProjectPolicy,
  type ProjectPolicyInput,
  type ProjectUpdateInput,
} from "./types";

const defaultPlanId = "free";
const defaultWorkspaceId = "default-workspace";
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

let initialized = false;

function clonePolicy(policy: ProjectPolicy): ProjectPolicy {
  return {
    allowedOrigins: policy.allowedOrigins ? [...policy.allowedOrigins] : undefined,
    allowedEndpoints: {
      tiles: policy.allowedEndpoints.tiles,
      raster: policy.allowedEndpoints.raster,
      staticMaps: policy.allowedEndpoints.staticMaps,
    },
    quotas: policy.quotas
      ? {
        dailyRequests: policy.quotas.dailyRequests,
        monthlyRequests: policy.quotas.monthlyRequests,
        minuteRequests: policy.quotas.minuteRequests,
      }
      : undefined,
    cache: policy.cache
      ? {
        tileTtlSeconds: policy.cache.tileTtlSeconds,
        metadataTtlSeconds: policy.cache.metadataTtlSeconds,
      }
      : undefined,
  };
}

function serializePolicy(policy: ProjectPolicy): string {
  return JSON.stringify(policy);
}

function parsePolicy(raw: string): ProjectPolicy {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw buildProjectsPolicyError("stored project policy is invalid");
  }
  if (!isRecord(parsed)) {
    throw buildProjectsPolicyError("stored project policy is invalid");
  }
  return deriveProjectPolicy(parsed as ProjectPolicyInput);
}

function formatProjectFromDb(dbProject: { id: string, workspaceId: string, name: string, policy: string, planId: string, createdAt: string }): Project {
  return {
    id: dbProject.id,
    workspaceId: dbProject.workspaceId,
    name: dbProject.name,
    policy: parsePolicy(dbProject.policy),
    planId: dbProject.planId,
    createdAt: dbProject.createdAt,
  };
}

function normalizePersistedProjectRecord(value: unknown): Project | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const workspaceId = typeof value.workspaceId === "string" ? value.workspaceId.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const planId = typeof value.planId === "string" ? value.planId.trim() : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt.trim() : "";
  const policy = typeof value.policy === "string" ? value.policy : null;
  if (
    id.length === 0
    || workspaceId.length === 0
    || name.length === 0
    || planId.length === 0
    || createdAt.length === 0
    || policy === null
  ) {
    return null;
  }
  return formatProjectFromDb({
    id,
    workspaceId,
    name,
    policy,
    planId,
    createdAt,
  });
}

function formatApiKeyFromDb(dbKey: { projectId: string, keyId: string, keyHash: string, keyIdHash: string, createdAt: string, revoked: boolean }): ApiKeyRecord {
  return {
    projectId: dbKey.projectId,
    keyId: dbKey.keyId,
    keyHash: dbKey.keyHash,
    keyIdHash: dbKey.keyIdHash,
    createdAt: dbKey.createdAt,
    revoked: dbKey.revoked,
  };
}

function normalizePersistedApiKeyRecord(value: unknown): ApiKeyRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const projectId = typeof value.projectId === "string" ? value.projectId.trim() : "";
  const keyId = typeof value.keyId === "string" ? value.keyId.trim() : "";
  const keyHash = typeof value.keyHash === "string" ? value.keyHash.trim() : "";
  const keyIdHash = typeof value.keyIdHash === "string" ? value.keyIdHash.trim() : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt.trim() : "";
  const revoked = value.revoked;
  if (
    projectId.length === 0
    || keyId.length === 0
    || keyHash.length === 0
    || keyIdHash.length === 0
    || createdAt.length === 0
    || typeof revoked !== "boolean"
  ) {
    return null;
  }
  return {
    projectId,
    keyId,
    keyHash,
    keyIdHash,
    createdAt,
    revoked,
  };
}

function cloneProject(project: Project): Project {
  return {
    ...project,
    policy: clonePolicy(project.policy),
  };
}

function cloneApiKey(record: ApiKeyRecord): ApiKeyRecord {
  return {
    ...record,
  };
}

function cloneIssuedApiKey(key: IssuedApiKey): IssuedApiKey {
  return {
    ...cloneApiKey(key),
    token: key.token,
  };
}

function buildProjectsPolicyError(message: string): ProjectsError {
  return new ProjectsError(ProjectsErrorCode.POLICY_INVALID, message);
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function normalizeToken(raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string") {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProjectName(name: unknown): string {
  if (typeof name !== "string") {
    throw buildProjectsPolicyError("name must be a string");
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw buildProjectsPolicyError("name must be non-empty");
  }
  return trimmed;
}

function normalizeProjectId(projectId: unknown): string {
  if (typeof projectId !== "string") {
    throw buildProjectsPolicyError("projectId must be a string");
  }
  const normalized = projectId.trim();
  if (normalized.length === 0) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "projectId is required");
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized.includes("..")) {
    throw buildProjectsPolicyError("projectId contains unsupported path characters");
  }
  return normalized;
}

function normalizeKeyId(keyId: unknown): string {
  if (typeof keyId !== "string") {
    throw buildProjectsPolicyError("keyId must be a string");
  }
  const normalized = keyId.trim();
  if (normalized.length === 0) {
    throw new ProjectsError(ProjectsErrorCode.KEY_INVALID, "keyId is required");
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized.includes("..")) {
    throw buildProjectsPolicyError("keyId contains unsupported path characters");
  }
  return normalized;
}

function normalizePlanId(planId: unknown): string {
  if (planId === undefined) {
    return defaultPlanId;
  }
  if (typeof planId !== "string") {
    throw buildProjectsPolicyError("planId must be a string");
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

function normalizeWorkspaceId(workspaceId: unknown): string {
  if (workspaceId === undefined) {
    return defaultWorkspaceId;
  }
  if (typeof workspaceId !== "string") {
    throw buildProjectsPolicyError("workspaceId must be a string");
  }
  const trimmed = workspaceId.trim();
  if (trimmed.length === 0) {
    throw buildProjectsPolicyError("workspaceId must be non-empty");
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(trimmed)) {
    throw buildProjectsPolicyError("workspaceId must be alphanumeric (plus _ or -)");
  }
  return trimmed;
}

function normalizeAllowedOrigin(origin: string): string {
  const trimmed = origin.trim();
  if (trimmed.length === 0) {
    throw buildProjectsPolicyError("allowedOrigins entries must be non-empty strings");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw buildProjectsPolicyError("allowedOrigins entries must be absolute http(s) origins");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw buildProjectsPolicyError("allowedOrigins entries must be absolute http(s) origins");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw buildProjectsPolicyError("allowedOrigins entries must not include credentials");
  }
  if (parsed.pathname !== "/" || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw buildProjectsPolicyError("allowedOrigins entries must be bare origins without path, query, or fragment");
  }
  return parsed.origin;
}

async function buildProjectId(name: string): Promise<string> {
  const base = name.replace(/\W+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "project";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const candidate = `${base}-${suffix}`;
    const existing = await prisma.project.findUnique({ where: { id: candidate } });
    if (!existing) {
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
  const normalizedOrigins: string[] = [];
  const seenOrigins = new Set<string>();
  for (const origin of origins) {
    if (typeof origin !== "string") {
      throw buildProjectsPolicyError("allowedOrigins entries must be non-empty strings");
    }
    const normalized = normalizeAllowedOrigin(origin);
    if (seenOrigins.has(normalized)) {
      continue;
    }
    seenOrigins.add(normalized);
    normalizedOrigins.push(normalized);
  }
  return normalizedOrigins;
}

function validateQuotaPolicy(quotas: unknown): ProjectPolicy["quotas"] {
  if (quotas === undefined) {
    return undefined;
  }
  if (!isRecord(quotas)) {
    throw buildProjectsPolicyError("quotas must be an object");
  }
  const dailyRequests = quotas.dailyRequests;
  const monthlyRequests = quotas.monthlyRequests;
  const minuteRequests = quotas.minuteRequests;
  if (dailyRequests !== undefined && !isPositiveInteger(dailyRequests)) {
    throw buildProjectsPolicyError("dailyRequests must be a positive integer");
  }
  if (monthlyRequests !== undefined && !isPositiveInteger(monthlyRequests)) {
    throw buildProjectsPolicyError("monthlyRequests must be a positive integer");
  }
  if (minuteRequests !== undefined && !isPositiveInteger(minuteRequests)) {
    throw buildProjectsPolicyError("minuteRequests must be a positive integer");
  }
  return {
    dailyRequests: dailyRequests as number | undefined,
    monthlyRequests: monthlyRequests as number | undefined,
    minuteRequests: minuteRequests as number | undefined,
  };
}

function validateCachePolicy(cache: unknown): ProjectPolicy["cache"] {
  if (cache === undefined) {
    return undefined;
  }
  if (!isRecord(cache)) {
    throw buildProjectsPolicyError("cache must be an object");
  }
  const tileTtlSeconds = cache.tileTtlSeconds;
  const metadataTtlSeconds = cache.metadataTtlSeconds;
  if (tileTtlSeconds !== undefined && !isPositiveInteger(tileTtlSeconds)) {
    throw buildProjectsPolicyError("tileTtlSeconds must be a positive integer");
  }
  if (metadataTtlSeconds !== undefined && !isPositiveInteger(metadataTtlSeconds)) {
    throw buildProjectsPolicyError("metadataTtlSeconds must be a positive integer");
  }
  return {
    tileTtlSeconds: tileTtlSeconds as number | undefined,
    metadataTtlSeconds: metadataTtlSeconds as number | undefined,
  };
}

function validateAllowedEndpoints(
  endpoints: unknown,
  base: ProjectPolicy["allowedEndpoints"] = defaultPolicy.allowedEndpoints,
): ProjectPolicy["allowedEndpoints"] {
  if (endpoints === undefined) {
    return {
      tiles: base.tiles,
      raster: base.raster,
      staticMaps: base.staticMaps,
    };
  }
  if (!isRecord(endpoints)) {
    throw buildProjectsPolicyError("allowedEndpoints must be an object");
  }
  const tiles = endpoints.tiles;
  const raster = endpoints.raster;
  const staticMaps = endpoints.staticMaps;
  if (tiles !== undefined && typeof tiles !== "boolean") {
    throw buildProjectsPolicyError("allowedEndpoints.tiles must be boolean");
  }
  if (raster !== undefined && typeof raster !== "boolean") {
    throw buildProjectsPolicyError("allowedEndpoints.raster must be boolean");
  }
  if (staticMaps !== undefined && typeof staticMaps !== "boolean") {
    throw buildProjectsPolicyError("allowedEndpoints.staticMaps must be boolean");
  }
  return {
    tiles: tiles as boolean ?? base.tiles,
    raster: raster as boolean ?? base.raster,
    staticMaps: staticMaps as boolean ?? base.staticMaps,
  };
}

function deriveProjectPolicy(input?: ProjectPolicyInput, basePolicy?: ProjectPolicy): ProjectPolicy {
  const base = basePolicy ?? defaultPolicy;
  const normalizedAllowedOrigins = input && Object.prototype.hasOwnProperty.call(input, "allowedOrigins")
    ? validateAllowedOrigins(input.allowedOrigins)
    : base.allowedOrigins;
  const validatedQuotas = input && Object.prototype.hasOwnProperty.call(input, "quotas")
    ? validateQuotaPolicy(input.quotas)
    : base.quotas;
  const validatedCache = input && Object.prototype.hasOwnProperty.call(input, "cache")
    ? validateCachePolicy(input.cache)
    : base.cache;
  const validatedAllowedEndpoints = input && Object.prototype.hasOwnProperty.call(input, "allowedEndpoints")
    ? validateAllowedEndpoints(input.allowedEndpoints, base.allowedEndpoints)
    : base.allowedEndpoints;
  return {
    allowedEndpoints: validatedAllowedEndpoints,
    quotas: {
      ...defaultPolicy.quotas,
      ...base.quotas,
      ...validatedQuotas,
    },
    allowedOrigins: normalizedAllowedOrigins,
    cache: {
      ...defaultPolicy.cache,
      ...base.cache,
      ...validatedCache,
    },
  };
}

async function bootstrapLegacyProjects(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;
  let config: RuntimeConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      return;
    }
    throw error;
  }
  if (config.security.allowedTokens.length === 0) {
    return;
  }
  
  const existingLegacy = await prisma.project.findUnique({ where: { name: "legacy" } });
  let legacyId = existingLegacy?.id;
  
  if (!existingLegacy) {
    const created = await createProjectRecord({ name: "legacy" });
    legacyId = created.id;
  }
  
  if (legacyId) {
    for (const rawToken of config.security.allowedTokens) {
      const keyHash = hashToken(rawToken);
      const existingKey = await prisma.apiKey.findUnique({ where: { keyHash } });
      if (!existingKey) {
        await registerApiKey(legacyId, rawToken);
      }
    }
  }
}

async function registerApiKey(projectId: string, rawToken: string): Promise<ApiKeyRecord> {
  const keyHash = hashToken(rawToken);
  const keyId = buildKeyId(keyHash);
  
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "project not found");
  }

  const record = await prisma.apiKey.create({
    data: {
      projectId,
      keyId,
      keyHash,
      keyIdHash: keyIdHashFromKeyHash(keyHash),
      createdAt: new Date().toISOString(),
      revoked: false,
    }
  });

  return cloneApiKey(formatApiKeyFromDb(record));
}

export async function verifyApiKey(rawToken: string): Promise<ApiKeyRecord | null> {
  await bootstrapLegacyProjects();
  const token = normalizeToken(rawToken);
  if (!token) {
    return null;
  }
  const keyHash = hashToken(token);
  const record = await prisma.apiKey.findUnique({ where: { keyHash } });
  
  if (!record || record.revoked) {
    return null;
  }
  const normalizedRecord = normalizePersistedApiKeyRecord(record);
  if (!normalizedRecord || normalizedRecord.revoked) {
    return null;
  }
  const project = await prisma.project.findUnique({
    where: { id: normalizedRecord.projectId },
    select: { id: true },
  });
  if (!project) {
    return null;
  }
  return cloneApiKey(normalizedRecord);
}

export async function resolveProjectIdentity(input: { rawToken?: string } | string): Promise<ProjectIdentity | null> {
  const rawToken = typeof input === "string"
    ? input
    : (typeof input === "object" && input !== null && "rawToken" in input ? input.rawToken : undefined);
  const record = await verifyApiKey(rawToken ?? "");
  if (!record) {
    return null;
  }
  const project = await prisma.project.findUnique({ where: { id: record.projectId } });
  if (!project) {
    return null;
  }
  const normalizedProject = normalizePersistedProjectRecord(project);
  if (!normalizedProject) {
    return null;
  }
  return {
    projectId: normalizedProject.id,
    keyId: record.keyId,
    keyHash: record.keyHash,
    keyIdHash: record.keyIdHash,
    planId: normalizedProject.planId,
    workspaceId: normalizedProject.workspaceId,
  };
}

export async function listProjects(): Promise<Project[]> {
  await bootstrapLegacyProjects();
  const projects = await prisma.project.findMany({
    orderBy: [
      { createdAt: "desc" },
      { id: "asc" },
    ],
  });
  return projects
    .map((project) => normalizePersistedProjectRecord(project))
    .filter((project): project is Project => project !== null)
    .map((project) => cloneProject(project));
}

export async function listProjectsByWorkspace(workspaceId: string): Promise<Project[]> {
  await bootstrapLegacyProjects();
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const projects = await prisma.project.findMany({
    where: { workspaceId: normalizedWorkspaceId },
    orderBy: [
      { createdAt: "desc" },
      { id: "asc" },
    ],
  });
  return projects
    .map((project) => normalizePersistedProjectRecord(project))
    .filter((project): project is Project => project !== null)
    .map((project) => cloneProject(project));
}

export async function getProjectPolicy(projectId: string): Promise<Project["policy"]> {
  await bootstrapLegacyProjects();
  const normalizedProjectId = normalizeProjectId(projectId);
  const project = await prisma.project.findUnique({ where: { id: normalizedProjectId } });
  if (!project) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "project not found");
  }
  const normalizedProject = normalizePersistedProjectRecord(project);
  if (!normalizedProject) {
    throw buildProjectsPolicyError("stored project is invalid");
  }
  return clonePolicy(normalizedProject.policy);
}

export async function createProject(input: ProjectCreationInput): Promise<Project> {
  await bootstrapLegacyProjects();
  if (!isRecord(input)) {
    throw buildProjectsPolicyError("project input must be an object");
  }
  const projectInput = input as ProjectCreationInput;
  return await createProjectRecord(projectInput);
}

async function createProjectRecord(input: ProjectCreationInput): Promise<Project> {
  const name = normalizeProjectName(input.name);
  const normalizedPlanId = normalizePlanId(input.planId);
  const normalizedWorkspaceId = normalizeWorkspaceId(input.workspaceId);
  const policy = serializePolicy(deriveProjectPolicy(input.policy));
  
  const projectId = await buildProjectId(name);
  
  let created: {
    id: string;
    workspaceId: string;
    name: string;
    policy: string;
    planId: string;
    createdAt: string;
  };
  try {
    created = await prisma.project.create({
      data: {
        id: projectId,
        workspaceId: normalizedWorkspaceId,
        name,
        policy,
        planId: normalizedPlanId,
        createdAt: new Date().toISOString(),
      }
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw buildProjectsPolicyError("project name already exists");
    }
    throw error;
  }

  return cloneProject(formatProjectFromDb(created));
}

export async function updateProject(projectId: string, input: ProjectUpdateInput): Promise<Project> {
  await bootstrapLegacyProjects();
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!isRecord(input)) {
    throw buildProjectsPolicyError("project update must be an object");
  }
  const projectUpdate = input as ProjectUpdateInput;
  
  const current = await prisma.project.findUnique({ where: { id: normalizedProjectId } });
  if (!current) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "project not found");
  }
  
  const updatedPolicy = projectUpdate.policy === undefined 
    ? current.policy 
    : serializePolicy(deriveProjectPolicy(projectUpdate.policy, parsePolicy(current.policy)));

  let updated: {
    id: string;
    workspaceId: string;
    name: string;
    policy: string;
    planId: string;
    createdAt: string;
  };
  try {
    updated = await prisma.project.update({
      where: { id: normalizedProjectId },
      data: {
        name: projectUpdate.name === undefined ? current.name : normalizeProjectName(projectUpdate.name),
        planId: projectUpdate.planId === undefined ? current.planId : normalizePlanId(projectUpdate.planId),
        policy: updatedPolicy,
      }
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw buildProjectsPolicyError("project name already exists");
    }
    throw error;
  }

  return cloneProject(formatProjectFromDb(updated));
}

export async function syncWorkspaceProjectPlan(workspaceId: string, planId: string): Promise<Project[]> {
  await bootstrapLegacyProjects();
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const normalizedPlanId = normalizePlanId(planId);

  return await prisma.$transaction(async (tx) => {
    const projectsToUpdate = await tx.project.findMany({
      where: {
        workspaceId: normalizedWorkspaceId,
        planId: { not: normalizedPlanId },
      },
      orderBy: { id: "asc" },
    });

    if (projectsToUpdate.length === 0) {
      return [];
    }

    const projectIds = projectsToUpdate.map((project) => project.id);
    await tx.project.updateMany({
      where: { id: { in: projectIds } },
      data: { planId: normalizedPlanId },
    });

    const updatedProjects = await tx.project.findMany({
      where: { id: { in: projectIds } },
      orderBy: { id: "asc" },
    });

    return updatedProjects.map((project) => cloneProject(formatProjectFromDb(project)));
  });
}

export async function rotateApiKey(projectId: string): Promise<IssuedApiKey> {
  await bootstrapLegacyProjects();
  const normalizedProjectId = normalizeProjectId(projectId);
  const rawKey = randomBytes(24).toString("base64url");
  const keyHash = hashToken(rawKey);
  const keyId = buildKeyId(keyHash);
  const keyIdHash = keyIdHashFromKeyHash(keyHash);
  const createdAt = new Date().toISOString();

  const registered = await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: normalizedProjectId } });
    if (!project) {
      throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "project not found");
    }

    await tx.apiKey.updateMany({
      where: { projectId: project.id, revoked: false },
      data: { revoked: true }
    });

    const record = await tx.apiKey.create({
      data: {
        projectId: project.id,
        keyId,
        keyHash,
        keyIdHash,
        createdAt,
        revoked: false,
      }
    });

    return cloneApiKey(formatApiKeyFromDb(record));
  });
  
  const issued: IssuedApiKey = {
    ...registered,
    token: rawKey,
  };
  return cloneIssuedApiKey(issued);
}

export async function revokeApiKey(projectId: string, keyId: string): Promise<ApiKeyRecord> {
  await bootstrapLegacyProjects();
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedKeyId = normalizeKeyId(keyId);
  
  const record = await prisma.apiKey.findUnique({ where: { keyId: normalizedKeyId } });
  if (!record || record.projectId !== normalizedProjectId) {
    throw new ProjectsError(ProjectsErrorCode.KEY_INVALID, "key not found");
  }
  
  if (record.revoked) {
    return cloneApiKey(formatApiKeyFromDb(record));
  }
  
  const revoked = await prisma.apiKey.update({
    where: { keyId: normalizedKeyId },
    data: { revoked: true }
  });
  
  return cloneApiKey(formatApiKeyFromDb(revoked));
}

export async function listProjectKeys(projectId: string): Promise<ApiKeyRecord[]> {
  await bootstrapLegacyProjects();
  const normalizedProjectId = normalizeProjectId(projectId);
  const project = await prisma.project.findUnique({ where: { id: normalizedProjectId } });
  if (!project) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "project not found");
  }
  
  const keys = await prisma.apiKey.findMany({
    where: { projectId: normalizedProjectId },
    orderBy: [
      { createdAt: "desc" },
      { keyId: "desc" },
    ],
  });
  
  return keys
    .map((record) => normalizePersistedApiKeyRecord(record))
    .filter((record): record is ApiKeyRecord => record !== null)
    .map((record) => cloneApiKey(record));
}

export async function deleteProject(projectId: string): Promise<void> {
  await bootstrapLegacyProjects();
  const normalizedProjectId = normalizeProjectId(projectId);

  const project = await prisma.project.findUnique({ where: { id: normalizedProjectId } });
  if (!project) {
    throw new ProjectsError(ProjectsErrorCode.PROJECT_NOT_FOUND, "project not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.apiKey.updateMany({
      where: { projectId: normalizedProjectId, revoked: false },
      data: { revoked: true },
    });
    await tx.project.delete({
      where: { id: normalizedProjectId }
    });
  });
}
