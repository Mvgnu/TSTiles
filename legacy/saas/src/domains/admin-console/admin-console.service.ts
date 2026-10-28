import { prisma } from "../../config/db";
import { loadConfig } from "../../config/load-config";
import { createHmac, randomBytes } from "node:crypto";
import {
  getSession,
  revokeSession,
  createOperatorSession,
  recordAuthEvent,
  listOperators,
  getUserByEmail,
  getUserById,
  isLockedOut,
  incrementLockoutCounter,
  clearLockoutCounter,
  verifyPasswordHash,
} from "../identity/identity.service";
import {
  listArtifactsEndpoint,
  listJobsEndpoint,
  getProjectUsageEndpoint,
  healthStatusEndpoint,
} from "../control-plane/control-plane.service";
import { listProjects, listProjectKeys } from "../projects/projects.service";
import { listStyles } from "../styles/styles.service";
import { hashPassword } from "../identity/components/password-hash";
import { decryptMfaSecret, encryptMfaSecret } from "../identity/components/mfa-secret-encryption";
import type { IdentitySession, IssuedIdentitySession } from "../identity/types";
import type {
  ControlPlaneOperation,
  ControlPlaneOutcome,
  JobMetadata,
} from "../control-plane/types";
import {
  AdminConsoleErrorCode,
  AdminConsoleError,
} from "./types";
import type {
  AdminConsolePageSlug,
  AdminConsolePage,
  AdminConsoleOverviewPage,
  AdminConsoleArtifactsPage,
  AdminConsoleIngestPage,
  AdminConsoleStylesPage,
  AdminConsoleProjectsPage,
  AdminConsoleProjectDetailPage,
  AdminConsoleAuditPage,
  AdminConsoleJobsPage,
  AdminConsoleAbusePage,
  AdminConsoleOperatorsPage,
  AdminConsoleShell,
  AdminConsoleNavigationItem,
} from "./types";

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

