import { randomBytes } from "node:crypto";
import { prisma } from "../../config/db";
import type {
  IdentityUser as PrismaUser,
  IdentityWorkspace as PrismaWorkspace,
  IdentityMembership as PrismaMembership,
  IdentitySession as PrismaSession,
} from "@prisma/client";
import {
  IdentityError,
  IdentityErrorCode,
  type DemoSignInInput,
  type IdentityMembership,
  type IdentityRole,
  type IdentitySession,
  type IssuedIdentitySession,
  type IdentityUser,
  type IdentityWorkspace,
  type WorkspaceUpdateInput,
  type CreateUserInput,
  type CredentialTokenPurpose,
  type IdentityCredentialToken,
  type IdentityAuthEvent
} from "./types";
import {
  hashPassword,
  isArgon2idHash,
  verifyPasswordForMigration,
} from "./components/password-hash";
import { generateRawToken, hashToken } from "./components/credential-token-hash";

interface ManagedAuthHeaderInput extends DemoSignInInput {
  readonly sessionToken: string;
}

function isDemoSessionBridgeEnabled(): boolean {
  return process.env.NODE_ENV === "development";
}

function isManagedAuthHeaderBridgeEnabled(): boolean {
  return (process.env.IDENTITY_MANAGED_AUTH_MODE?.trim().toLowerCase() ?? "") === "header";
}

function buildError(code: IdentityErrorCode, details: string): IdentityError {
  return new IdentityError(code, details);
}

function hasUnsupportedIdentifierShape(value: string): boolean {
  return value === "."
    || value.includes("..")
    || value.includes("/")
    || value.includes("\\")
    || value.includes("|");
}

function normalizeIdentifier(value: unknown, field: string, fallback: string): string {
  if (value !== undefined && typeof value !== "string") {
    throw buildError(IdentityErrorCode.BAD_REQUEST, `${field} must be a string`);
  }
  const normalized = value?.trim() ?? fallback;
  if (normalized.length === 0) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, `${field} is required`);
  }
  if (hasUnsupportedIdentifierShape(normalized)) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, `${field} contains unsupported characters`);
  }
  return normalized;
}

