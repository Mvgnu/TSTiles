export type IdentityRole = "customer_member" | "customer_owner" | "operator" | "owner" | "member";

export const enum IdentityErrorCode {
  BAD_REQUEST = "IDENTITY_BAD_REQUEST",
  UNAUTHORIZED = "IDENTITY_UNAUTHORIZED",
  NOT_FOUND = "IDENTITY_NOT_FOUND",
  TOKEN_INVALID = "IDENTITY_TOKEN_INVALID",
  TOKEN_EXPIRED = "IDENTITY_TOKEN_EXPIRED",
  WRONG_SURFACE = "IDENTITY_WRONG_SURFACE",
  OPERATOR_MFA_REQUIRED = "IDENTITY_OPERATOR_MFA_REQUIRED",
  OWNERSHIP_REQUIRED = "IDENTITY_OWNERSHIP_REQUIRED",
  LAST_OWNER_BLOCKED = "IDENTITY_LAST_OWNER_BLOCKED",
  OPERATOR_SELF_REVOKE = "IDENTITY_OPERATOR_SELF_REVOKE"
}

export class IdentityError extends Error {
  public readonly code: IdentityErrorCode;
  public readonly details: string;

  public constructor(code: IdentityErrorCode, details: string) {
    super(`${code}:${details}`);
    this.code = code;
    this.details = details;
    this.name = "IdentityError";
  }
}

export interface IdentityUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly passwordHash?: string | null;
  readonly emailVerifiedAt?: string | null;
  readonly mfaSecretEncrypted?: string | null;
  readonly mfaEnabledAt?: string | null;
  readonly mfaRecoveryCodesHashedJson?: string | null;
  readonly roleOperatorGrantedAt?: string | null;
  readonly roleOperatorGrantedByUserId?: string | null;
  readonly roleOperatorRevokedAt?: string | null;
  readonly deletedAt?: string | null;
  readonly deletionReason?: string | null;
  readonly purgeAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export interface IdentityWorkspace {
  readonly id: string;
  readonly name: string;
  readonly billingEmail?: string | null;
  readonly suspendedAt?: string | null;
  readonly suspendedReason?: string | null;
  readonly suspendedByUserId?: string | null;
  readonly deletedAt?: string | null;
  readonly deletionReason?: string | null;
  readonly purgeAt?: string | null;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export interface IdentityMembership {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: IdentityRole;
  readonly createdAt: string;
}

export interface IdentitySession {
  readonly id: string;
  readonly tokenHash: string;
  readonly user: IdentityUser;
  readonly workspace: IdentityWorkspace;
  readonly membership: IdentityMembership;
  readonly sessionKind?: "app" | "ops";
  readonly userAgent?: string | null;
  readonly clientIpHash?: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string | null;
}

/** A session plus the one-time bearer value returned by an issuance call. */
export interface IssuedIdentitySession extends IdentitySession {
  readonly token: string;
}

export type CredentialTokenPurpose = "email_verification" | "password_reset" | "magic_link" | "workspace_invitation";

export interface IdentityCredentialToken {
  readonly id: string;
  readonly tokenHash: string;
  readonly userId?: string | null;
  readonly purpose: CredentialTokenPurpose;
  readonly metaJson?: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt?: string | null;
}

export interface IdentityAuthEvent {
  readonly id: string;
  readonly eventType: string;
  readonly userId?: string | null;
  readonly workspaceId?: string | null;
  readonly actorRole?: string | null;
  readonly clientIpHash?: string | null;
  readonly userAgent?: string | null;
  readonly outcome: "success" | "failure" | "rate_limited";
  readonly reason?: string | null;
  readonly recordedAt: string;
}

export interface IdentityAuthLockout {
  readonly id: string;
  readonly key: string;
  readonly keyKind: "email" | "ip";
  readonly failureCount: number;
  readonly windowStart: string;
  readonly lockedUntil?: string | null;
}

export interface DemoSignInInput {
  readonly userId?: string;
  readonly email?: string;
  readonly name?: string;
  readonly workspaceId?: string;
  readonly workspaceName?: string;
  readonly role?: IdentityRole;
}

export interface CreateUserInput {
  readonly email: string;
  readonly displayName?: string;
  readonly passwordHash?: string;
}

export interface WorkspaceUpdateInput {
  readonly name?: string;
  readonly billingEmail?: string;
}