export async function opsSignIn(input: {
  readonly email?: unknown;
  readonly password?: unknown;
  readonly totp?: unknown;
  readonly clientIp?: string;
  readonly userAgent?: string;
}): Promise<{ readonly session?: IssuedIdentitySession; readonly mfaRequired?: boolean; readonly secret?: string; readonly recoveryCodes?: ReadonlyArray<string> }> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "Invalid input payload");
  }
  if (typeof input.email !== "string" || input.email.trim().length === 0) {
    throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "Email address is required");
  }
  if (typeof input.password !== "string" || input.password.trim().length === 0) {
    throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "Password is required");
  }
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const clientIp = input.clientIp || "unknown";
  const userAgent = input.userAgent || "unknown";

  const ipKey = clientIp;
  const emailKey = email;

  if (await isLockedOut(emailKey, "email") || await isLockedOut(ipKey, "ip")) {
    throw new AdminConsoleError(AdminConsoleErrorCode.LOCKED_OUT, "Brute force lockout active. Try again in 15 minutes.");
  }

  let user = await getUserByEmail(email);
  if (!user) {
    await incrementLockoutCounter(emailKey, "email");
    await incrementLockoutCounter(ipKey, "ip");
    throw new AdminConsoleError(AdminConsoleErrorCode.NOT_OPERATOR, "Invalid email or password");
  }

  // 1. Initial Operator Seed Check
  const initialEmail = (process.env.INITIAL_OPERATOR_EMAIL || "").trim().toLowerCase();
  if (initialEmail && user.email.toLowerCase() === initialEmail && !user.roleOperatorGrantedAt) {
    const updated = await prisma.identityUser.update({
      where: { id: user.id },
      data: {
        roleOperatorGrantedAt: new Date().toISOString(),
        roleOperatorGrantedByUserId: "system-seed",
      },
    });
    user = { ...user, roleOperatorGrantedAt: updated.roleOperatorGrantedAt };
  }

  // 2. Validate Password
  if (!user.passwordHash) {
    await incrementLockoutCounter(emailKey, "email");
    await incrementLockoutCounter(ipKey, "ip");
    throw new AdminConsoleError(AdminConsoleErrorCode.NOT_OPERATOR, "Invalid email or password");
  }
  if (!await verifyPasswordHash(user.id, password)) {
    await incrementLockoutCounter(emailKey, "email");
    await incrementLockoutCounter(ipKey, "ip");
    throw new AdminConsoleError(AdminConsoleErrorCode.NOT_OPERATOR, "Invalid email or password");
  }

  // 3. Verify operator role
  if (!user.roleOperatorGrantedAt) {
    await incrementLockoutCounter(emailKey, "email");
    await incrementLockoutCounter(ipKey, "ip");
    throw new AdminConsoleError(AdminConsoleErrorCode.NOT_OPERATOR, "Invalid email or password");
  }

  // 4. Handle MFA Enforcement
  if (!user.mfaEnabledAt) {
    // Force setup TOTP secret & return it
    if (input.totp === undefined) {
      let secret = "";
      let recoveryCodes: string[] = [];
      if (user.mfaSecretEncrypted) {
        secret = decryptMfaSecret(user.mfaSecretEncrypted);
        const savedHashed = JSON.parse(user.mfaRecoveryCodesHashedJson || "[]") as string[];
        recoveryCodes = savedHashed.map((_, idx) => `recovery-code-${idx + 1}`);
      } else {
        const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        secret = Array.from({ length: 16 }, () => base32Alphabet[Math.floor(Math.random() * 32)]).join("");
        const encryptedSecret = encryptMfaSecret(secret);
        const rawRecoveryCodes = Array.from({ length: 8 }, () => randomBytes(4).toString("hex"));
        const hashedRecoveryCodes = rawRecoveryCodes.map(c => hashPassword(c));
        
        await prisma.identityUser.update({
          where: { id: user.id },
          data: {
            mfaSecretEncrypted: encryptedSecret,
            mfaRecoveryCodesHashedJson: JSON.stringify(hashedRecoveryCodes),
          },
        });
        recoveryCodes = rawRecoveryCodes;
      }
      return { mfaRequired: true, secret, recoveryCodes };
    } else {
      if (typeof input.totp !== "string" || input.totp.trim().length === 0) {
        throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "Verification code is required");
      }
      if (!user.mfaSecretEncrypted) {
        throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "MFA secret is not configured");
      }
      const decrypted = decryptMfaSecret(user.mfaSecretEncrypted);
      const isValid = verifyTotpCode(decrypted, input.totp);
      if (!isValid) {
        await incrementLockoutCounter(emailKey, "email");
        await incrementLockoutCounter(ipKey, "ip");
        throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "Invalid verification code");
      }
      await prisma.identityUser.update({
        where: { id: user.id },
        data: { mfaEnabledAt: new Date().toISOString() },
      });
    }
  } else {
    // Challenge existing TOTP
    if (input.totp === undefined) {
      return { mfaRequired: true };
    }
    if (typeof input.totp !== "string" || input.totp.trim().length === 0) {
      throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "Verification code is required");
    }
    if (!user.mfaSecretEncrypted) {
      throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "MFA secret is not configured");
    }
    const decrypted = decryptMfaSecret(user.mfaSecretEncrypted);
    const isValid = verifyTotpCode(decrypted, input.totp);
    if (!isValid) {
      await incrementLockoutCounter(emailKey, "email");
      await incrementLockoutCounter(ipKey, "ip");
      throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "Invalid verification code");
    }
  }

  // Clear counters on successful sign-in
  await clearLockoutCounter(emailKey, "email");
  await clearLockoutCounter(ipKey, "ip");

  const session = await createOperatorSession(user.id, { userAgent, clientIpHash: clientIp });

  await recordAuthEvent({
    id: `auth-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    eventType: "OPERATOR_SIGNED_IN",
    userId: user.id,
    actorRole: "operator",
    clientIpHash: clientIp,
    userAgent,
    outcome: "success",
    recordedAt: new Date().toISOString(),
  });

  return { session };
}

export async function opsSignOut(sessionToken: string): Promise<void> {
  const session = await getSession(sessionToken);
  if (session && session.user.roleOperatorGrantedAt) {
    await revokeSession(sessionToken);
    await recordAuthEvent({
      id: `auth-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      eventType: "OPERATOR_SIGNED_OUT",
      userId: session.user.id,
      actorRole: "operator",
      outcome: "success",
      recordedAt: new Date().toISOString(),
    });
  }
}