function normalizeSessionTokenCandidate(token: unknown): string | null {
  if (token !== undefined && typeof token !== "string") {
    return null;
  }
  const normalized = token?.trim() ?? "";
  if (normalized.length === 0) {
    return null;
  }
  if (hasUnsupportedIdentifierShape(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeEmail(value: string | undefined, userId: string): string {
  const normalized = value?.trim().toLowerCase() ?? `${userId}@example.invalid`;
  if (!normalized.includes("@")) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "email must contain @");
  }
  return normalized;
}

function normalizeOptionalDisplayName(
  value: unknown,
  field: "name" | "workspaceName",
  fallback: string,
): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw buildError(IdentityErrorCode.BAD_REQUEST, `${field} must be a string`);
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeRole(role: IdentityRole | undefined): IdentityRole | undefined {
  if (role === undefined) {
    return undefined;
  }
  if (
    role === "owner" ||
    role === "member" ||
    role === "customer_member" ||
    role === "customer_owner" ||
    role === "operator"
  ) {
    return role;
  }
  throw buildError(IdentityErrorCode.BAD_REQUEST, "role must be a valid IdentityRole");
}

function readHeader(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  if (typeof name !== "string") {
    return undefined;
  }
  const direct = headers[name];
  if (typeof direct === "string") {
    return direct;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof key === "string" && key.toLowerCase() === target && typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function readCookie(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const cookieHeader = readHeader(headers, "cookie");
  if (!cookieHeader) {
    return undefined;
  }
  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.trim().split("=");
    if (rawKey === name) {
      const value = rest.join("=").trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

function sessionLookupToken(headers: Readonly<Record<string, string | undefined>>, kind: "app" | "ops" = "app"): string | undefined {
  const headerToken = readHeader(headers, "x-session-token")?.trim();
  if (headerToken) {
    return headerToken;
  }
  const authHeader = readHeader(headers, "authorization")?.trim();
  if (authHeader && authHeader.toLowerCase().startsWith("session ")) {
    const token = authHeader.slice(8).trim();
    return token.length > 0 ? token : undefined;
  }
  return readCookie(headers, kind === "ops" ? "ops_session" : "app_session");
}

function readTrimmedHeader(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const raw = readHeader(headers, name);
  if (raw === undefined) {
    return undefined;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeHeaderMap(headers: unknown): Readonly<Record<string, string | undefined>> {
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    return {};
  }
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key] = typeof value === "string" ? value : undefined;
  }
  return normalized;
}

function rowToUser(row: PrismaUser): IdentityUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    emailVerifiedAt: row.emailVerifiedAt,
    mfaSecretEncrypted: row.mfaSecretEncrypted,
    mfaEnabledAt: row.mfaEnabledAt,
    mfaRecoveryCodesHashedJson: row.mfaRecoveryCodesHashedJson,
    roleOperatorGrantedAt: row.roleOperatorGrantedAt,
    roleOperatorGrantedByUserId: row.roleOperatorGrantedByUserId,
    roleOperatorRevokedAt: row.roleOperatorRevokedAt,
    deletedAt: row.deletedAt,
    deletionReason: row.deletionReason,
    purgeAt: row.purgeAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToWorkspace(row: PrismaWorkspace): IdentityWorkspace {
  return {
    id: row.id,
    name: row.name,
    billingEmail: row.billingEmail,
    suspendedAt: row.suspendedAt,
    suspendedReason: row.suspendedReason,
    suspendedByUserId: row.suspendedByUserId,
    deletedAt: row.deletedAt,
    deletionReason: row.deletionReason,
    purgeAt: row.purgeAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToMembership(row: PrismaMembership): IdentityMembership {
  let role: IdentityRole = "member";
  if (row.role === "owner" || row.role === "customer_owner") {
    role = "owner";
  } else if (row.role === "member" || row.role === "customer_member") {
    role = "member";
  } else if (row.role === "operator") {
    role = "operator";
  }
  return {
    workspaceId: row.workspaceId,
    userId: row.userId,
    role,
    createdAt: row.createdAt,
  };
}

function rowToSession(
  session: PrismaSession,
  user: IdentityUser,
  workspace: IdentityWorkspace | null,
  membership: IdentityMembership | null,
): IdentitySession {
  return {
    id: session.id,
    tokenHash: session.tokenHash,
    user,
    workspace: workspace || {
      id: "operator-workspace",
      name: "Operator Workspace",
      createdAt: session.createdAt,
    },
    membership: membership || {
      workspaceId: "operator-workspace",
      userId: user.id,
      role: "operator",
      createdAt: session.createdAt,
    },
    sessionKind: session.sessionKind as "app" | "ops",
    userAgent: session.userAgent,
    clientIpHash: session.clientIpHash,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
  };
}

async function getOrCreateUser(input: DemoSignInInput): Promise<IdentityUser> {
  const userId = normalizeIdentifier(input.userId, "userId", "demo-user");
  const existing = await prisma.identityUser.findUnique({ where: { id: userId } });
  if (existing) {
    const normalizedEmail = input.email === undefined
      ? existing.email
      : normalizeEmail(input.email, userId);
    const normalizedName = input.name === undefined
      ? existing.name
      : normalizeOptionalDisplayName(input.name, "name", existing.name);
    if (existing.email === normalizedEmail && existing.name === normalizedName) {
      return rowToUser(existing);
    }
    const updated = await prisma.identityUser.update({
      where: { id: userId },
      data: { email: normalizedEmail, name: normalizedName },
    });
    return rowToUser(updated);
  }
  const normalizedEmail = normalizeEmail(input.email, userId);
  const normalizedName = normalizeOptionalDisplayName(input.name, "name", "Demo User");
  const created = await prisma.identityUser.create({
    data: {
      id: userId,
      email: normalizedEmail,
      name: normalizedName,
      createdAt: new Date().toISOString(),
    },
  });
  return rowToUser(created);
}

async function getOrCreateWorkspace(input: DemoSignInInput): Promise<IdentityWorkspace> {
  const workspaceId = normalizeIdentifier(input.workspaceId, "workspaceId", "default-workspace");
  const existing = await prisma.identityWorkspace.findUnique({ where: { id: workspaceId } });
  if (existing) {
    const normalizedName = input.workspaceName === undefined
      ? existing.name
      : normalizeOptionalDisplayName(input.workspaceName, "workspaceName", existing.name);
    if (existing.name === normalizedName) {
      return rowToWorkspace(existing);
    }
    const updated = await prisma.identityWorkspace.update({
      where: { id: workspaceId },
      data: { name: normalizedName },
    });
    return rowToWorkspace(updated);
  }
  const normalizedName = normalizeOptionalDisplayName(input.workspaceName, "workspaceName", "Default Workspace");
  const created = await prisma.identityWorkspace.create({
    data: {
      id: workspaceId,
      name: normalizedName,
      createdAt: new Date().toISOString(),
    },
  });
  return rowToWorkspace(created);
}

async function getOrCreateMembership(
  workspace: IdentityWorkspace,
  user: IdentityUser,
  role?: IdentityRole,
): Promise<IdentityMembership> {
  const normalizedRole = normalizeRole(role) ?? "customer_owner";
  const dbRole = normalizedRole === "customer_owner" || normalizedRole === "owner" ? "customer_owner" : "customer_member";
  const existing = await prisma.identityMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
  });
  if (existing) {
    if (existing.role === dbRole) {
      return rowToMembership(existing);
    }
    const updated = await prisma.identityMembership.update({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      data: { role: dbRole },
    });
    return rowToMembership(updated);
  }
  const created = await prisma.identityMembership.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: dbRole,
      createdAt: new Date().toISOString(),
    },
  });
  return rowToMembership(created);
}

function issueSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

async function upsertSession(
  token: string,
  user: IdentityUser,
  workspace: IdentityWorkspace,
  membership: IdentityMembership,
): Promise<IdentitySession> {
  const now = new Date().toISOString();
  const tokenHash = hashToken(token);
  const data = {
    userId: user.id,
    workspaceId: workspace.id,
    membershipUserId: membership.userId,
    membershipWorkspaceId: membership.workspaceId,
    membershipRole: membership.role,
    lastSeenAt: now,
    sessionKind: "app",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: null,
  };
  const session = await prisma.identitySession.upsert({
    where: { tokenHash },
    update: data,
    create: {
      id: `session-${randomBytes(12).toString("hex")}`,
      tokenHash,
      ...data,
      createdAt: now,
    },
  });
  return rowToSession(session, user, workspace, membership);
}

function resolveManagedAuthInput(headers: Readonly<Record<string, string | undefined>>): ManagedAuthHeaderInput | null {
  if (!isManagedAuthHeaderBridgeEnabled()) {
    return null;
  }
  const userId = readTrimmedHeader(headers, "x-auth-user-id");
  const workspaceId = readTrimmedHeader(headers, "x-auth-workspace-id");
  const email = readTrimmedHeader(headers, "x-auth-email");
  const name = readTrimmedHeader(headers, "x-auth-name");
  const workspaceName = readTrimmedHeader(headers, "x-auth-workspace-name");
  const roleHeader = readTrimmedHeader(headers, "x-auth-role")?.toLowerCase();
  const sessionId = readTrimmedHeader(headers, "x-auth-session-id");
  const hasManagedAuthHeader =
    userId !== undefined
    || workspaceId !== undefined
    || email !== undefined
    || name !== undefined
    || workspaceName !== undefined
    || roleHeader !== undefined
    || sessionId !== undefined;
  if (!hasManagedAuthHeader) {
    return null;
  }
  if (!userId || !workspaceId) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "managed auth headers require both user and workspace identifiers");
  }
  const role = roleHeader === undefined || roleHeader.length === 0
    ? undefined
    : normalizeRole(roleHeader as IdentityRole);
  const sessionToken = sessionId && sessionId.length > 0
    ? normalizeIdentifier(sessionId, "sessionId", "")
    : `managed:${workspaceId}:${userId}`;
  return {
    userId,
    email,
    name,
    workspaceId,
    workspaceName,
    role,
    sessionToken,
  };
}

