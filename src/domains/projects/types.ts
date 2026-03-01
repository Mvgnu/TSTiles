export interface AllowedEndpointPolicy {
  readonly tiles: boolean;
  readonly raster: boolean;
  readonly staticMaps: boolean;
}

export const enum ProjectsErrorCode {
  KEY_INVALID = "PROJECTS_KEY_INVALID",
  KEY_REVOKED = "PROJECTS_KEY_REVOKED",
  PROJECT_NOT_FOUND = "PROJECTS_PROJECT_NOT_FOUND",
  POLICY_INVALID = "PROJECTS_POLICY_INVALID",
}

export class ProjectsError extends Error {
  public readonly code: ProjectsErrorCode;
  public readonly details: string;

  public constructor(code: ProjectsErrorCode, details: string) {
    super(`${code}:${details}`);
    this.code = code;
    this.details = details;
    this.name = "ProjectsError";
  }
}

export interface ProjectQuotaPolicy {
  readonly dailyRequests?: number;
  readonly monthlyRequests?: number;
  readonly minuteRequests?: number;
}

export interface ProjectCachePolicy {
  readonly tileTtlSeconds?: number;
  readonly metadataTtlSeconds?: number;
}

export interface ProjectPolicy {
  readonly allowedOrigins?: readonly string[];
  readonly allowedEndpoints: AllowedEndpointPolicy;
  readonly quotas?: ProjectQuotaPolicy;
  readonly cache?: ProjectCachePolicy;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly policy: ProjectPolicy;
  readonly planId: string;
  readonly createdAt: string;
}

export interface ApiKeyRecord {
  readonly projectId: string;
  readonly keyId: string;
  readonly keyHash: string;
  readonly keyIdHash: string;
  readonly createdAt: string;
  readonly revoked: boolean;
}

export interface IssuedApiKey extends ApiKeyRecord {
  readonly token: string;
}

export interface ProjectIdentity {
  readonly projectId: string;
  readonly keyId: string;
  readonly keyHash: string;
  readonly keyIdHash: string;
  readonly planId: string;
}

export interface ProjectCreationInput {
  readonly name: string;
  readonly policy?: Partial<ProjectPolicy>;
  readonly planId?: string;
}
