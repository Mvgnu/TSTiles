export const CONTRACT_SCHEMA_VERSION = 1 as const;

export const enum ContractErrorCode {
  SCHEMA_INVALID = "CONTRACT_SCHEMA_INVALID",
  VERSION_UNSUPPORTED = "CONTRACT_VERSION_UNSUPPORTED",
}

export class ContractError extends Error {
  public readonly code: ContractErrorCode;
  public readonly details: string;

  public constructor(code: ContractErrorCode, details: string) {
    super(details);
    this.code = code;
    this.details = details;
    this.name = "ContractError";
  }
}

export type HttpMethod = "GET" | "HEAD" | "OPTIONS";

export type TileStatusReason =
  | "TILE_BAD_COORDINATES"
  | "TILE_NOT_FOUND"
  | "TILE_ARTIFACT_UNAVAILABLE"
  | "TILE_ORIGIN_READ_FAILED";

export type DenyReason =
  | "ACCESS_UNAUTHORIZED"
  | "ACCESS_ORIGIN_DENIED"
  | "ACCESS_RATE_LIMITED"
  | "ACCESS_QUOTA_EXCEEDED"
  | "ACCESS_BAD_REQUEST";

export interface TileCoordinates {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export interface AuthorizeContext {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query: Readonly<Record<string, string | string[] | undefined>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly clientIp?: string;
  readonly rawToken?: string;
}

export interface AuthorizeResult {
  readonly allow: boolean;
  readonly denyReason?: DenyReason;
  readonly sanitizedIdentity?: string;
  readonly reasonMessage?: string;
  readonly rateLimitRemaining?: number;
}

export interface DeliverySignal {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly artifactVersion: string;
  readonly tilePath: string;
  readonly cacheStatus: "hit" | "miss";
  readonly originRead: boolean;
  readonly responseBytes: number;
  readonly latencyMs: number;
  readonly statusCode: number;
  readonly receivedAt: string;
  readonly normalizedMethod: HttpMethod;
}

export interface ArtifactEvent {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly eventType:
    | "artifact.registered"
    | "artifact.promoted"
    | "artifact.rolled_back";
  readonly versionId: string;
  readonly key: string;
  readonly activeVersionId?: string | null;
  readonly actor?: string;
  readonly errorMessage?: string;
  readonly timestamp: string;
}

export interface IngestEvent {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly eventType: "ingest.completed";
  readonly snapshotId: string;
  readonly artifactVersion: string;
  readonly artifactKey: string;
  readonly checksum: string;
  readonly byteSize: number;
  readonly validated: boolean;
  readonly timestamp: string;
}