async function resolveManagedSession(headers: Readonly<Record<string, string | undefined>>): Promise<IdentitySession | null> {
  const managed = resolveManagedAuthInput(headers);
  if (!managed) {
    return null;
  }
  const user = await getOrCreateUser(managed);
  const workspace = await getOrCreateWorkspace(managed);
  const membership = await getOrCreateMembership(workspace, user, managed.role);
  return upsertSession(managed.sessionToken, user, workspace, membership);
}

export async function issueDemoSession(input: DemoSignInInput = {}): Promise<IssuedIdentitySession> {
  if (!isDemoSessionBridgeEnabled()) {
    throw buildError(IdentityErrorCode.NOT_FOUND, "demo session bridge is unavailable");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "demo session input is required");
  }
  if (input.name !== undefined && typeof input.name !== "string") {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "name must be a string");
  }
  if (input.workspaceName !== undefined && typeof input.workspaceName !== "string") {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "workspaceName must be a string");
  }
  const user = await getOrCreateUser(input);
  const workspace = await getOrCreateWorkspace(input);
  const membership = await getOrCreateMembership(workspace, user, input.role);
  const token = issueSessionToken();
  const session = await upsertSession(token, user, workspace, membership);
  return { ...session, token };
}

export async function getSession(token: string): Promise<IdentitySession | null> {
  const normalized = normalizeSessionTokenCandidate(token);
  if (!normalized) {
    return null;
  }
  const session = await prisma.identitySession.findUnique({ where: { tokenHash: hashToken(normalized) } });
  if (!session || (session.revokedAt !== null && session.revokedAt !== undefined)) {
    return null;
  }
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    return null; // session expired
  }
  const user = await prisma.identityUser.findUnique({ where: { id: session.userId } });
  if (!user || user.deletedAt) {
    return null;
  }
  
  let workspace: IdentityWorkspace | null = null;
  let membership: IdentityMembership | null = null;

  if (session.workspaceId) {
    const ws = await prisma.identityWorkspace.findUnique({ where: { id: session.workspaceId } });
    if (ws) {
      workspace = rowToWorkspace(ws);
    }
  }

  if (session.membershipWorkspaceId && session.membershipUserId) {
    const mem = await prisma.identityMembership.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: session.membershipWorkspaceId,
          userId: session.membershipUserId,
        },
      },
    });
    if (mem) {
      membership = rowToMembership(mem);
    }
  }

  return rowToSession(session, rowToUser(user), workspace, membership);
}

export async function revokeSession(token: string): Promise<boolean> {
  const normalized = normalizeSessionTokenCandidate(token);
  if (!normalized) {
    return false;
  }
  const now = new Date().toISOString();
  const result = await prisma.identitySession.updateMany({
    where: { tokenHash: hashToken(normalized) },
    data: { revokedAt: now }
  });
  return result.count > 0;
}

export async function getWorkspace(workspaceId: string): Promise<IdentityWorkspace> {
  const normalized = normalizeIdentifier(workspaceId, "workspaceId", "");
  const workspace = await prisma.identityWorkspace.findUnique({ where: { id: normalized } });
  if (!workspace) {
    throw buildError(IdentityErrorCode.NOT_FOUND, "workspace not found");
  }
  return rowToWorkspace(workspace);
}

