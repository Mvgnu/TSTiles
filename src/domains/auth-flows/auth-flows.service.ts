import { randomBytes, createHmac } from "node:crypto";
import { prisma } from "../../config/db";
import {
  type IdentityUser,
  type IdentityWorkspace,
  type IssuedIdentitySession,
  type IdentityCredentialToken,
} from "../identity/types";
import {
  createUser as identityCreateUser,
  getSession,
  getUserByEmail,
  getUserById,
  markEmailVerified,
  setPasswordHash,
  verifyPasswordHash,
  createSession,
  revokeSession,
  createCredentialToken,
  consumeCredentialToken,
  getCredentialToken,
  createWorkspace,
  attachWorkspaceMember,
  recordAuthEvent,
} from "../identity/identity.service";
import { sendTransactionalEmail, isSuppressed } from "../email/email.service";
import {
  AuthFlowError,
  AuthFlowErrorCode,
  type SignUpInput,
  type SignInInput,
} from "./types";
import {
  checkSignInLockout,
  incrementSignInFailures,
  clearSignInLockout,
  checkSignUpRateLimit,
  checkRequestTokenRateLimit,
  checkVerificationResendRateLimit,
} from "./components/rate-limit";
import { hashPassword } from "../identity/components/password-hash";
import { getIpHashKey } from "./components/secrets";

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * Validates password strength: 12+ characters, at least one digit and one non-letter-non-digit.
 */
export function isPasswordStrong(password: string): boolean {
  if (password.length < 12) {
    return false;
  }
  if (!/\d/.test(password)) {
    return false;
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return false;
  }
  const commonPasswords = ["password123!", "123456789012!", "qwertyuiopas!", "tstiles2026!"];
  if (commonPasswords.includes(password.toLowerCase())) {
    return false;
  }
  return true;
}

/**
 * Normalizes email address by trimming and lowercasing.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Hashes client IP for GDPR-aligned audit logging.
 */
function hashClientIp(ip: string | undefined): string | null {
  if (!ip) {
    return null;
  }
  return createHmac("sha256", getIpHashKey()).update(ip).digest("hex");
}

/**
 * Cleans userAgent verbatim but caps at 256 chars and strips control characters.
 */
function cleanUserAgent(ua: string | undefined): string | null {
  const controlRegex = new RegExp("[\\" + "x00-\\" + "x1F\\" + "x7F]", "g");
  const stripped = (ua || "").replace(controlRegex, "");
  return stripped.slice(0, 256);
}

/**
 * Generic helper to emit audit events.
 */
async function emitAuditEvent(opts: {
  readonly eventType: string;
  readonly userId?: string | null;
  readonly workspaceId?: string | null;
  readonly outcome: "success" | "failure" | "rate_limited";
  readonly reason?: string | null;
  readonly clientIp?: string;
  readonly userAgent?: string;
}): Promise<void> {
  const id = `evt-${randomBytes(12).toString("hex")}`;
  await recordAuthEvent({
    id,
    eventType: opts.eventType,
    userId: opts.userId ?? null,
    workspaceId: opts.workspaceId ?? null,
    actorRole: null,
    clientIpHash: hashClientIp(opts.clientIp),
    userAgent: cleanUserAgent(opts.userAgent),
    outcome: opts.outcome,
    reason: opts.reason ?? null,
    recordedAt: new Date().toISOString(),
  });
}

function getAppBaseUrl(): string {
  return process.env.APP_PUBLIC_BASE_URL?.trim() || "http://localhost:3000";
}

/**
 * sign-up orchestration
 */