function buildNavigation(active: AdminConsolePageSlug): ReadonlyArray<AdminConsoleNavigationItem> {
  const slugs: Array<{ slug: AdminConsolePageSlug; label: string; href: string }> = [
    { slug: "overview", label: "Overview", href: "/ops" },
    { slug: "artifacts", label: "Artifacts", href: "/ops/artifacts" },
    { slug: "ingest", label: "Ingest osm", href: "/ops/ingest" },
    { slug: "styles", label: "Styles", href: "/ops/styles" },
    { slug: "projects", label: "Projects", href: "/ops/projects" },
    { slug: "audit", label: "Audit log", href: "/ops/audit" },
    { slug: "jobs", label: "Jobs", href: "/ops/jobs" },
    { slug: "abuse", label: "Abuse controls", href: "/ops/abuse" },
    { slug: "operators", label: "Operators", href: "/ops/operators" },
  ];
  return slugs.map((entry) => ({
    label: entry.label,
    href: entry.href,
    active: entry.slug === active || (active === "project-detail" && entry.slug === "projects"),
  }));
}

async function buildShell(session: IdentitySession, active: AdminConsolePageSlug): Promise<AdminConsoleShell> {
  const config = loadConfig();
  const health = await healthStatusEndpoint(config.security.adminToken);
  return {
    currentUser: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    },
    navigation: buildNavigation(active),
    health,
  };
}

export async function getAdminOverviewPage(session: IdentitySession): Promise<AdminConsoleOverviewPage> {
  const shell = await buildShell(session, "overview");
  const config = loadConfig();
  const artifacts = await listArtifactsEndpoint(config.security.adminToken);
  const projects = await listProjects();
  const recentEvents = await prisma.adminAuditEvent.findMany({ take: 5, orderBy: { recordedAt: "desc" } });
  const runningJobs = await prisma.adminJob.count({ where: { status: "running" } });

  return {
    slug: "overview",
    title: "System Overview",
    description: "Real-time state and operations portal for operators.",
    shell,
    counts: {
      artifacts: artifacts.length,
      projects: projects.length,
      activeJobs: runningJobs,
      recentAuditEvents: recentEvents.length,
    },
  };
}

export async function getAdminArtifactsPage(session: IdentitySession): Promise<AdminConsoleArtifactsPage> {
  const shell = await buildShell(session, "artifacts");
  const config = loadConfig();
  const artifacts = await listArtifactsEndpoint(config.security.adminToken);
  const activeRecord = await prisma.activeArtifact.findFirst();

  return {
    slug: "artifacts",
    title: "PMTiles Artifacts Catalog",
    description: "Manage global pmtiles vectors datasets, artifact promotion, and version rollback.",
    shell,
    artifacts,
    activeVersionId: activeRecord?.versionId || null,
  };
}

export async function getAdminIngestPage(session: IdentitySession): Promise<AdminConsoleIngestPage> {
  const shell = await buildShell(session, "ingest");
  const config = loadConfig();
  const recentJobs = await listJobsEndpoint(config.security.adminToken, 50);

  return {
    slug: "ingest",
    title: "Osm Ingest runs",
    description: "Trigger asynchronous ingest jobs or inspect the background osm pipeline status.",
    shell,
    recentJobs,
  };
}

export async function getAdminStylesPage(session: IdentitySession): Promise<AdminConsoleStylesPage> {
  const shell = await buildShell(session, "styles");
  const styles = await listStyles();

  return {
    slug: "styles",
    title: "Published style sheets",
    description: "Inspect globally registered styles, versions, and published configurations.",
    shell,
    styles,
  };
}

export async function getAdminProjectsPage(session: IdentitySession): Promise<AdminConsoleProjectsPage> {
  const shell = await buildShell(session, "projects");
  const projects = await listProjects();

  return {
    slug: "projects",
    title: "Customer projects registry",
    description: "View project metadata, origins, and key rotation status. Operators have read-only access.",
    shell,
    projects,
  };
}