export async function updateWorkspace(workspaceId: string, input: WorkspaceUpdateInput): Promise<IdentityWorkspace> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "workspace update input is required");
  }
  const normalized = normalizeIdentifier(workspaceId, "workspaceId", "");
  const existing = await prisma.identityWorkspace.findUnique({ where: { id: normalized } });
  if (!existing) {
    throw buildError(IdentityErrorCode.NOT_FOUND, "workspace not found");
  }
  let nextName = existing.name;
  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      throw buildError(IdentityErrorCode.BAD_REQUEST, "workspace name must be a string");
    }
    const trimmedName = input.name.trim();
    if (trimmedName.length === 0) {
      throw buildError(IdentityErrorCode.BAD_REQUEST, "workspace name must be non-empty");
    }
    nextName = trimmedName;
  }
  
  let nextBillingEmail = existing.billingEmail;
  if (input.billingEmail !== undefined) {
    if (typeof input.billingEmail !== "string") {
      throw buildError(IdentityErrorCode.BAD_REQUEST, "billing email must be a string");
    }
    nextBillingEmail = input.billingEmail.trim().toLowerCase();
  }

  const updated = await prisma.identityWorkspace.update({
    where: { id: normalized },
    data: { name: nextName, billingEmail: nextBillingEmail, updatedAt: new Date().toISOString() },
  });
  return rowToWorkspace(updated);
}

export async function resolveSession(headers: Readonly<Record<string, string | undefined>>): Promise<IdentitySession | null> {
  const normalizedHeaders = normalizeHeaderMap(headers);
  const managedSession = await resolveManagedSession(normalizedHeaders);
  if (managedSession) {
    return managedSession;
  }
  // Try app_session first, then ops_session
  const appLookup = sessionLookupToken(normalizedHeaders, "app");
  if (appLookup) {
    const sess = await getSession(appLookup);
    if (sess) return sess;
  }
  const opsLookup = sessionLookupToken(normalizedHeaders, "ops");
  if (opsLookup) {
    return getSession(opsLookup);
  }
  return null;
}

export async function clearSession(headers: Readonly<Record<string, string | undefined>>): Promise<boolean> {
  const normalizedHeaders = normalizeHeaderMap(headers);
  const managed = resolveManagedAuthInput(normalizedHeaders);
  if (managed) {
    return revokeSession(managed.sessionToken);
  }
  const appLookup = sessionLookupToken(normalizedHeaders, "app");
  const opsLookup = sessionLookupToken(normalizedHeaders, "ops");
  const lookup = appLookup || opsLookup;
  if (!lookup) {
    return false;
  }
  if (appLookup) {
    await revokeSession(appLookup);
  }
  if (opsLookup) {
    await revokeSession(opsLookup);
  }
  return true;
}

export async function requireSession(headers: Readonly<Record<string, string | undefined>>): Promise<IdentitySession> {
  const session = await resolveSession(headers);
  if (!session) {
    throw buildError(IdentityErrorCode.UNAUTHORIZED, "session is required");
  }
  return session;
}

export async function requireCustomerSession(headers: Readonly<Record<string, string | undefined>>): Promise<IdentitySession> {
  const session = await requireSession(headers);
  if (session.sessionKind === "ops") {
    throw buildError(IdentityErrorCode.WRONG_SURFACE, "operator session presented to customer surface");
  }
  return session;
}

export async function requireOperatorSession(headers: Readonly<Record<string, string | undefined>>): Promise<IdentitySession> {
  const session = await requireSession(headers);
  if (session.sessionKind !== "ops") {
    throw buildError(IdentityErrorCode.WRONG_SURFACE, "customer session presented to operator surface");
  }
  if (!session.user.roleOperatorGrantedAt) {
    throw buildError(IdentityErrorCode.UNAUTHORIZED, "operator role required");
  }
  return session;
}

export async function listWorkspaceMemberships(workspaceId: string): Promise<IdentityMembership[]> {
  const normalizedWorkspaceId = normalizeIdentifier(workspaceId, "workspaceId", "");
  const workspace = await prisma.identityWorkspace.findUnique({ where: { id: normalizedWorkspaceId } });
  if (!workspace) {
    throw buildError(IdentityErrorCode.NOT_FOUND, "workspace not found");
  }
  const rows = await prisma.identityMembership.findMany({
    where: { workspaceId: normalizedWorkspaceId },
  });
  return rows
    .map((row) => rowToMembership(row))
    .sort((left, right) => {
      if (left.role !== right.role) {
        return left.role === "owner" ? -1 : 1;
      }
      return left.userId.localeCompare(right.userId);
    });
}

// FIRST-PARTY PERSISTENT AUTH IMPLEMENTATIONS

export async function createUser(input: CreateUserInput): Promise<IdentityUser> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "user input is required");
  }
  if (!input.email || !input.email.includes("@")) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "email is required and must be valid");
  }
  if (input.passwordHash !== undefined && !isArgon2idHash(input.passwordHash)) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "passwordHash must be an encoded Argon2id credential");
  }
  const normalizedEmail = input.email.trim().toLowerCase();
  
  const existing = await prisma.identityUser.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "email already registered");
  }

  const userId = `user-${randomBytes(12).toString("hex")}`;
  const now = new Date().toISOString();
  
  const created = await prisma.identityUser.create({
    data: {
      id: userId,
      email: normalizedEmail,
      name: input.displayName || normalizedEmail.split("@")[0],
      passwordHash: input.passwordHash || null,
      createdAt: now,
      updatedAt: now
    }
  });

  return rowToUser(created);
}

export async function getUserByEmail(email: string): Promise<IdentityUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    return null;
  }
  const user = await prisma.identityUser.findUnique({ where: { email: normalizedEmail } });
  if (!user || user.deletedAt) return null;
  return rowToUser(user);
}

