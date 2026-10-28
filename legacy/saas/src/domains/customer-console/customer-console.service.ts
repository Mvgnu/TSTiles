import { getWorkspaceBilling } from "../billing-sync/billing-sync.service";
import { BillingSyncError } from "../billing-sync/types";
import {
  getWorkspace,
  listWorkspaceMemberships,
  updateWorkspace,
  createCredentialToken,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
  softDeleteWorkspace,
  getUserById,
  getUserByEmail,
  verifyPasswordHash,
  setPasswordHash
} from "../identity/identity.service";
import type { IdentitySession } from "../identity/types";
import { IdentityError } from "../identity/types";
import { getBillingPlan, getUsageSummary } from "../metering/metering.service";
import type { MeteringEndpointGroup, UsageCounterWindow, UsageSummary } from "../metering/types";
import {
  createProject,
  getProjectPolicy,
  listProjectKeys,
  listProjects,
  listProjectsByWorkspace,
  rotateApiKey,
  updateProject,
} from "../projects/projects.service";
import { ProjectsError, ProjectsErrorCode } from "../projects/types";
import type { AllowedEndpointPolicy, Project } from "../projects/types";
import { listStyles } from "../styles/styles.service";
import { StyleError } from "../styles/types";
import { hashPassword } from "../identity/components/password-hash";
import { decryptMfaSecret, encryptMfaSecret } from "../identity/components/mfa-secret-encryption";
import { sendTransactionalEmail, isSuppressed } from "../email/email.service";
import { prisma } from "../../config/db";
import { createHmac, randomBytes } from "node:crypto";
import { contractEventEmitter } from "../../contracts/contracts";
import type { QuotaThresholdEvent } from "../../contracts/types";
import {
  CustomerConsoleError,
  CustomerConsoleErrorCode,
  type ConsoleBootstrap,
  type ConsoleCurrentUser,
  type ConsoleFirstIntegration,
  type ConsoleMembership,
  type ConsoleProjectCreateInput,
  type ConsoleProjectDetail,
  type ConsoleProjectProvisionResult,
  type ConsoleProjectSummary,
  type ConsoleProjectUsageWindow,
  type ConsoleSettings,
  type ConsoleSettingsUpdateInput,
  type ConsoleStyleDetail,
  type ConsoleStyleSummary,
  type ConsoleProjectUpdateInput,
  type ConsoleWorkspace,
  type IntegrationSnippets,
  type UsageBreakdown,
  type UsageSummaryCard,
  type ConsoleNotification,
} from "./types";

const DEFAULT_WORKSPACE: ConsoleWorkspace = {
  id: "default-workspace",
  name: "Default Workspace",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildError(code: CustomerConsoleErrorCode, details: string): CustomerConsoleError {
  return new CustomerConsoleError(code, details);
}

function normalizeWorkspaceId(workspaceId?: unknown): string {
  if (workspaceId === undefined) {
    return DEFAULT_WORKSPACE.id;
  }
  if (typeof workspaceId !== "string") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "workspaceId contains unsupported path characters");
  }
  const normalized = workspaceId.trim();
  if (normalized.length === 0) {
    return DEFAULT_WORKSPACE.id;
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized.includes("..")) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "workspaceId contains unsupported path characters");
  }
  return normalized;
}

function normalizeConsoleResourceId(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, `${field} is required`);
  }
  if (normalized.includes("/") || normalized.includes("\\") || normalized === "." || normalized.includes("..")) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, `${field} contains unsupported path characters`);
  }
  return normalized;
}

function normalizeConsoleSessionIdentifier(value: unknown, field: string): string {
  return normalizeConsoleResourceId(value, field);
}

function normalizeUsageWindow(window: ConsoleProjectUsageWindow): ConsoleProjectUsageWindow {
  const normalized = String(window).trim().toLowerCase();
  if (normalized === "day" || normalized === "month") {
    return normalized;
  }
  throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "usage window must be day or month");
}

function toConsoleCurrentUser(session: Pick<IdentitySession, "user">): ConsoleCurrentUser {
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}

function toConsoleMembership(session: Pick<IdentitySession, "membership">): ConsoleMembership {
  return {
    userId: session.membership.userId,
    role: session.membership.role,
  };
}

function toConsoleWorkspace(workspace: { readonly id: string; readonly name: string }): ConsoleWorkspace {
  return {
    id: workspace.id,
    name: workspace.name,
  };
}

function normalizeConsoleMembershipEntry(value: unknown, workspaceId: string): ConsoleMembership | null {
  if (!isRecord(value)) {
    return null;
  }
  const membershipWorkspaceId = typeof value.workspaceId === "string" ? value.workspaceId.trim() : "";
  const userId = typeof value.userId === "string" ? value.userId.trim() : "";
  const role = value.role;
  if (
    membershipWorkspaceId !== workspaceId
    || userId.length === 0
    || userId.includes("/")
    || userId.includes("\\")
    || userId === "."
    || userId.includes("..")
    || (role !== "owner" && role !== "member")
  ) {
    return null;
  }
  return {
    userId,
    role,
  };
}

function normalizeConsoleSession(
  session: unknown,
): Pick<IdentitySession, "user" | "workspace" | "membership"> {
  if (!isRecord(session)) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "session is required");
  }
  const user = session.user;
  const workspace = session.workspace;
  const membership = session.membership;
  if (!isRecord(user) || !isRecord(workspace) || !isRecord(membership)) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "session is required");
  }
  if (
    typeof user.id !== "string"
    || typeof user.email !== "string"
    || typeof user.name !== "string"
    || typeof user.createdAt !== "string"
    || typeof workspace.id !== "string"
    || typeof workspace.name !== "string"
    || typeof workspace.createdAt !== "string"
    || typeof membership.userId !== "string"
    || typeof membership.workspaceId !== "string"
    || (membership.role !== "owner" && membership.role !== "member")
    || typeof membership.createdAt !== "string"
  ) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "session is required");
  }
  const normalizedUserId = normalizeConsoleSessionIdentifier(user.id, "session.user.id");
  const normalizedWorkspaceId = normalizeConsoleSessionIdentifier(workspace.id, "session.workspace.id");
  const normalizedMembershipUserId = normalizeConsoleSessionIdentifier(membership.userId, "session.membership.userId");
  const normalizedMembershipWorkspaceId = normalizeConsoleSessionIdentifier(membership.workspaceId, "session.membership.workspaceId");
  if (normalizedMembershipUserId !== normalizedUserId || normalizedMembershipWorkspaceId !== normalizedWorkspaceId) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "session is required");
  }
  return {
    user: {
      id: normalizedUserId,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
    workspace: {
      id: normalizedWorkspaceId,
      name: workspace.name,
      createdAt: workspace.createdAt,
    },
    membership: {
      workspaceId: normalizedMembershipWorkspaceId,
      userId: normalizedMembershipUserId,
      role: membership.role,
      createdAt: membership.createdAt,
    },
  };
}