export async function getAdminProjectDetailPage(
  session: IdentitySession,
  projectId: string,
  showOwnerPii = false,
): Promise<AdminConsoleProjectDetailPage> {
  const shell = await buildShell(session, "projects");
  const projects = await listProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    throw new AdminConsoleError(AdminConsoleErrorCode.DEPENDENCY_FAILED, "Project not found");
  }

  const rawKeys = await listProjectKeys(projectId);
  const keys = rawKeys.map(k => ({
    id: k.keyId,
    tokenHash: k.keyHash.slice(0, 10),
    label: "API Key",
    createdAt: k.createdAt,
  }));

  const config = loadConfig();
  const usage = await getProjectUsageEndpoint(projectId, "month", config.security.adminToken);

  let workspaceOwner = null;
  if (showOwnerPii) {
    const membership = await prisma.identityMembership.findFirst({
      where: {
        workspaceId: project.workspaceId,
        role: { in: ["owner", "customer_owner"] },
      },
    });
    if (membership) {
      const user = await getUserById(membership.userId);
      if (user) {
        workspaceOwner = {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      }
    }
    
    // Log the PII access
    const id = `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const now = new Date().toISOString();
    await prisma.adminAuditEvent.create({
      data: {
        id,
        actor: session.user.email,
        operation: "OPERATOR_VIEWED_PII",
        outcome: "success",
        startedAt: now,
        completedAt: now,
        message: `Operator viewed customer PII contact for workspace project ${projectId}`,
        recordedAt: now,
      },
    });
  }

  const tilesTotal = usage.reduce((sum, item) => item.endpointGroup === "tiles" ? sum + item.requestCount : sum, 0);
  const rasterTotal = usage.reduce((sum, item) => item.endpointGroup === "raster" ? sum + item.requestCount : sum, 0);
  const staticTotal = usage.reduce((sum, item) => item.endpointGroup === "static" ? sum + item.requestCount : sum, 0);

  return {
    slug: "project-detail",
    title: project.name,
    description: `Operator read-only audit surface for project ${projectId}.`,
    shell,
    project,
    keys,
    usage: {
      tiles: tilesTotal,
      raster: rasterTotal,
      static: staticTotal,
    },
    workspaceOwner,
    showOwnerPii,
  };
}

export async function getAdminAuditPage(
  session: IdentitySession,
  filters: { eventType?: string; actor?: string; outcome?: string } = {},
): Promise<AdminConsoleAuditPage> {
  const shell = await buildShell(session, "audit");
  
  const where: Record<string, unknown> = {};
  if (filters.eventType && filters.eventType.trim().length > 0) {
    where.operation = filters.eventType.trim();
  }
  if (filters.actor && filters.actor.trim().length > 0) {
    where.actor = filters.actor.trim();
  }
  if (filters.outcome && filters.outcome.trim().length > 0) {
    where.outcome = filters.outcome.trim();
  }

  const rows = await prisma.adminAuditEvent.findMany({
    where,
    orderBy: { recordedAt: "desc" },
    take: 100,
  });

  const events = rows.map((row) => ({
    id: row.id,
    actor: row.actor,
    operation: row.operation as ControlPlaneOperation,
    outcome: row.outcome as ControlPlaneOutcome,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
    message: row.message ?? undefined,
  }));

  return {
    slug: "audit",
    title: "Admin audit log",
    description: "Paginated operations log capturing all administrative and operator-attributable mutations.",
    shell,
    events,
    filters,
  };
}

export async function getAdminJobsPage(
  session: IdentitySession,
  filters: { status?: string; actor?: string } = {},
): Promise<AdminConsoleJobsPage> {
  const shell = await buildShell(session, "jobs");
  
  const where: Record<string, unknown> = {};
  if (filters.status && filters.status.trim().length > 0) {
    where.status = filters.status.trim();
  }
  if (filters.actor && filters.actor.trim().length > 0) {
    where.actor = filters.actor.trim();
  }

  const rows = await prisma.adminJob.findMany({
    where,
    orderBy: { recordedAt: "desc" },
    take: 100,
  });

  const jobs = rows.map((row) => ({
    jobId: row.jobId,
    status: row.status as JobMetadata["status"],
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
    actor: row.actor ?? undefined,
    snapshotId: row.snapshotId ?? undefined,
    outcome: row.outcome ? (row.outcome as ControlPlaneOutcome) : undefined,
  }));

  return {
    slug: "jobs",
    title: "Osm Ingest job pipeline log",
    description: "Detailed operational checklist of all historic osm data download and ingest run workers.",
    shell,
    jobs,
    filters,
  };
}

export async function getAdminAbusePage(session: IdentitySession): Promise<AdminConsoleAbusePage> {
  const shell = await buildShell(session, "abuse");
  const workspaces = await prisma.identityWorkspace.findMany({
    where: { suspendedAt: { not: null } },
    orderBy: { suspendedAt: "desc" },
  });

  const suspendedWorkspaces = await Promise.all(
    workspaces.map(async (ws) => {
      const membership = await prisma.identityMembership.findFirst({
        where: {
          workspaceId: ws.id,
          role: { in: ["owner", "customer_owner"] },
        },
      });
      let ownerEmail = null;
      if (membership) {
        const user = await getUserById(membership.userId);
        ownerEmail = user?.email || null;
      }
      return {
        id: ws.id,
        name: ws.name,
        suspendedAt: ws.suspendedAt ? (typeof ws.suspendedAt === "string" ? ws.suspendedAt : new Date(ws.suspendedAt).toISOString()) : "",
        suspendedReason: ws.suspendedReason,
        ownerEmail,
      };
    }),
  );

  return {
    slug: "abuse",
    title: "Abuse & Compliance Controls",
    description: "Protect platform bandwidth by warning workspaces or suspending non-compliant tenants.",
    shell,
    suspendedWorkspaces,
  };
}

export async function getAdminOperatorsPage(session: IdentitySession): Promise<AdminConsoleOperatorsPage> {
  const shell = await buildShell(session, "operators");
  const users = await listOperators();
  const operators = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    mfaEnabled: u.mfaEnabledAt !== null,
    roleOperatorGrantedAt: u.roleOperatorGrantedAt,
  }));

  return {
    slug: "operators",
    title: "System Operators",
    description: "Manage operator role grants and inspect MFA enforcement status across operators.",
    shell,
    operators,
  };
}

function assertOperator(session: IdentitySession) {
  if (!session.user.roleOperatorGrantedAt) {
    throw new AdminConsoleError(AdminConsoleErrorCode.NOT_OPERATOR, "Not an operator");
  }
}

export async function getAdminConsolePage(
  session: IdentitySession,
  input: {
    readonly slug: AdminConsolePageSlug;
    readonly projectId?: string;
    readonly showOwnerPii?: boolean;
    readonly eventType?: string;
    readonly actor?: string;
    readonly outcome?: string;
    readonly status?: string;
  },
): Promise<AdminConsolePage> {
  if (typeof session !== "object" || session === null || !session.user || typeof session.user.id !== "string") {
    throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "session is required");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "input is required");
  }
  assertOperator(session);

  switch (input.slug) {
    case "overview":
      return await getAdminOverviewPage(session);
    case "artifacts":
      return await getAdminArtifactsPage(session);
    case "ingest":
      return await getAdminIngestPage(session);
    case "styles":
      return await getAdminStylesPage(session);
    case "projects":
      return await getAdminProjectsPage(session);
    case "project-detail":
      if (typeof input.projectId !== "string" || input.projectId.trim().length === 0) {
        throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "projectId is required");
      }
      return await getAdminProjectDetailPage(session, input.projectId.trim(), Boolean(input.showOwnerPii));
    case "audit":
      return await getAdminAuditPage(session, {
        eventType: input.eventType,
        actor: input.actor,
        outcome: input.outcome,
      });
    case "jobs":
      return await getAdminJobsPage(session, {
        status: input.status,
        actor: input.actor,
      });
    case "abuse":
      return await getAdminAbusePage(session);
    case "operators":
      return await getAdminOperatorsPage(session);
    default:
      throw new AdminConsoleError(AdminConsoleErrorCode.BAD_REQUEST, "Page not found");
  }
}