export async function getUserById(userId: string): Promise<IdentityUser | null> {
  const normalized = normalizeIdentifier(userId, "userId", "");
  const user = await prisma.identityUser.findUnique({ where: { id: normalized } });
  if (!user || user.deletedAt) return null;
  return rowToUser(user);
}

export async function markEmailVerified(userId: string): Promise<IdentityUser> {
  const normalized = normalizeIdentifier(userId, "userId", "");
  const existing = await prisma.identityUser.findUnique({ where: { id: normalized } });
  if (!existing) {
    throw buildError(IdentityErrorCode.NOT_FOUND, "user not found");
  }
  const updated = await prisma.identityUser.update({
    where: { id: normalized },
    data: { emailVerifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  });
  return rowToUser(updated);
}

export async function setPasswordHash(userId: string, passwordHash: string): Promise<void> {
  const normalized = normalizeIdentifier(userId, "userId", "");
  if (typeof passwordHash !== "string" || !isArgon2idHash(passwordHash)) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "passwordHash must be an encoded Argon2id credential");
  }
  const existing = await prisma.identityUser.findUnique({ where: { id: normalized } });
  if (!existing) {
    throw buildError(IdentityErrorCode.NOT_FOUND, "user not found");
  }
  await prisma.identityUser.update({
    where: { id: normalized },
    data: { passwordHash, updatedAt: new Date().toISOString() }
  });
}

export async function verifyPasswordHash(userId: string, candidatePassword: string): Promise<boolean> {
  const normalized = normalizeIdentifier(userId, "userId", "");
  if (typeof candidatePassword !== "string") {
    return false;
  }
  const user = await prisma.identityUser.findUnique({ where: { id: normalized } });
  if (!user || !user.passwordHash) return false;
  const result = verifyPasswordForMigration(candidatePassword, user.passwordHash);
  if (result.valid && result.needsRehash) {
    await prisma.identityUser.update({
      where: { id: normalized },
      data: {
        passwordHash: hashPassword(candidatePassword),
        updatedAt: new Date().toISOString(),
      },
    });
  }
  return result.valid;
}