async function listWorkspaceProjectIds(workspaceId: string): Promise<readonly string[]> {
  const projects = await listProjectsByWorkspace(workspaceId);
  return projects
    .map((project) => normalizeConsoleProjectEntry(project))
    .filter((project): project is Project => project !== null)
    .map((project) => project.id);
}

async function listWorkspaceProjects(workspaceId: string): Promise<Project[]> {
  return (await listProjectsByWorkspace(workspaceId))
    .map((project) => normalizeConsoleProjectEntry(project))
    .filter((project): project is Project => project !== null);
}

function normalizeProjectName(name: unknown): string {
  if (typeof name !== "string") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "project name is required");
  }
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "project name is required");
  }
  return normalized;
}

function normalizeConsoleProjectEntry(value: unknown): Project | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const workspaceId = typeof value.workspaceId === "string" ? value.workspaceId.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const planId = typeof value.planId === "string" ? value.planId.trim() : "";
  const createdAt = typeof value.createdAt === "string" ? value.createdAt.trim() : "";
  if (
    id.length === 0
    || workspaceId.length === 0
    || name.length === 0
    || planId.length === 0
    || createdAt.length === 0
    || !isRecord(value.policy)
    || !isRecord(value.policy.allowedEndpoints)
    || typeof value.policy.allowedEndpoints.tiles !== "boolean"
    || typeof value.policy.allowedEndpoints.raster !== "boolean"
    || typeof value.policy.allowedEndpoints.staticMaps !== "boolean"
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    name,
    planId,
    createdAt,
    policy: value.policy as unknown as Project["policy"],
  };
}

export function appendAccessTokenQueryParam(url: string, accessTokenPlaceholder = "{access_token}"): string {
  if (typeof url !== "string" || url.trim().length === 0) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "style url is required");
  }
  if (typeof accessTokenPlaceholder !== "string" || accessTokenPlaceholder.trim().length === 0) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "access token placeholder is required");
  }
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const [pathname, query = ""] = beforeHash.split("?");
  const filtered = query
    .split("&")
    .filter((entry) => entry.length > 0 && !entry.startsWith("access_token="));
  filtered.push(`access_token=${accessTokenPlaceholder}`);
  const nextQuery = filtered.length > 0 ? `?${filtered.join("&")}` : "";
  return `${pathname}${nextQuery}${hash}`;
}

function toAllowedOrigins(origins: readonly string[] | undefined): readonly string[] | undefined {
  if (origins === undefined) {
    return undefined;
  }
  const normalizedOrigins: string[] = [];
  const seenOrigins = new Set<string>();
  for (const entry of origins) {
    const normalized = entry.trim();
    if (normalized.length === 0) {
      throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "allowed origins must be non-empty");
    }
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "allowed origins must be absolute http(s) origins");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "allowed origins must be absolute http(s) origins");
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "allowed origins must not include credentials");
    }
    if (parsed.pathname !== "/" || parsed.search.length > 0 || parsed.hash.length > 0) {
      throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "allowed origins must be bare origins without path, query, or fragment");
    }
    if (!seenOrigins.has(parsed.origin)) {
      seenOrigins.add(parsed.origin);
      normalizedOrigins.push(parsed.origin);
    }
  }
  return normalizedOrigins;
}

function mergeAllowedEndpoints(
  input: Partial<AllowedEndpointPolicy> | undefined,
  base: AllowedEndpointPolicy,
): AllowedEndpointPolicy | undefined {
  if (input === undefined) {
    return undefined;
  }
  return {
    tiles: input.tiles ?? base.tiles,
    raster: input.raster ?? base.raster,
    staticMaps: input.staticMaps ?? base.staticMaps,
  };
}

function normalizeAllowedEndpointsInput(
  value: unknown,
  field: "allowedEndpoints" | "allowedEndpoints update",
): Partial<AllowedEndpointPolicy> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "allowedEndpoints must be an object");
  }
  const tiles = Object.prototype.hasOwnProperty.call(value, "tiles")
    ? (() => {
      if (value.tiles !== undefined && typeof value.tiles !== "boolean") {
        throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, `${field}.tiles must be boolean`);
      }
      return value.tiles;
    })()
    : undefined;
  const raster = Object.prototype.hasOwnProperty.call(value, "raster")
    ? (() => {
      if (value.raster !== undefined && typeof value.raster !== "boolean") {
        throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, `${field}.raster must be boolean`);
      }
      return value.raster;
    })()
    : undefined;
  const staticMaps = Object.prototype.hasOwnProperty.call(value, "staticMaps")
    ? (() => {
      if (value.staticMaps !== undefined && typeof value.staticMaps !== "boolean") {
        throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, `${field}.staticMaps must be boolean`);
      }
      return value.staticMaps;
    })()
    : undefined;
  return {
    ...(tiles === undefined && !Object.prototype.hasOwnProperty.call(value, "tiles") ? {} : { tiles }),
    ...(raster === undefined && !Object.prototype.hasOwnProperty.call(value, "raster") ? {} : { raster }),
    ...(staticMaps === undefined && !Object.prototype.hasOwnProperty.call(value, "staticMaps") ? {} : { staticMaps }),
  };
}

function aggregateUsage(items: ReadonlyArray<UsageSummary>): UsageBreakdown {
  const totals: Record<MeteringEndpointGroup, number> = {
    tiles: 0,
    raster: 0,
    static: 0,
  };
  for (const item of items) {
    totals[item.endpointGroup] += item.requestCount;
  }
  return totals;
}

