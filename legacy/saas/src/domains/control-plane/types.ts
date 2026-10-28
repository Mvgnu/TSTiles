export type ControlPlaneOperation =
  | "ingest"
  | "list_artifacts"
  | "promote_artifact"
  | "rollback_artifact"
  | "create_project"
  | "rotate_api_key"
  | "get_project_usage"
  | "create_style_version"
  | "publish_style_version";

export type ControlPlaneOutcome = "ok" | "failed";

export const enum ControlPlaneErrorCode {
  BAD_REQUEST = "CONTROL_PLANE_BAD_REQUEST",
  UNAUTHORIZED = "CONTROL_PLANE_UNAUTHORIZED",
  FORBIDDEN = "CONTROL_PLANE_FORBIDDEN",
  CONFLICT = "CONTROL_PLANE_CONFLICT",
  DEPENDENCY_FAILED = "CONTROL_PLANE_DEPENDENCY_FAILED",
}

export class ControlPlaneError extends Error {
  public readonly code: ControlPlaneErrorCode;
  public readonly details: string;

  public constructor(code: ControlPlaneErrorCode, details: string) {
    super(details);
    this.code = code;
    this.details = details;
    this.name = "ControlPlaneError";
  }
}

export interface ArtifactSummary {
  readonly id: string;
  readonly key: string;
  readonly checksum: string;
  readonly byteSize: number;
  readonly createdAt: string;
  readonly validated: boolean;
}

export interface JobReference {
  readonly jobId: string;
  readonly status: "queued" | "started" | "finished" | "failed";
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly actor?: string;
}

export interface JobMetadata extends JobReference {
  readonly snapshotId?: string;
  readonly outcome?: ControlPlaneOutcome;
}

export interface AuditEvent {
  readonly id: string;
  readonly actor: string;
  readonly operation: ControlPlaneOperation;
  readonly outcome: ControlPlaneOutcome;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly message?: string;
}

export interface HealthStatus {
  readonly ok: boolean;
  readonly storageReachable: boolean;
  readonly configVersion: string;
  readonly auditEventsInWindow: number;
}