export async function createSession(userId: string, opts: { userAgent?: string; clientIpHash?: string } = {}): Promise<IssuedIdentitySession> {
  const normalized = normalizeIdentifier(userId, "userId", "");
  const user = await prisma.identityUser.findUnique({ where: { id: normalized } });
  if (!user || user.deletedAt) {
    throw buildError(IdentityErrorCode.NOT_FOUND, "user not found");
  }

  // Find workspace context for customer
  const memberships = await prisma.identityMembership.findMany({ where: { userId: normalized } });
  let workspaceId = "";
  let workspace: IdentityWorkspace | null = null;
  let membership: IdentityMembership | null = null;

  if (memberships.length > 0) {
    const sorted = memberships.sort((a, b) => b.role.localeCompare(a.role));
    const activeMember = sorted[0];
    workspaceId = activeMember.workspaceId;
    membership = rowToMembership(activeMember);
    const ws = await prisma.identityWorkspace.findUnique({ where: { id: workspaceId } });
    if (ws) workspace = rowToWorkspace(ws);
  } else {
    // Auto-create a default workspace for user
    const wsId = `workspace-${randomBytes(12).toString("hex")}`;
    const wsName = `${user.name}'s workspace`;
    const now = new Date().toISOString();
    const ws = await prisma.identityWorkspace.create({
      data: {
        id: wsId,
        name: wsName,
        createdAt: now,
        updatedAt: now
      }
    });
    workspace = rowToWorkspace(ws);
    const mem = await prisma.identityMembership.create({
      data: {
        workspaceId: wsId,
        userId: normalized,
        role: "customer_owner",
        createdAt: now
      }
    });
    membership = rowToMembership(mem);
    workspaceId = wsId;
  }

  const token = issueSessionToken();
  const now = new Date().toISOString();
  const session = await prisma.identitySession.create({
    data: {
      id: `session-${randomBytes(12).toString("hex")}`,
      tokenHash: hashToken(token),
      userId: normalized,
      workspaceId,
      membershipUserId: normalized,
      membershipWorkspaceId: workspaceId,
      membershipRole: membership.role,
      sessionKind: "app",
      userAgent: opts.userAgent || null,
      clientIpHash: opts.clientIpHash || null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  });

  return { ...rowToSession(session, rowToUser(user), workspace, membership), token };
}

export async function createOperatorSession(userId: string, opts: { userAgent?: string; clientIpHash?: string } = {}): Promise<IssuedIdentitySession> {
  const normalized = normalizeIdentifier(userId, "userId", "");
  const user = await prisma.identityUser.findUnique({ where: { id: normalized } });
  if (!user || user.deletedAt) {
    throw buildError(IdentityErrorCode.NOT_FOUND, "user not found");
  }
  if (!user.roleOperatorGrantedAt) {
    throw buildError(IdentityErrorCode.UNAUTHORIZED, "operator role required");
  }

  const token = issueSessionToken();
  const now = new Date().toISOString();
  const session = await prisma.identitySession.create({
    data: {
      id: `session-${randomBytes(12).toString("hex")}`,
      tokenHash: hashToken(token),
      userId: normalized,
      workspaceId: "", // Operators do not have a default workspace context in operators session
      membershipUserId: normalized,
      membershipWorkspaceId: "",
      membershipRole: "operator",
      sessionKind: "ops",
      userAgent: opts.userAgent || null,
      clientIpHash: opts.clientIpHash || null,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  });

  return { ...rowToSession(session, rowToUser(user), null, null), token };
}

export async function createCredentialToken(input: {
  userId?: string;
  purpose: CredentialTokenPurpose;
  meta?: Record<string, unknown>;
  lifetimeMs: number;
}): Promise<{ tokenId: string; rawToken: string }> {
  const rawToken = generateRawToken();
  const hash = hashToken(rawToken);
  const tokenId = `token-${randomBytes(12).toString("hex")}`;
  const now = Date.now();
  
  await prisma.identityCredentialToken.create({
    data: {
      id: tokenId,
      tokenHash: hash,
      userId: input.userId || null,
      purpose: input.purpose,
      metaJson: input.meta ? JSON.stringify(input.meta) : null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + input.lifetimeMs).toISOString(),
    }
  });

  return { tokenId, rawToken };
}

export async function consumeCredentialToken(rawToken: string, purpose: CredentialTokenPurpose): Promise<IdentityCredentialToken> {
  const hash = hashToken(rawToken);
  const tokenRow = await prisma.identityCredentialToken.findUnique({ where: { tokenHash: hash } });
  if (!tokenRow || tokenRow.purpose !== purpose) {
    throw buildError(IdentityErrorCode.TOKEN_INVALID, "token is invalid");
  }
  if (tokenRow.consumedAt) {
    throw buildError(IdentityErrorCode.TOKEN_INVALID, "token already consumed");
  }
  const now = new Date().toISOString();
  if (tokenRow.expiresAt < now) {
    throw buildError(IdentityErrorCode.TOKEN_EXPIRED, "token expired");
  }

  const updated = await prisma.identityCredentialToken.update({
    where: { tokenHash: hash },
    data: { consumedAt: now }
  });

  return {
    id: updated.id,
    tokenHash: updated.tokenHash,
    userId: updated.userId,
    purpose: updated.purpose as CredentialTokenPurpose,
    metaJson: updated.metaJson,
    createdAt: updated.createdAt,
    expiresAt: updated.expiresAt,
    consumedAt: updated.consumedAt
  };
}

export async function getCredentialToken(rawToken: string, purpose: CredentialTokenPurpose): Promise<IdentityCredentialToken | null> {
  const hash = hashToken(rawToken);
  const tokenRow = await prisma.identityCredentialToken.findUnique({ where: { tokenHash: hash } });
  if (!tokenRow || tokenRow.purpose !== purpose) {
    return null;
  }
  return {
    id: tokenRow.id,
    tokenHash: tokenRow.tokenHash,
    userId: tokenRow.userId,
    purpose: tokenRow.purpose as CredentialTokenPurpose,
    metaJson: tokenRow.metaJson,
    createdAt: tokenRow.createdAt,
    expiresAt: tokenRow.expiresAt,
    consumedAt: tokenRow.consumedAt
  };
}

export async function createWorkspace(input: { name: string; ownerUserId: string }): Promise<IdentityWorkspace> {
  const ownerId = normalizeIdentifier(input.ownerUserId, "ownerUserId", "");
  const user = await prisma.identityUser.findUnique({ where: { id: ownerId } });
  if (!user || user.deletedAt) {
    throw buildError(IdentityErrorCode.NOT_FOUND, "owner user not found");
  }

  const name = input.name.trim();
  if (name.length === 0) {
    throw buildError(IdentityErrorCode.BAD_REQUEST, "workspace name is required");
  }

  const wsId = `workspace-${randomBytes(12).toString("hex")}`;
  const now = new Date().toISOString();

  const ws = await prisma.$transaction(async (tx) => {
    const wsRow = await tx.identityWorkspace.create({
      data: {
        id: wsId,
        name,
        createdAt: now,
        updatedAt: now
      }
    });

    await tx.identityMembership.create({
      data: {
        workspaceId: wsId,
        userId: ownerId,
        role: "customer_owner",
        createdAt: now
      }
    });

    return wsRow;
  });

  return rowToWorkspace(ws);
}

export async function attachWorkspaceMember(workspaceId: string, userId: string, role: "customer_member" | "customer_owner"): Promise<IdentityMembership> {
  const wsId = normalizeIdentifier(workspaceId, "workspaceId", "");
  const uId = normalizeIdentifier(userId, "userId", "");
  
  const ws = await prisma.identityWorkspace.findUnique({ where: { id: wsId } });
  if (!ws) throw buildError(IdentityErrorCode.NOT_FOUND, "workspace not found");
  
  const u = await prisma.identityUser.findUnique({ where: { id: uId } });
  if (!u || u.deletedAt) throw buildError(IdentityErrorCode.NOT_FOUND, "user not found");

  const mem = await prisma.identityMembership.create({
    data: {
      workspaceId: wsId,
      userId: uId,
      role,
      createdAt: new Date().toISOString()
    }
  });

  return rowToMembership(mem);
}

export async function removeWorkspaceMember(workspaceId: string, userId: string, reason: string): Promise<void> {
  void reason;
  const wsId = normalizeIdentifier(workspaceId, "workspaceId", "");
  const uId = normalizeIdentifier(userId, "userId", "");

  const mem = await prisma.identityMembership.findUnique({
    where: { workspaceId_userId: { workspaceId: wsId, userId: uId } }
  });
  if (!mem) throw buildError(IdentityErrorCode.NOT_FOUND, "membership not found");

  if (mem.role === "customer_owner" || mem.role === "owner") {
    // Ensure not sole owner
    const owners = await prisma.identityMembership.findMany({
      where: { workspaceId: wsId, role: { in: ["customer_owner", "owner"] } }
    });
    if (owners.length <= 1) {
      throw buildError(IdentityErrorCode.LAST_OWNER_BLOCKED, "cannot remove the sole owner of a workspace");
    }
  }

  await prisma.identityMembership.delete({
    where: { workspaceId_userId: { workspaceId: wsId, userId: uId } }
  });
}

export async function transferWorkspaceOwnership(workspaceId: string, fromUserId: string, toUserId: string): Promise<void> {
  const wsId = normalizeIdentifier(workspaceId, "workspaceId", "");
  const fromId = normalizeIdentifier(fromUserId, "fromUserId", "");
  const toId = normalizeIdentifier(toUserId, "toUserId", "");

  await prisma.$transaction(async (tx) => {
    const fromMem = await tx.identityMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: wsId, userId: fromId } }
    });
    const toMem = await tx.identityMembership.findUnique({
      where: { workspaceId_userId: { workspaceId: wsId, userId: toId } }
    });

    if (!fromMem || (fromMem.role !== "customer_owner" && fromMem.role !== "owner")) {
      throw buildError(IdentityErrorCode.OWNERSHIP_REQUIRED, "fromUser must be an owner");
    }
    if (!toMem) {
      throw buildError(IdentityErrorCode.NOT_FOUND, "toUser is not a member of this workspace");
    }

    await tx.identityMembership.update({
      where: { workspaceId_userId: { workspaceId: wsId, userId: fromId } },
      data: { role: "customer_member" }
    });

    await tx.identityMembership.update({
      where: { workspaceId_userId: { workspaceId: wsId, userId: toId } },
      data: { role: "customer_owner" }
    });
  });
}

