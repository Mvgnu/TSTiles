import type { DenyReason, HttpMethod } from "../../contracts/types";
export type { DenyReason, HttpMethod };
export type { AuthorizeContext } from "../../contracts/types";

export interface AuthorizeResult {
  readonly allow: boolean;
  readonly denyReason?: DenyReason;
  readonly sanitizedIdentity?: string;
  readonly allowedOrigins?: readonly string[];
  readonly rateLimitRemaining?: number;
}