export async function signUp(
  input: SignUpInput,
  clientIp?: string,
  userAgent?: string,
): Promise<{ readonly user: IdentityUser; readonly workspace: IdentityWorkspace; readonly pendingVerification: true }> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Input must be an object");
  }

  const { email, password, displayName } = input;
  if (typeof email !== "string" || email.trim().length === 0) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Email is required");
  }

  const normalizedEmail = normalizeEmail(email);
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new AuthFlowError(AuthFlowErrorCode.EMAIL_INVALID, "Invalid email address structure");
  }

  if (password === undefined || typeof password !== "string") {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Password is required");
  }

  if (!isPasswordStrong(password)) {
    throw new AuthFlowError(AuthFlowErrorCode.PASSWORD_WEAK, "Password does not meet strength requirements");
  }

  const name = (displayName || "").trim() || "User";
  const controlRegex = new RegExp("[\\" + "x00-\\" + "x1F\\" + "x7F]");
  if (name.length > 80 || controlRegex.test(name)) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Invalid display name");
  }

  // Rate Limiting
  const ipKey = clientIp || "unknown-ip";
  try {
    await checkSignUpRateLimit(normalizedEmail, ipKey);
  } catch (error) {
    await emitAuditEvent({
      eventType: "USER_SIGNED_UP",
      outcome: "rate_limited",
      reason: "signup_rate_limit_exceeded",
      clientIp,
      userAgent,
    });
    throw error;
  }

  // Managed Auth Provider bridge check
  if ((process.env.IDENTITY_MANAGED_AUTH_MODE?.trim().toLowerCase() ?? "") === "header") {
    throw new AuthFlowError(
      AuthFlowErrorCode.PROVIDER_BRIDGE_ACTIVE,
      "First-party sign-up is disabled when enterprise SSO header bridge is active",
    );
  }

  // Check collision
  const existingUser = await getUserByEmail(normalizedEmail);
  if (existingUser) {
    // Non-enumerating response: send verification with mode=collision
    const emailSuppressed = await isSuppressed(normalizedEmail);
    if (!emailSuppressed) {
      const signInUrl = `${getAppBaseUrl()}/sign-in`;
      try {
        await sendTransactionalEmail({
          to: normalizedEmail,
          templateKey: "email_verification",
          params: {
            verificationUrl: signInUrl,
            name: existingUser.name,
            mode: "collision",
          },
          idempotencyKey: `signup_coll_${randomBytes(12).toString("hex")}`,
        });
      } catch {
        // Send failure does not break the flow, but do not throw
      }
    }

    // Return mock unverified state to prevent email enumeration
    const mockUser: IdentityUser = {
      id: "mock-id",
      email: normalizedEmail,
      name,
      createdAt: new Date().toISOString(),
    };
    const mockWorkspace: IdentityWorkspace = {
      id: "mock-ws",
      name: `${name}'s workspace`,
      createdAt: new Date().toISOString(),
    };

    return { user: mockUser, workspace: mockWorkspace, pendingVerification: true };
  }

  // Success signup flow: create user and workspace
  const passHash = hashPassword(password);
  const user = await identityCreateUser({
    email: normalizedEmail,
    displayName: name,
    passwordHash: passHash,
  });

  const workspace = await createWorkspace({
    name: `${name}'s workspace`,
    ownerUserId: user.id,
  });

  // Issue verification token
  const tokenPayload = await createCredentialToken({
    userId: user.id,
    purpose: "email_verification",
    lifetimeMs: 24 * 60 * 60 * 1000, // 24 hours
  });

  const verificationUrl = `${getAppBaseUrl()}/verify-email/${tokenPayload.rawToken}`;

  const emailSuppressed = await isSuppressed(normalizedEmail);
  if (!emailSuppressed) {
    try {
      await sendTransactionalEmail({
        to: normalizedEmail,
        templateKey: "email_verification",
        params: {
          verificationUrl,
          name: user.name,
        },
        idempotencyKey: `signup_verify_${user.id}_${tokenPayload.tokenId}`,
      });
    } catch {
      // Send failure does not break flow
    }
  }

  await emitAuditEvent({
    eventType: "USER_SIGNED_UP",
    userId: user.id,
    workspaceId: workspace.id,
    outcome: "success",
    clientIp,
    userAgent,
  });

  return { user, workspace, pendingVerification: true };
}

/**
 * sign-in orchestration
 */
export async function signIn(
  input: SignInInput,
): Promise<
  | { readonly user: IdentityUser; readonly mfaRequired: true }
  | { readonly user: IdentityUser; readonly session: IssuedIdentitySession; readonly mfaRequired: false }
> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Input must be an object");
  }

  const { email, password, userAgent, clientIp } = input;
  if (typeof email !== "string" || email.trim().length === 0) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Email is required");
  }

  const normalizedEmail = normalizeEmail(email);
  const ipKey = clientIp || "unknown-ip";

  // Check Lockout
  await checkSignInLockout(normalizedEmail, ipKey);

  // Managed Auth Provider bridge check
  if ((process.env.IDENTITY_MANAGED_AUTH_MODE?.trim().toLowerCase() ?? "") === "header") {
    throw new AuthFlowError(
      AuthFlowErrorCode.PROVIDER_BRIDGE_ACTIVE,
      "First-party sign-in is disabled when enterprise SSO header bridge is active",
    );
  }

  const user = await getUserByEmail(normalizedEmail);
  if (!user || !password) {
    await incrementSignInFailures(normalizedEmail, ipKey);
    await emitAuditEvent({
      eventType: "USER_SIGNED_IN",
      outcome: "failure",
      reason: "invalid_credentials",
      clientIp,
      userAgent,
    });
    throw new AuthFlowError(AuthFlowErrorCode.INVALID_CREDENTIALS, "Invalid email or password");
  }

  const isValidPassword = await verifyPasswordHash(user.id, password);
  if (!isValidPassword) {
    await incrementSignInFailures(normalizedEmail, ipKey);
    await emitAuditEvent({
      eventType: "USER_SIGNED_IN",
      userId: user.id,
      outcome: "failure",
      reason: "invalid_credentials",
      clientIp,
      userAgent,
    });
    throw new AuthFlowError(AuthFlowErrorCode.INVALID_CREDENTIALS, "Invalid email or password");
  }

  // Check email verification status
  if (!user.emailVerifiedAt) {
    await emitAuditEvent({
      eventType: "USER_SIGNED_IN",
      userId: user.id,
      outcome: "failure",
      reason: "email_unverified",
      clientIp,
      userAgent,
    });
    throw new AuthFlowError(AuthFlowErrorCode.EMAIL_UNVERIFIED, "Email verification is pending");
  }

  // Check MFA status
  if (user.mfaEnabledAt) {
    await emitAuditEvent({
      eventType: "USER_SIGNED_IN",
      userId: user.id,
      outcome: "failure",
      reason: "mfa_challenge_required",
      clientIp,
      userAgent,
    });
    return { user, mfaRequired: true };
  }

  // Success path: clear lockout counter
  await clearSignInLockout(normalizedEmail, ipKey);

  // Revoke prior sessions for same user-agent (best-effort device revocation)
  const cleanedUa = cleanUserAgent(userAgent);
  if (cleanedUa) {
    const priorSessions = await prisma.identitySession.findMany({
      where: {
        userId: user.id,
        userAgent: cleanedUa,
        revokedAt: null,
      },
    });
    for (const session of priorSessions) {
      await prisma.identitySession.update({
        where: { id: session.id },
        data: { revokedAt: new Date().toISOString() },
      });
    }
  }

  // Create session
  const ipHash = hashClientIp(clientIp) || undefined;
  const session = await createSession(user.id, {
    userAgent: cleanedUa || undefined,
    clientIpHash: ipHash,
  });

  await emitAuditEvent({
    eventType: "USER_SIGNED_IN",
    userId: user.id,
    workspaceId: session.workspace.id,
    outcome: "success",
    clientIp,
    userAgent,
  });

  return { user, session, mfaRequired: false };
}

/**
 * sign-out orchestration
 */
export async function signOut(
  sessionToken: string,
  clientIp?: string,
  userAgent?: string,
): Promise<void> {
  const session = await getSession(sessionToken);

  if (session) {
    await revokeSession(sessionToken);
    await emitAuditEvent({
      eventType: "USER_SIGNED_OUT",
      userId: session.user.id,
      workspaceId: session.workspace.id,
      outcome: "success",
      clientIp,
      userAgent,
    });
  }
}

/**
 * Email verification resend
 */
export async function requestEmailVerification(
  userId: string,
  _clientIp?: string,
  _userAgent?: string,
): Promise<{ readonly dispatched: boolean }> {
  void _clientIp;
  void _userAgent;
  const user = await getUserById(userId);
  if (!user || user.emailVerifiedAt) {
    return { dispatched: false };
  }

  try {
    await checkVerificationResendRateLimit(user.email);
  } catch {
    return { dispatched: false };
  }

  const tokenPayload = await createCredentialToken({
    userId: user.id,
    purpose: "email_verification",
    lifetimeMs: 24 * 60 * 60 * 1000,
  });

  const verificationUrl = `${getAppBaseUrl()}/verify-email/${tokenPayload.rawToken}`;

  const emailSuppressed = await isSuppressed(user.email);
  if (!emailSuppressed) {
    try {
      await sendTransactionalEmail({
        to: user.email,
        templateKey: "email_verification",
        params: {
          verificationUrl,
          name: user.name,
        },
        idempotencyKey: `resend_verify_${user.id}_${tokenPayload.tokenId}`,
      });
    } catch {
      // ignore failures
    }
  }

  return { dispatched: true };
}