export async function softDeleteWorkspace(workspaceId: string, reason: string): Promise<void> {
  const wsId = normalizeIdentifier(workspaceId, "workspaceId", "");
  const now = new Date().toISOString();
  
  await prisma.$transaction(async (tx) => {
    const ws = await tx.identityWorkspace.findUnique({ where: { id: wsId } });
    if (!ws) throw buildError(IdentityErrorCode.NOT_FOUND, "workspace not found");

    await tx.identityWorkspace.update({
      where: { id: wsId },
      data: {
        deletedAt: now,
        deletionReason: reason,
        purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        suspendedAt: now,
        suspendedReason: `soft-deleted: ${reason}`
      }
    });

    // Revoke sessions of members
    const members = await tx.identityMembership.findMany({ where: { workspaceId: wsId } });
    const userIds = members.map(m => m.userId);
    await tx.identitySession.updateMany({
      where: { userId: { in: userIds } },
      data: { revokedAt: now }
    });
  });
}

export async function hardDeleteWorkspace(workspaceId: string): Promise<void> {
  const wsId = normalizeIdentifier(workspaceId, "workspaceId", "");
  
  await prisma.$transaction(async (tx) => {
    await tx.identitySession.deleteMany({ where: { workspaceId: wsId } });
    await tx.identityMembership.deleteMany({ where: { workspaceId: wsId } });
    // Nullify audit logs PII
    await tx.identityAuthEvent.updateMany({
      where: { workspaceId: wsId },
      data: { clientIpHash: null, userAgent: null }
    });
    await tx.identityWorkspace.delete({ where: { id: wsId } });
  });
}

export async function softDeleteUser(userId: string, reason: string): Promise<void> {
  const uId = normalizeIdentifier(userId, "userId", "");
  const now = new Date().toISOString();

  await prisma.$transaction(async (tx) => {
    const user = await tx.identityUser.findUnique({ where: { id: uId } });
    if (!user) throw buildError(IdentityErrorCode.NOT_FOUND, "user not found");

    await tx.identityUser.update({
      where: { id: uId },
      data: {
        deletedAt: now,
        deletionReason: reason,
        purgeAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }
    });

    // Revoke all user sessions
    await tx.identitySession.updateMany({
      where: { userId: uId },
      data: { revokedAt: now }
    });
  });
}

export async function hardDeleteUser(userId: string): Promise<void> {
  const uId = normalizeIdentifier(userId, "userId", "");
  
  await prisma.$transaction(async (tx) => {
    await tx.identitySession.deleteMany({ where: { userId: uId } });
    await tx.identityMembership.deleteMany({ where: { userId: uId } });
    // Nullify audit logs PII
    await tx.identityAuthEvent.updateMany({
      where: { userId: uId },
      data: { clientIpHash: null, userAgent: null }
    });
    await tx.identityUser.delete({ where: { id: uId } });
  });
}