function toUsageCard(planId: string, window: UsageCounterWindow, items: ReadonlyArray<UsageSummary>): UsageSummaryCard {
  const plan = getBillingPlan(planId);
  const breakdown = aggregateUsage(items);
  const requestCount = breakdown.tiles + breakdown.raster + breakdown.static;
  const includedRequests = plan.freeAllowancePerMonth;
  const percentOfIncludedRequests = includedRequests > 0
    ? Math.min((requestCount / includedRequests) * 100, 999)
    : 0;
  return {
    window,
    requestCount,
    includedRequests,
    percentOfIncludedRequests,
    plan,
    breakdown,
  };
}

async function resolvePrimaryStyleId(): Promise<string | undefined> {
  try {
    const publishedStyleIds = (await listStyles())
      .filter((entry) => entry.publishedVersionId)
      .map((entry) => entry.id)
      .sort((left, right) => left.localeCompare(right));
    return publishedStyleIds[0];
  } catch {
    return undefined;
  }
}

async function buildSnippets(accessTokenPlaceholder = "{access_token}"): Promise<IntegrationSnippets> {
  const styleId = await resolvePrimaryStyleId();
  if (!styleId) {
    return {};
  }
  const encodedStyleId = encodeURIComponent(styleId);
  return {
    styleUrl: `/v1/styles/${encodedStyleId}/style.json?access_token=${accessTokenPlaceholder}`,
    rasterTileUrl: `/v1/raster/${encodedStyleId}/{z}/{x}/{y}.png?access_token=${accessTokenPlaceholder}`,
    staticMapUrl: `/v1/static/${encodedStyleId}/{lon},{lat},{zoom}/{width}x{height}.png?access_token=${accessTokenPlaceholder}`,
  };
}

function normalizePublishedStyleEntry(value: unknown): { readonly id: string; readonly name: string; readonly publishedVersionId: string } | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const publishedVersionId = typeof value.publishedVersionId === "string" ? value.publishedVersionId.trim() : "";
  if (id.length === 0 || name.length === 0 || publishedVersionId.length === 0) {
    return null;
  }
  return {
    id,
    name,
    publishedVersionId,
  };
}

async function buildFirstIntegration(projects: ReadonlyArray<ConsoleProjectSummary>, styles: ReadonlyArray<ConsoleStyleSummary>): Promise<ConsoleFirstIntegration> {
  if (projects.length === 0) {
    return {
      readiness: "needs_project",
      quickstartHref: "/docs/quickstart",
      projectCreateHref: "/app/projects/new",
      snippets: await buildSnippets(),
    };
  }
  if (styles.length === 0) {
    return {
      readiness: "needs_style",
      quickstartHref: "/docs/styles",
      projectCreateHref: `/app/projects/${encodeURIComponent(projects[0]?.id ?? "")}`,
      snippets: {},
    };
  }
  return {
    readiness: "ready",
    quickstartHref: "/docs/quickstart",
    projectCreateHref: `/app/projects/${encodeURIComponent(projects[0]?.id ?? "")}`,
    snippets: await buildSnippets(),
  };
}

function defaultAllowedEndpoints(): AllowedEndpointPolicy {
  return {
    tiles: true,
    raster: true,
    staticMaps: true,
  };
}

function normalizeProjectCreateInput(input: ConsoleProjectCreateInput): ConsoleProjectCreateInput {
  if (!isRecord(input)) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "project payload is required");
  }
  const name = input.name;
  if (typeof name !== "string") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "project name is required");
  }
  const allowedOrigins = input.allowedOrigins;
  if (allowedOrigins !== undefined && !Array.isArray(allowedOrigins)) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "allowedOrigins must be an array");
  }
  const allowedEndpoints = normalizeAllowedEndpointsInput(input.allowedEndpoints, "allowedEndpoints");
  return {
    name,
    allowedOrigins,
    allowedEndpoints,
  };
}

function normalizeProjectUpdateInput(input: ConsoleProjectUpdateInput): ConsoleProjectUpdateInput {
  if (!isRecord(input)) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "project update payload is required");
  }
  const normalizedName = Object.prototype.hasOwnProperty.call(input, "name")
    ? (() => {
      if (input.name !== undefined && typeof input.name !== "string") {
        throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "project name must be a string");
      }
      return input.name;
    })()
    : undefined;
  const normalizedAllowedOrigins = Object.prototype.hasOwnProperty.call(input, "allowedOrigins")
    ? (() => {
      if (input.allowedOrigins !== undefined && !Array.isArray(input.allowedOrigins)) {
        throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "allowedOrigins must be an array");
      }
      return input.allowedOrigins;
    })()
    : undefined;
  const normalizedAllowedEndpoints = Object.prototype.hasOwnProperty.call(input, "allowedEndpoints")
    ? (() => {
      return normalizeAllowedEndpointsInput(input.allowedEndpoints, "allowedEndpoints update");
    })()
    : undefined;
  return {
    ...(Object.prototype.hasOwnProperty.call(input, "name") ? { name: normalizedName } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "allowedOrigins") ? { allowedOrigins: normalizedAllowedOrigins } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "allowedEndpoints") ? { allowedEndpoints: normalizedAllowedEndpoints } : {}),
  };
}

function normalizeSettingsUpdateInput(input: ConsoleSettingsUpdateInput): ConsoleSettingsUpdateInput {
  if (!isRecord(input)) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "settings payload is required");
  }
  const workspaceName = input.workspaceName;
  if (typeof workspaceName !== "string") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "workspaceName is required");
  }
  const normalizedWorkspaceName = workspaceName.trim();
  if (normalizedWorkspaceName.length === 0) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "workspaceName is required");
  }
  return { workspaceName: normalizedWorkspaceName };
}

function toStyleSummary(style: unknown): ConsoleStyleSummary | null {
  const normalized = normalizePublishedStyleEntry(style);
  if (!normalized) {
    return null;
  }
  const encodedStyleId = encodeURIComponent(normalized.id);
  return {
    id: normalized.id,
    name: normalized.name,
    publishedVersionId: normalized.publishedVersionId,
    styleUrl: `/v1/styles/${encodedStyleId}/style.json`,
    rasterTileUrl: `/v1/raster/${encodedStyleId}/{z}/{x}/{y}.png?access_token={access_token}`,
    staticMapUrl: `/v1/static/${encodedStyleId}/{lon},{lat},{zoom}/{width}x{height}.png?access_token={access_token}`,
  };
}