/**
 * verify-email token consumption
 */
export async function verifyEmailToken(
  rawToken: string,
  clientIp?: string,
  userAgent?: string,
): Promise<{ readonly user: IdentityUser; readonly session: IssuedIdentitySession }> {
  if (typeof rawToken !== "string" || rawToken.trim().length === 0 || rawToken.includes("/") || rawToken.includes("..")) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Invalid token format");
  }

  let token: IdentityCredentialToken;
  try {
    token = await consumeCredentialToken(rawToken, "email_verification");
  } catch {
    throw new AuthFlowError(
      AuthFlowErrorCode.TOKEN_INVALID,
      "Verification link is invalid or has expired.",
    );
  }

  const userId = token.userId;
  if (!userId) {
    throw new AuthFlowError(AuthFlowErrorCode.TOKEN_INVALID, "Invalid verification token user");
  }

  const user = await markEmailVerified(userId);

  // Issue session
  const ipHash = hashClientIp(clientIp) || undefined;
  const session = await createSession(userId, {
    userAgent: cleanUserAgent(userAgent) || undefined,
    clientIpHash: ipHash,
  });

  // Welcome email
  const emailSuppressed = await isSuppressed(user.email);
  if (!emailSuppressed) {
    try {
      await sendTransactionalEmail({
        to: user.email,
        templateKey: "welcome",
        params: {
          name: user.name,
          email: user.email,
        },
        idempotencyKey: `welcome_${user.id}_${token.id}`,
      });
    } catch {
      // ignore
    }
  }

  await emitAuditEvent({
    eventType: "EMAIL_VERIFIED",
    userId: user.id,
    workspaceId: session.workspace.id,
    outcome: "success",
    clientIp,
    userAgent,
  });

  return { user, session };
}

/**
 * request password reset
 */
export async function requestPasswordReset(
  emailAddress: string,
  clientIp?: string,
  userAgent?: string,
): Promise<{ readonly dispatched: boolean }> {
  if (typeof emailAddress !== "string" || emailAddress.trim().length === 0) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Email address is required");
  }

  const normalizedEmail = normalizeEmail(emailAddress);
  const ipKey = clientIp || "unknown-ip";

  try {
    await checkRequestTokenRateLimit(normalizedEmail, ipKey);
  } catch {
    // Always return dispatched: true to prevent email enumeration even on rate-limiting
    return { dispatched: true };
  }

  const user = await getUserByEmail(normalizedEmail);
  if (!user || !user.emailVerifiedAt) {
    return { dispatched: true }; // non-enumerating
  }

  const tokenPayload = await createCredentialToken({
    userId: user.id,
    purpose: "password_reset",
    lifetimeMs: 60 * 60 * 1000, // 1 hour
  });

  const resetUrl = `${getAppBaseUrl()}/reset-password/${tokenPayload.rawToken}`;

  const emailSuppressed = await isSuppressed(normalizedEmail);
  if (!emailSuppressed) {
    try {
      await sendTransactionalEmail({
        to: normalizedEmail,
        templateKey: "password_reset",
        params: {
          resetUrl,
          name: user.name,
        },
        idempotencyKey: `pwd_reset_${user.id}_${tokenPayload.tokenId}`,
      });
    } catch {
      // ignore
    }
  }

  await emitAuditEvent({
    eventType: "PASSWORD_RESET_REQUESTED",
    userId: user.id,
    outcome: "success",
    clientIp,
    userAgent,
  });

  return { dispatched: true };
}

/**
 * complete password reset
 */