export async function grantOperatorRole(userId: string, grantedByUserId: string, reason: string): Promise<void> {
  void reason;
  const uId = normalizeIdentifier(userId, "userId", "");
  const grantorId = normalizeIdentifier(grantedByUserId, "grantedByUserId", "");

  const user = await prisma.identityUser.findUnique({ where: { id: uId } });
  if (!user) throw buildError(IdentityErrorCode.NOT_FOUND, "user not found");

  await prisma.identityUser.update({
    where: { id: uId },
    data: {
      roleOperatorGrantedAt: new Date().toISOString(),
      roleOperatorGrantedByUserId: grantorId,
      roleOperatorRevokedAt: null,
      updatedAt: new Date().toISOString()
    }
  });
}

export async function revokeOperatorRole(userId: string, revokedByUserId: string, reason: string): Promise<void> {
  void reason;
  const uId = normalizeIdentifier(userId, "userId", "");
  const revokerId = normalizeIdentifier(revokedByUserId, "revokedByUserId", "");

  if (uId === revokerId) {
    throw buildError(IdentityErrorCode.OPERATOR_SELF_REVOKE, "cannot revoke your own operator role");
  }

  const user = await prisma.identityUser.findUnique({ where: { id: uId } });
  if (!user) throw buildError(IdentityErrorCode.NOT_FOUND, "user not found");

  await prisma.identityUser.update({
    where: { id: uId },
    data: {
      roleOperatorGrantedAt: null,
      roleOperatorRevokedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  });
}

export async function listOperators(): Promise<IdentityUser[]> {
  const rows = await prisma.identityUser.findMany({
    where: { roleOperatorGrantedAt: { not: null } }
  });
  return rows.map(r => rowToUser(r));
}

export async function recordAuthEvent(event: IdentityAuthEvent): Promise<void> {
  await prisma.identityAuthEvent.create({
    data: {
      id: event.id,
      eventType: event.eventType,
      userId: event.userId || null,
      workspaceId: event.workspaceId || null,
      actorRole: event.actorRole || null,
      clientIpHash: event.clientIpHash || null,
      userAgent: event.userAgent || null,
      outcome: event.outcome,
      reason: event.reason || null,
      recordedAt: event.recordedAt
    }
  });
}

export async function listAuthEvents(opts: { userId?: string; eventType?: string; limit?: number } = {}): Promise<IdentityAuthEvent[]> {
  const query: Record<string, unknown> = {};
  if (opts.userId) query.userId = opts.userId;
  if (opts.eventType) query.eventType = opts.eventType;

  const rows = await prisma.identityAuthEvent.findMany({
    where: query,
    orderBy: { recordedAt: "desc" },
    take: opts.limit || 100
  });

  return rows.map(r => ({
    id: r.id,
    eventType: r.eventType,
    userId: r.userId,
    workspaceId: r.workspaceId,
    actorRole: r.actorRole,
    clientIpHash: r.clientIpHash,
    userAgent: r.userAgent,
    outcome: r.outcome as IdentityAuthEvent["outcome"],
    reason: r.reason,
    recordedAt: r.recordedAt
  }));
}

export async function incrementLockoutCounter(key: string, kind: "email" | "ip"): Promise<{ failureCount: number; lockedUntil?: Date }> {
  const normalizedKey = key.trim().toLowerCase();
  const now = new Date();
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  
  const lockout = await prisma.identityAuthLockout.findUnique({
    where: { key_keyKind: { key: normalizedKey, keyKind: kind } }
  });
  
  let failureCount = 1;
  let lockedUntil: Date | undefined;
  
  if (lockout) {
    if (lockout.windowStart < windowStart) {
      failureCount = 1;
      await prisma.identityAuthLockout.update({
        where: { id: lockout.id },
        data: {
          failureCount,
          windowStart: now.toISOString(),
          lockedUntil: null
        }
      });
    } else {
      failureCount = lockout.failureCount + 1;
      
      let threshold = 5;
      if (kind === "email") {
        const user = await prisma.identityUser.findUnique({ where: { email: normalizedKey } });
        if (user && user.roleOperatorGrantedAt) {
          threshold = 3;
        }
      }
      
      const shouldLock = failureCount >= threshold;
      const lockedUntilStr = shouldLock ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : null;
      lockedUntil = shouldLock ? new Date(now.getTime() + 15 * 60 * 1000) : undefined;
      
      await prisma.identityAuthLockout.update({
        where: { id: lockout.id },
        data: {
          failureCount,
          lockedUntil: lockedUntilStr
        }
      });
    }
  } else {
    const id = `lockout-${randomBytes(12).toString("hex")}`;
    await prisma.identityAuthLockout.create({
      data: {
        id,
        key: normalizedKey,
        keyKind: kind,
        failureCount: 1,
        windowStart: now.toISOString(),
        lockedUntil: null
      }
    });
  }
  
  return { failureCount, lockedUntil };
}

export async function clearLockoutCounter(key: string, kind: "email" | "ip"): Promise<void> {
  const normalizedKey = key.trim().toLowerCase();
  await prisma.identityAuthLockout.deleteMany({
    where: { key: normalizedKey, keyKind: kind }
  });
}

export async function isLockedOut(key: string, kind: "email" | "ip"): Promise<boolean> {
  const normalizedKey = key.trim().toLowerCase();
  const lockout = await prisma.identityAuthLockout.findUnique({
    where: { key_keyKind: { key: normalizedKey, keyKind: kind } }
  });
  if (!lockout || !lockout.lockedUntil) return false;
  const now = new Date().toISOString();
  if (lockout.lockedUntil < now) {
    await clearLockoutCounter(key, kind);
    return false;
  }
  return true;
}
