
export const enum AuthFlowErrorCode {
  BAD_REQUEST = "AUTH_BAD_REQUEST",
  PASSWORD_WEAK = "AUTH_PASSWORD_WEAK",
  EMAIL_INVALID = "AUTH_EMAIL_INVALID",
  EMAIL_UNVERIFIED = "AUTH_EMAIL_UNVERIFIED",
  INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS",
  TOKEN_INVALID = "AUTH_TOKEN_INVALID",
  LOCKED_OUT = "AUTH_LOCKED_OUT",
  MFA_REQUIRED = "AUTH_MFA_REQUIRED",
  MFA_FAILED = "AUTH_MFA_FAILED",
  PROVIDER_BRIDGE_ACTIVE = "AUTH_PROVIDER_BRIDGE_ACTIVE",
  NOT_FOUND = "AUTH_NOT_FOUND",
}

export class AuthFlowError extends Error {
  public readonly code: AuthFlowErrorCode;
  public readonly details?: string;

  public constructor(code: AuthFlowErrorCode, message: string, details?: string) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "AuthFlowError";
  }
}

export interface SignUpInput {
  readonly email: string;
  readonly password?: string;
  readonly displayName?: string;
}

export interface SignInInput {
  readonly email: string;
  readonly password?: string;
  readonly userAgent?: string;
  readonly clientIp?: string;
}

export interface PasswordResetRequestInput {
  readonly email: string;
}

export interface PasswordResetCompleteInput {
  readonly token: string;
  readonly password?: string;
}

export interface MagicLinkRequestInput {
  readonly email: string;
}

export interface InvitationAcceptInput {
  readonly token: string;
  readonly password?: string;
  readonly displayName?: string;
}

export interface AuthFlowsRouteInput {
  readonly method: "GET" | "POST" | "HEAD" | "OPTIONS";
  readonly path: string;
  readonly query?: Readonly<Record<string, string | string[] | undefined>>;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

export interface AuthFlowsRouteResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}

export type AuthFlowsPage =
  | "sign-up"
  | "sign-in"
  | "verify-email"
  | "forgot-password"
  | "reset-password"
  | "magic-link-request"
  | "accept-invite"
  | "mfa-challenge";