export async function completePasswordReset(
  rawToken: string,
  newPassword?: string,
  clientIp?: string,
  userAgent?: string,
): Promise<{ readonly user: IdentityUser; readonly session: IssuedIdentitySession }> {
  if (typeof rawToken !== "string" || rawToken.trim().length === 0 || rawToken.includes("/") || rawToken.includes("..")) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Invalid token format");
  }

  if (newPassword === undefined || typeof newPassword !== "string") {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "New password is required");
  }

  if (!isPasswordStrong(newPassword)) {
    throw new AuthFlowError(AuthFlowErrorCode.PASSWORD_WEAK, "Password does not meet strength requirements");
  }

  let token: IdentityCredentialToken;
  try {
    token = await consumeCredentialToken(rawToken, "password_reset");
  } catch {
    throw new AuthFlowError(
      AuthFlowErrorCode.TOKEN_INVALID,
      "Password reset link is invalid or has expired.",
    );
  }

  const userId = token.userId;
  if (!userId) {
    throw new AuthFlowError(AuthFlowErrorCode.TOKEN_INVALID, "Invalid token user ID");
  }

  const passHash = hashPassword(newPassword);
  await setPasswordHash(userId, passHash);

  // Revoke all existing sessions for the user (security best practice)
  const activeSessions = await prisma.identitySession.findMany({
    where: { userId, revokedAt: null },
  });
  for (const sess of activeSessions) {
    await prisma.identitySession.update({
      where: { id: sess.id },
      data: { revokedAt: new Date().toISOString() },
    });
  }

  const user = await getUserById(userId);
  if (!user) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "User not found");
  }

  // Fresh session
  const ipHash = hashClientIp(clientIp) || undefined;
  const session = await createSession(userId, {
    userAgent: cleanUserAgent(userAgent) || undefined,
    clientIpHash: ipHash,
  });

  await emitAuditEvent({
    eventType: "PASSWORD_RESET_COMPLETED",
    userId,
    workspaceId: session.workspace.id,
    outcome: "success",
    clientIp,
    userAgent,
  });

  return { user, session };
}

/**
 * request magic link sign-in
 */
export async function requestMagicLink(
  emailAddress: string,
  clientIp?: string,
  userAgent?: string,
): Promise<{ readonly dispatched: boolean }> {
  if (typeof emailAddress !== "string" || emailAddress.trim().length === 0) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Email address is required");
  }

  const normalizedEmail = normalizeEmail(emailAddress);
  const ipKey = clientIp || "unknown-ip";

  try {
    await checkRequestTokenRateLimit(normalizedEmail, ipKey);
  } catch {
    return { dispatched: true };
  }

  const user = await getUserByEmail(normalizedEmail);
  if (!user) {
    return { dispatched: true }; // non-enumerating
  }

  const tokenPayload = await createCredentialToken({
    userId: user.id,
    purpose: "magic_link",
    lifetimeMs: 15 * 60 * 1000, // 15 minutes
  });

  const magicLinkUrl = `${getAppBaseUrl()}/magic-link/${tokenPayload.rawToken}`;

  const emailSuppressed = await isSuppressed(normalizedEmail);
  if (!emailSuppressed) {
    try {
      await sendTransactionalEmail({
        to: normalizedEmail,
        templateKey: "magic_link",
        params: {
          magicLinkUrl,
        },
        idempotencyKey: `magic_link_${user.id}_${tokenPayload.tokenId}`,
      });
    } catch {
      // ignore
    }
  }

  await emitAuditEvent({
    eventType: "MAGIC_LINK_REQUESTED",
    userId: user.id,
    outcome: "success",
    clientIp,
    userAgent,
  });

  return { dispatched: true };
}

/**
 * consume magic link
 */
export async function consumeMagicLink(
  rawToken: string,
  clientIp?: string,
  userAgent?: string,
): Promise<{ readonly user: IdentityUser; readonly session: IssuedIdentitySession }> {
  if (typeof rawToken !== "string" || rawToken.trim().length === 0 || rawToken.includes("/") || rawToken.includes("..")) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Invalid token format");
  }

  let token: IdentityCredentialToken;
  try {
    token = await consumeCredentialToken(rawToken, "magic_link");
  } catch {
    throw new AuthFlowError(
      AuthFlowErrorCode.TOKEN_INVALID,
      "Magic link is invalid or has expired.",
    );
  }

  const userId = token.userId;
  if (!userId) {
    throw new AuthFlowError(AuthFlowErrorCode.TOKEN_INVALID, "Invalid token user ID");
  }

  let user = await getUserById(userId);
  if (!user) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "User not found");
  }

  // Magic link acts as email verification
  if (!user.emailVerifiedAt) {
    user = await markEmailVerified(userId);
  }

  // Create session
  const ipHash = hashClientIp(clientIp) || undefined;
  const session = await createSession(userId, {
    userAgent: cleanUserAgent(userAgent) || undefined,
    clientIpHash: ipHash,
  });

  await emitAuditEvent({
    eventType: "MAGIC_LINK_CONSUMED",
    userId,
    workspaceId: session.workspace.id,
    outcome: "success",
    clientIp,
    userAgent,
  });

  return { user, session };
}