async function listPublishedStyleSummaries(): Promise<ConsoleStyleSummary[]> {
  return (await listStyles())
    .map((style) => toStyleSummary(style))
    .filter((style): style is ConsoleStyleSummary => style !== null);
}

async function getStyleSummaryOrThrow(styleId: string): Promise<ConsoleStyleSummary> {
  const summary = (await listPublishedStyleSummaries()).find((style) => style.id === styleId.trim());
  if (!summary) {
    throw buildError(CustomerConsoleErrorCode.NOT_FOUND, "style not found");
  }
  return summary;
}

async function toProjectSummary(project: Project): Promise<ConsoleProjectSummary> {
  const [policy, dayUsage, monthUsage, keys] = await Promise.all([
    getProjectPolicy(project.id),
    getUsageSummary(project.id, "day"),
    getUsageSummary(project.id, "month"),
    listProjectKeys(project.id)
  ]);
  
  return {
    id: project.id,
    name: project.name,
    planId: project.planId,
    allowedOrigins: policy.allowedOrigins ? [...policy.allowedOrigins] : [],
    allowedEndpoints: {
      ...policy.allowedEndpoints,
    },
    lastKeyRotationAt: keys[0]?.createdAt,
    latestDayUsage: toUsageCard(project.planId, "day", dayUsage),
    latestMonthUsage: toUsageCard(project.planId, "month", monthUsage),
  };
}

function mapDependencyError(error: unknown): never {
  if (error instanceof CustomerConsoleError) {
    throw error;
  }
  if (error instanceof ProjectsError && error.code === ProjectsErrorCode.PROJECT_NOT_FOUND) {
    throw buildError(CustomerConsoleErrorCode.NOT_FOUND, error.details);
  }
  if (error instanceof ProjectsError || error instanceof BillingSyncError || error instanceof StyleError || error instanceof IdentityError) {
    throw buildError(CustomerConsoleErrorCode.DEPENDENCY_FAILED, error.details ?? error.message);
  }
  if (error instanceof Error) {
    throw buildError(CustomerConsoleErrorCode.DEPENDENCY_FAILED, error.message);
  }
  throw buildError(CustomerConsoleErrorCode.DEPENDENCY_FAILED, "customer console operation failed");
}

async function getProjectSummaryOrThrow(projectId: string, workspaceId?: string): Promise<ConsoleProjectSummary> {
  const normalizedProjectId = projectId.trim();
  const candidateProjects = workspaceId
    ? await listWorkspaceProjects(workspaceId)
    : await loadProjectIfPresent(normalizedProjectId);
  const project = candidateProjects.find((entry) => entry.id === normalizedProjectId);
  if (!project) {
    throw buildError(CustomerConsoleErrorCode.NOT_FOUND, "project not found");
  }
  return await toProjectSummary(project);
}

async function loadProjectIfPresent(projectId: string): Promise<Project[]> {
  // Workspace-agnostic admin paths (e.g. control-plane internals) can land
  // here. Constrain to a single project lookup instead of paging the entire
  // tenant catalog into memory.
  const project = await getProjectById(projectId);
  return project ? [project] : [];
}

async function getProjectById(projectId: string): Promise<Project | null> {
  const list = await listProjects();
  for (const entry of list) {
    const normalized = normalizeConsoleProjectEntry(entry);
    if (normalized && normalized.id === projectId) {
      return normalized;
    }
  }
  return null;
}

async function getWorkspaceProjectOrThrow(projectId: string, workspaceId: string): Promise<Project> {
  const normalizedProjectId = projectId.trim();
  const workspaceProjects = await listWorkspaceProjects(workspaceId);
  const project = workspaceProjects.find((entry) => entry.id === normalizedProjectId);
  if (!project) {
    throw buildError(CustomerConsoleErrorCode.NOT_FOUND, "project not found");
  }
  return project;
}

export async function getConsoleBootstrap(session: Pick<IdentitySession, "user" | "workspace" | "membership">): Promise<ConsoleBootstrap> {
  const normalizedSession = normalizeConsoleSession(session);
  const resolvedWorkspaceId = normalizeWorkspaceId(normalizedSession.workspace.id);
  try {
    const workspace = await getWorkspace(resolvedWorkspaceId);
    const billing = await getWorkspaceBilling(resolvedWorkspaceId);
    
    const rawProjects = await listWorkspaceProjects(resolvedWorkspaceId);
    const projects = await Promise.all(rawProjects.map((project) => toProjectSummary(project)));
    
    const styles = await listPublishedStyleSummaries();
    const usageMonth = toUsageCard(
      billing.planId,
      "month",
      projects.flatMap((project) => {
        const breakdown = project.latestMonthUsage.breakdown;
        const monthBucket = new Date().toISOString().slice(0, 7);
        const entries: UsageSummary[] = [];
        if (breakdown.tiles > 0) {
          entries.push({
            projectId: project.id,
            keyHash: "aggregated",
            planId: billing.planId,
            window: "month",
            bucket: monthBucket,
            endpointGroup: "tiles",
            requestCount: breakdown.tiles,
            unit: "request",
          });
        }
        if (breakdown.raster > 0) {
          entries.push({
            projectId: project.id,
            keyHash: "aggregated",
            planId: billing.planId,
            window: "month",
            bucket: monthBucket,
            endpointGroup: "raster",
            requestCount: breakdown.raster,
            unit: "request",
          });
        }
        if (breakdown.static > 0) {
          entries.push({
            projectId: project.id,
            keyHash: "aggregated",
            planId: billing.planId,
            window: "month",
            bucket: monthBucket,
            endpointGroup: "static",
            requestCount: breakdown.static,
            unit: "request",
          });
        }
        return entries;
      }),
    );
    return {
      currentUser: toConsoleCurrentUser(normalizedSession),
      currentMembership: toConsoleMembership(normalizedSession),
      workspace: toConsoleWorkspace(workspace),
      billing,
      usageMonth,
      projects,
      styles,
      firstIntegration: await buildFirstIntegration(projects, styles),
      onboarding: {
        hasProjects: projects.length > 0,
        hasPublishedStyles: styles.length > 0,
        needsProjectSetup: projects.length === 0,
      },
    };
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function getConsoleSettings(session: Pick<IdentitySession, "user" | "workspace" | "membership">): Promise<ConsoleSettings> {
  const normalizedSession = normalizeConsoleSession(session);
  const resolvedWorkspaceId = normalizeWorkspaceId(normalizedSession.workspace.id);
  try {
    const workspace = await getWorkspace(resolvedWorkspaceId);
    const billing = await getWorkspaceBilling(resolvedWorkspaceId);
    const memberships = (await listWorkspaceMemberships(resolvedWorkspaceId))
      .map((membership) => normalizeConsoleMembershipEntry(membership, resolvedWorkspaceId))
      .filter((membership): membership is ConsoleMembership => membership !== null);
    return {
      currentUser: toConsoleCurrentUser(normalizedSession),
      workspace: toConsoleWorkspace(workspace),
      billingEmail: billing.billingEmail,
      memberships,
    };
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function listConsoleProjects(workspaceId?: string): Promise<ConsoleProjectSummary[]> {
  try {
    const rawProjects = await listWorkspaceProjects(normalizeWorkspaceId(workspaceId));
    return await Promise.all(rawProjects.map((project) => toProjectSummary(project)));
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function listConsoleStyles(): Promise<ConsoleStyleSummary[]> {
  try {
    return await listPublishedStyleSummaries();
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function getConsoleStyle(styleId: string): Promise<ConsoleStyleDetail> {
  const normalizedStyleId = normalizeConsoleResourceId(styleId, "styleId");
  try {
    const style = await getStyleSummaryOrThrow(normalizedStyleId);
    return {
      style,
      snippets: {
        styleUrl: appendAccessTokenQueryParam(style.styleUrl),
        rasterTileUrl: style.rasterTileUrl,
        staticMapUrl: style.staticMapUrl,
      },
    };
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function getConsoleProject(projectId: string, workspaceId?: string): Promise<ConsoleProjectDetail> {
  const normalizedProjectId = normalizeConsoleResourceId(projectId, "projectId");
  try {
    const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId);
    await getWorkspaceProjectOrThrow(normalizedProjectId, resolvedWorkspaceId);
    const projectSummary = await getProjectSummaryOrThrow(normalizedProjectId, resolvedWorkspaceId);
    const keys = await listProjectKeys(normalizedProjectId);
    return {
      project: projectSummary,
      keys: keys.map((key) => ({ ...key })),
      snippets: await buildSnippets(),
    };
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function getConsoleProjectUsage(
  projectId: string,
  window: ConsoleProjectUsageWindow,
  workspaceId?: string,
): Promise<UsageSummaryCard> {
  const normalizedProjectId = normalizeConsoleResourceId(projectId, "projectId");
  const normalizedWindow = normalizeUsageWindow(window);
  try {
    const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const project = await getWorkspaceProjectOrThrow(normalizedProjectId, resolvedWorkspaceId);
    const summary = await getUsageSummary(project.id, normalizedWindow);
    return toUsageCard(project.planId, normalizedWindow, summary);
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function createConsoleProject(input: ConsoleProjectCreateInput, workspaceId?: string): Promise<ConsoleProjectProvisionResult> {
  try {
    const normalizedInput = normalizeProjectCreateInput(input);
    const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const billing = await getWorkspaceBilling(resolvedWorkspaceId);
    const project = await createProject({
      name: normalizeProjectName(normalizedInput.name),
      workspaceId: resolvedWorkspaceId,
      planId: billing.planId,
      policy: {
        allowedOrigins: toAllowedOrigins(normalizedInput.allowedOrigins),
        allowedEndpoints: mergeAllowedEndpoints(normalizedInput.allowedEndpoints, defaultAllowedEndpoints()),
      },
    });
    const issuedKey = await rotateApiKey(project.id);
    return {
      project: await toProjectSummary(project),
      issuedKey,
      snippets: await buildSnippets(issuedKey.token),
    };
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function updateConsoleProject(projectId: string, input: ConsoleProjectUpdateInput, workspaceId?: string): Promise<ConsoleProjectSummary> {
  const normalizedProjectId = normalizeConsoleResourceId(projectId, "projectId");
  try {
    const normalizedInput = normalizeProjectUpdateInput(input);
    const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const allowedProjectIds = new Set(await listWorkspaceProjectIds(resolvedWorkspaceId));
    if (!allowedProjectIds.has(normalizedProjectId)) {
      throw buildError(CustomerConsoleErrorCode.NOT_FOUND, "project not found");
    }
    const currentPolicy = await getProjectPolicy(normalizedProjectId);
    const updated = await updateProject(normalizedProjectId, {
      ...(normalizedInput.name === undefined ? {} : { name: normalizedInput.name }),
      policy: {
        ...(normalizedInput.allowedOrigins === undefined ? {} : { allowedOrigins: toAllowedOrigins(normalizedInput.allowedOrigins) }),
        ...(normalizedInput.allowedEndpoints === undefined
          ? {}
          : { allowedEndpoints: mergeAllowedEndpoints(normalizedInput.allowedEndpoints, currentPolicy.allowedEndpoints) }),
      },
    });
    return await toProjectSummary(updated);
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function rotateConsoleProjectKey(projectId: string, workspaceId?: string): Promise<ConsoleProjectProvisionResult> {
  const normalizedProjectId = normalizeConsoleResourceId(projectId, "projectId");
  try {
    const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const allowedProjectIds = new Set(await listWorkspaceProjectIds(resolvedWorkspaceId));
    if (!allowedProjectIds.has(normalizedProjectId)) {
      throw buildError(CustomerConsoleErrorCode.NOT_FOUND, "project not found");
    }
    const issuedKey = await rotateApiKey(normalizedProjectId);
    return {
      project: await getProjectSummaryOrThrow(normalizedProjectId, resolvedWorkspaceId),
      issuedKey,
      snippets: await buildSnippets(issuedKey.token),
    };
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function updateConsoleSettings(
  session: Pick<IdentitySession, "user" | "workspace" | "membership">,
  input: ConsoleSettingsUpdateInput,
): Promise<ConsoleSettings> {
  const normalizedSession = normalizeConsoleSession(session);
  const normalizedWorkspaceId = normalizeWorkspaceId(normalizedSession.workspace.id);
  const normalizedInput = normalizeSettingsUpdateInput(input);
  const normalizedName = normalizedInput.workspaceName;
  try {
    await updateWorkspace(normalizedWorkspaceId, {
      name: normalizedName,
    });
    return await getConsoleSettings({
      ...normalizedSession,
      workspace: {
        ...normalizedSession.workspace,
        name: normalizedName,
      },
    });
  } catch (error) {
    mapDependencyError(error);
  }
}

function getAppBaseUrl(): string {
  return process.env.APP_PUBLIC_BASE_URL?.trim() || "http://localhost:3000";
}

export async function listConsoleMemberships(workspaceId: string): Promise<ConsoleMembership[]> {
  try {
    const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const memberships = (await listWorkspaceMemberships(resolvedWorkspaceId))
      .map((membership) => normalizeConsoleMembershipEntry(membership, resolvedWorkspaceId))
      .filter((membership): membership is ConsoleMembership => membership !== null);
    return memberships;
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function inviteConsoleMember(
  session: Pick<IdentitySession, "user" | "workspace" | "membership">,
  email: unknown,
  role?: unknown,
): Promise<void> {
  const normalizedSession = normalizeConsoleSession(session);
  const resolvedWorkspaceId = normalizeWorkspaceId(normalizedSession.workspace.id);

  if (normalizedSession.membership.role !== "owner") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "owner role required");
  }

  if (typeof email !== "string" || email.trim().length === 0) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "email is required");
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "invalid email address");
  }

  let normalizedRole: "customer_member" | "customer_owner" = "customer_member";
  if (role !== undefined) {
    if (role === "customer_owner" || role === "owner") {
      normalizedRole = "customer_owner";
    } else if (role === "customer_member" || role === "member") {
      normalizedRole = "customer_member";
    } else {
      throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "invalid role");
    }
  }

  try {
    const existingMemberships = await listWorkspaceMemberships(resolvedWorkspaceId);
    
    // Check if the user already exists and is a member
    const user = await getUserByEmail(normalizedEmail);
    if (user) {
      const isMember = existingMemberships.some((m) => m.userId === user.id);
      if (isMember) {
        throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "user is already a member of this workspace");
      }
    }

    // Check if there is an active pending invitation
    const nowIso = new Date().toISOString();
    const existingInvites = await prisma.identityCredentialToken.findMany({
      where: {
        purpose: "workspace_invitation",
        consumedAt: null,
        expiresAt: { gte: nowIso },
      },
    });
    const isAlreadyInvited = existingInvites.some((invite) => {
      if (!invite.metaJson) return false;
      try {
        const meta = JSON.parse(invite.metaJson);
        return (
          meta &&
          typeof meta === "object" &&
          meta.email === normalizedEmail &&
          meta.workspaceId === resolvedWorkspaceId
        );
      } catch {
        return false;
      }
    });
    if (isAlreadyInvited) {
      throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "user is already invited to this workspace");
    }

    const { rawToken } = await createCredentialToken({
      purpose: "workspace_invitation",
      meta: {
        email: normalizedEmail,
        workspaceId: resolvedWorkspaceId,
        role: normalizedRole,
        workspaceName: normalizedSession.workspace.name,
        inviterName: normalizedSession.user.name,
      },
      lifetimeMs: 7 * 24 * 60 * 60 * 1000,
    });

    const inviteUrl = `${getAppBaseUrl()}/accept-invite/${rawToken}`;
    const emailSuppressed = await isSuppressed(normalizedEmail);
    if (!emailSuppressed) {
      try {
        await sendTransactionalEmail({
          to: normalizedEmail,
          templateKey: "workspace_invitation",
          params: {
            inviteUrl,
            workspaceName: normalizedSession.workspace.name,
            inviterName: normalizedSession.user.name,
          },
          idempotencyKey: `invite_${resolvedWorkspaceId}_${normalizedEmail}_${Date.now()}`,
        });
      } catch {
        // ignore
      }
    }
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function removeConsoleMember(
  session: Pick<IdentitySession, "user" | "workspace" | "membership">,
  userId: string,
  reason?: string,
): Promise<void> {
  const normalizedSession = normalizeConsoleSession(session);
  const resolvedWorkspaceId = normalizeWorkspaceId(normalizedSession.workspace.id);

  if (normalizedSession.membership.role !== "owner") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "owner role required");
  }

  const targetUserId = normalizeConsoleResourceId(userId, "userId");

  try {
    const targetUser = await getUserById(targetUserId);
    const workspace = await getWorkspace(resolvedWorkspaceId);

    await removeWorkspaceMember(resolvedWorkspaceId, targetUserId, reason || "removed by owner");

    if (targetUser) {
      const emailSuppressed = await isSuppressed(targetUser.email);
      if (!emailSuppressed) {
        try {
          await sendTransactionalEmail({
            to: targetUser.email,
            templateKey: "member_removed",
            params: {
              workspaceName: workspace.name,
              memberName: targetUser.name,
            },
            idempotencyKey: `member_removed_${resolvedWorkspaceId}_${targetUserId}_${Date.now()}`,
          });
        } catch {
          // ignore
        }
      }
    }
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function transferConsoleWorkspaceOwnership(
  session: Pick<IdentitySession, "user" | "workspace" | "membership">,
  toUserId: string,
): Promise<void> {
  const normalizedSession = normalizeConsoleSession(session);
  const resolvedWorkspaceId = normalizeWorkspaceId(normalizedSession.workspace.id);

  if (normalizedSession.membership.role !== "owner") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "owner role required");
  }

  const targetUserId = normalizeConsoleResourceId(toUserId, "toUserId");

  try {
    await transferWorkspaceOwnership(resolvedWorkspaceId, normalizedSession.user.id, targetUserId);
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function deleteConsoleWorkspace(
  session: Pick<IdentitySession, "user" | "workspace" | "membership">,
  reason?: string,
): Promise<void> {
  const normalizedSession = normalizeConsoleSession(session);
  const resolvedWorkspaceId = normalizeWorkspaceId(normalizedSession.workspace.id);

  if (normalizedSession.membership.role !== "owner") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "owner role required");
  }

  try {
    await softDeleteWorkspace(resolvedWorkspaceId, reason || "requested by owner");

    const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString();
    const emailSuppressed = await isSuppressed(normalizedSession.user.email);
    if (!emailSuppressed) {
      try {
        await sendTransactionalEmail({
          to: normalizedSession.user.email,
          templateKey: "account_deletion_initiated",
          params: {
            deletionDate,
          },
          idempotencyKey: `delete_initiated_${resolvedWorkspaceId}_${Date.now()}`,
        });
      } catch {
        // ignore
      }
    }
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function restoreConsoleWorkspace(
  session: Pick<IdentitySession, "user" | "workspace" | "membership">,
): Promise<void> {
  const normalizedSession = normalizeConsoleSession(session);
  const resolvedWorkspaceId = normalizeWorkspaceId(normalizedSession.workspace.id);

  if (normalizedSession.membership.role !== "owner") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "owner role required");
  }

  try {
    await prisma.identityWorkspace.update({
      where: { id: resolvedWorkspaceId },
      data: {
        deletedAt: null,
        deletionReason: null,
        purgeAt: null,
        suspendedAt: null,
        suspendedReason: null,
      },
    });
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function exportConsoleWorkspace(
  session: Pick<IdentitySession, "user" | "workspace" | "membership">,
): Promise<void> {
  const normalizedSession = normalizeConsoleSession(session);
  const resolvedWorkspaceId = normalizeWorkspaceId(normalizedSession.workspace.id);

  if (normalizedSession.membership.role !== "owner") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "owner role required");
  }

  const triggerExport = async () => {
    try {
      const projects = await listWorkspaceProjects(resolvedWorkspaceId);
      const projectKeys = await Promise.all(
        projects.map(async (p) => {
          const keys = await listProjectKeys(p.id);
          return { projectId: p.id, keys: keys.map(k => ({ keyId: k.keyId, createdAt: k.createdAt })) };
        })
      );
      const memberships = await listWorkspaceMemberships(resolvedWorkspaceId);
      const stylesList = await listPublishedStyleSummaries();

      void projectKeys;
      void memberships;
      void stylesList;

      const exportUrl = `${getAppBaseUrl()}/app-api/workspace/export/download?token=${resolvedWorkspaceId}_${randomBytes(16).toString("hex")}`;

      const emailSuppressed = await isSuppressed(normalizedSession.user.email);
      if (!emailSuppressed) {
        await sendTransactionalEmail({
          to: normalizedSession.user.email,
          templateKey: "data_export_ready",
          params: {
            exportUrl,
          },
          idempotencyKey: `export_ready_${resolvedWorkspaceId}_${Date.now()}`,
        });
      }
    } catch {
      // Async failure is silent
    }
  };

  void triggerExport();
}

export async function updateConsolePassword(
  session: Pick<IdentitySession, "user">,
  input: { currentPassword?: unknown; newPassword?: unknown },
): Promise<void> {
  if (typeof session !== "object" || session === null || !session.user || typeof session.user.id !== "string") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "session is required");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "payload is required");
  }
  const { currentPassword, newPassword } = input;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "both current and new passwords are required");
  }

  const uId = session.user.id;
  try {
    const isValid = await verifyPasswordHash(uId, currentPassword);
    if (!isValid) {
      throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "invalid current password");
    }

    const hasDigit = /\d/.test(newPassword);
    const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
    if (newPassword.length < 12 || !hasDigit || !hasSpecial) {
      throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "password does not meet strength requirements");
    }

    const hashed = hashPassword(newPassword);
    await setPasswordHash(uId, hashed);
  } catch (error) {
    mapDependencyError(error);
  }
}

function decodeBase32(b32: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = b32.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned[i]);
    if (val === -1) throw new Error("Invalid base32 character");
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateHotp(key: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  let temp = counter;
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = temp & 0xff;
    temp >>= 8;
  }
  const hmac = createHmac("sha1", key);
  hmac.update(counterBuffer);
  const digest = hmac.digest();
  const offset = digest[digest.length - 1] & 0xf;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const otp = binary % 1000000;
  return otp.toString().padStart(6, "0");
}

function verifyTotpCode(secretBase32: string, code: string): boolean {
  try {
    const key = decodeBase32(secretBase32);
    const epoch = Math.floor(Date.now() / 1000);
    const timeStep = 30;
    const counter = Math.floor(epoch / timeStep);
    for (let i = -1; i <= 1; i++) {
      if (generateHotp(key, counter + i) === code.trim()) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function enrollConsoleMfa(
  session: Pick<IdentitySession, "user">,
  input: { code?: unknown },
): Promise<{ secret: string; recoveryCodes: string[] } | { success: true }> {
  if (typeof session !== "object" || session === null || !session.user || typeof session.user.id !== "string") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "session is required");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "payload is required");
  }

  const uId = session.user.id;
  try {
    const user = await prisma.identityUser.findUnique({ where: { id: uId } });
    if (!user) {
      throw buildError(CustomerConsoleErrorCode.NOT_FOUND, "user not found");
    }

    if (input.code !== undefined) {
      if (typeof input.code !== "string" || input.code.trim().length === 0) {
        throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "verification code is required");
      }
      if (!user.mfaSecretEncrypted) {
        throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "MFA secret is not generated yet");
      }
      const decrypted = decryptMfaSecret(user.mfaSecretEncrypted);
      const isValid = verifyTotpCode(decrypted, input.code);
      if (!isValid) {
        throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "invalid verification code");
      }

      await prisma.identityUser.update({
        where: { id: uId },
        data: { mfaEnabledAt: new Date().toISOString() },
      });
      return { success: true };
    }

    const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const secret = Array.from({ length: 16 }, () => base32Alphabet[Math.floor(Math.random() * 32)]).join("");
    const encryptedSecret = encryptMfaSecret(secret);

    const rawRecoveryCodes = Array.from({ length: 8 }, () => randomBytes(4).toString("hex"));
    const hashedRecoveryCodes = rawRecoveryCodes.map(c => hashPassword(c));

    await prisma.identityUser.update({
      where: { id: uId },
      data: {
        mfaSecretEncrypted: encryptedSecret,
        mfaRecoveryCodesHashedJson: JSON.stringify(hashedRecoveryCodes),
        mfaEnabledAt: null,
      },
    });

    return { secret, recoveryCodes: rawRecoveryCodes };
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function disableConsoleMfa(
  session: Pick<IdentitySession, "user">,
  input: { password?: unknown },
): Promise<{ success: true }> {
  if (typeof session !== "object" || session === null || !session.user || typeof session.user.id !== "string") {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "session is required");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "payload is required");
  }
  const { password } = input;
  if (typeof password !== "string" || password.trim().length === 0) {
    throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "password is required to disable MFA");
  }

  const uId = session.user.id;
  try {
    const isValid = await verifyPasswordHash(uId, password);
    if (!isValid) {
      throw buildError(CustomerConsoleErrorCode.BAD_REQUEST, "invalid password");
    }

    await prisma.identityUser.update({
      where: { id: uId },
      data: {
        mfaSecretEncrypted: null,
        mfaEnabledAt: null,
        mfaRecoveryCodesHashedJson: null,
      },
    });
    return { success: true };
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function listConsoleNotifications(workspaceId: string): Promise<ConsoleNotification[]> {
  try {
    const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const events = await prisma.identityAuthEvent.findMany({
      where: {
        workspaceId: resolvedWorkspaceId,
        recordedAt: { gte: ninetyDaysAgo },
      },
      orderBy: { recordedAt: "desc" },
    });

    const emails = await prisma.emailDispatch.findMany({
      where: {
        workspaceId: resolvedWorkspaceId,
        createdAt: { gte: ninetyDaysAgo },
      },
      orderBy: { createdAt: "desc" },
    });

    const notifications: ConsoleNotification[] = [];

    for (const event of events) {
      if (event.eventType === "INVITATION_ACCEPTED") {
        notifications.push({
          id: event.id,
          type: "info",
          title: "Invitation Accepted",
          message: "A new member accepted the invitation to join this workspace.",
          actionHref: "/app/settings/members",
          recordedAt: event.recordedAt,
        });
      } else if (event.eventType === "KEY_ROTATED") {
        notifications.push({
          id: event.id,
          type: "info",
          title: "API Key Rotated",
          message: `API Key was successfully rotated by a member.`,
          actionHref: "/app/projects",
          recordedAt: event.recordedAt,
        });
      } else if (event.eventType === "MEMBER_REMOVED") {
        notifications.push({
          id: event.id,
          type: "warn",
          title: "Member Removed",
          message: `A member was removed from the workspace.`,
          actionHref: "/app/settings/members",
          recordedAt: event.recordedAt,
        });
      } else if (event.eventType === "QUOTA_THRESHOLD_CROSSED") {
        const usagePercent = event.reason?.includes("100") ? "100%" : "80%";
        notifications.push({
          id: event.id,
          type: usagePercent === "100%" ? "danger" : "warn",
          title: usagePercent === "100%" ? "Quota Exceeded" : "Quota Approaching",
          message: `Workspace has consumed ${usagePercent} of its monthly allowance.`,
          actionHref: "/app/billing",
          recordedAt: event.recordedAt,
        });
      }
    }

    for (const email of emails) {
      if (email.templateKey === "workspace_invitation" && !notifications.some(n => n.recordedAt === email.createdAt)) {
        notifications.push({
          id: email.id,
          type: "info",
          title: "Invitation Sent",
          message: `Workspace invitation was sent to ${email.to}.`,
          actionHref: "/app/settings/members",
          recordedAt: email.createdAt,
        });
      } else if (email.templateKey === "quota_approaching" && !notifications.some(n => n.title === "Quota Approaching")) {
        notifications.push({
          id: email.id,
          type: "warn",
          title: "Quota Approaching",
          message: "Workspace has consumed 80% of its monthly allowance.",
          actionHref: "/app/billing",
          recordedAt: email.createdAt,
        });
      } else if (email.templateKey === "quota_exceeded" && !notifications.some(n => n.title === "Quota Exceeded")) {
        notifications.push({
          id: email.id,
          type: "danger",
          title: "Quota Exceeded",
          message: "Workspace has consumed 100% of its monthly allowance.",
          actionHref: "/app/billing",
          recordedAt: email.createdAt,
        });
      } else if (email.templateKey === "billing_receipt" && !notifications.some(n => n.recordedAt === email.createdAt)) {
        notifications.push({
          id: email.id,
          type: "info",
          title: "Payment Received",
          message: `Subscription payment received.`,
          actionHref: "/app/billing",
          recordedAt: email.createdAt,
        });
      } else if (email.templateKey === "plan_change_confirmation" && !notifications.some(n => n.recordedAt === email.createdAt)) {
        notifications.push({
          id: email.id,
          type: "info",
          title: "Plan Changed",
          message: `Workspace billing plan was successfully updated.`,
          actionHref: "/app/billing",
          recordedAt: email.createdAt,
        });
      }
    }

    return notifications.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  } catch (error) {
    mapDependencyError(error);
  }
}

export async function handleQuotaThresholdEvent(event: QuotaThresholdEvent): Promise<void> {
  try {
    const workspaceId = event.workspaceId;
    const threshold = event.thresholdPercent;
    const planId = event.planId;
    const windowStart = event.windowStart;
    const memberships = await listWorkspaceMemberships(workspaceId);
    if (memberships.length === 0) {
      return;
    }
    const templateKey = threshold === 100 ? "quota_exceeded" : "quota_approaching";
    for (const membership of memberships) {
      const user = await getUserById(membership.userId);
      if (!user) continue;
      const emailSuppressed = await isSuppressed(user.email);
      if (emailSuppressed) continue;
      const idempotencyKey = `quota_${workspaceId}_${planId}_${windowStart}_${threshold}_${user.id}`;
      try {
        await sendTransactionalEmail({
          to: user.email,
          templateKey,
          params: {
            workspaceName: event.workspaceId,
            planId,
            usagePercent: event.usagePercent,
          },
          idempotencyKey,
          workspaceId,
          userId: user.id,
        });
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

contractEventEmitter.on("quota.threshold_crossed", (event: QuotaThresholdEvent) => {
  handleQuotaThresholdEvent(event).catch(() => {});
});