/**
 * accept invitation
 */
export async function acceptInvitation(
  rawToken: string,
  signUpInput?: SignUpInput,
  clientIp?: string,
  userAgent?: string,
): Promise<{ readonly user: IdentityUser; readonly workspace: IdentityWorkspace; readonly session: IssuedIdentitySession }> {
  if (typeof rawToken !== "string" || rawToken.trim().length === 0 || rawToken.includes("/") || rawToken.includes("..")) {
    throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Invalid token format");
  }

  // Check details first (without consuming)
  const checkToken = await getCredentialToken(rawToken, "workspace_invitation");
  if (!checkToken) {
    throw new AuthFlowError(
      AuthFlowErrorCode.TOKEN_INVALID,
      "Invitation link is invalid or has expired.",
    );
  }

  const meta = checkToken.metaJson ? (JSON.parse(checkToken.metaJson) as Record<string, unknown>) : {};
  const inviteEmail = String(meta.email || "");
  const workspaceId = String(meta.workspaceId || "");
  const role = (meta.role as "customer_member" | "customer_owner") || "customer_member";

  if (!inviteEmail || !workspaceId) {
    throw new AuthFlowError(AuthFlowErrorCode.TOKEN_INVALID, "Invitation token is corrupted.");
  }

  const existingUser = await getUserByEmail(inviteEmail);
  let user: IdentityUser;

  // Process invitee
  if (existingUser) {
    // If signed up but we didn't get password, we expect invitee is already authenticated
    user = existingUser;
  } else {
    // Brand new user registration via invite
    if (!signUpInput) {
      throw new AuthFlowError(
        AuthFlowErrorCode.BAD_REQUEST,
        "Sign-up details are required for new users accepting an invitation",
      );
    }
    const { password, displayName } = signUpInput;
    if (password === undefined || typeof password !== "string") {
      throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Password is required");
    }
    if (!isPasswordStrong(password)) {
      throw new AuthFlowError(AuthFlowErrorCode.PASSWORD_WEAK, "Password does not meet strength requirements");
    }
    const name = displayName?.trim() || inviteEmail.split("@")[0] || "User";

    // Create user (marked already verified since accepting token proves ownership)
    const passHash = hashPassword(password);
    user = await identityCreateUser({
      email: inviteEmail,
      displayName: name,
      passwordHash: passHash,
    });
    await markEmailVerified(user.id);
  }

  // Consume token atomic transaction
  await consumeCredentialToken(rawToken, "workspace_invitation");

  // Attach user to workspace
  await attachWorkspaceMember(workspaceId, user.id, role);

  const workspace = await prisma.identityWorkspace.findUnique({
    where: { id: workspaceId },
  });
  if (!workspace) {
    throw new AuthFlowError(AuthFlowErrorCode.TOKEN_INVALID, "Workspace no longer exists.");
  }

  // Create session
  const ipHash = hashClientIp(clientIp) || undefined;
  const session = await createSession(user.id, {
    userAgent: cleanUserAgent(userAgent) || undefined,
    clientIpHash: ipHash,
  });

  await emitAuditEvent({
    eventType: "INVITATION_ACCEPTED",
    userId: user.id,
    workspaceId: workspace.id,
    outcome: "success",
    clientIp,
    userAgent,
  });

  return {
    user,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      billingEmail: workspace.billingEmail,
      suspendedAt: workspace.suspendedAt,
      suspendedReason: workspace.suspendedReason,
      suspendedByUserId: workspace.suspendedByUserId,
      deletedAt: workspace.deletedAt,
      deletionReason: workspace.deletionReason,
      purgeAt: workspace.purgeAt,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
    session,
  };
}
