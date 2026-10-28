import type { Project } from "../projects/types";
import type { StyleListItem } from "../styles/types";
import type {
  AuditEvent,
  ArtifactSummary,
  HealthStatus,
  JobMetadata,
} from "../control-plane/types";

export const enum AdminConsoleErrorCode {
  BAD_REQUEST = "ADMIN_BAD_REQUEST",
  NOT_OPERATOR = "ADMIN_NOT_OPERATOR",
  UNAUTHORIZED = "ADMIN_UNAUTHORIZED",
  MFA_REQUIRED = "ADMIN_MFA_REQUIRED",
  LOCKED_OUT = "ADMIN_LOCKED_OUT",
  CONFIRM_REQUIRED = "ADMIN_CONFIRM_REQUIRED",
  DEPENDENCY_FAILED = "ADMIN_DEPENDENCY_FAILED",
}

export class AdminConsoleError extends Error {
  public readonly code: AdminConsoleErrorCode;
  public readonly details: string;

  public constructor(code: AdminConsoleErrorCode, details: string) {
    super(`${code}:${details}`);
    this.code = code;
    this.details = details;
    this.name = "AdminConsoleError";
  }
}

export type AdminConsolePageSlug =
  | "overview"
  | "artifacts"
  | "ingest"
  | "styles"
  | "projects"
  | "project-detail"
  | "audit"
  | "jobs"
  | "abuse"
  | "operators";

export interface AdminConsoleNavigationItem {
  readonly label: string;
  readonly href: string;
  readonly active: boolean;
}

export interface AdminConsoleShell {
  readonly currentUser: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  };
  readonly navigation: ReadonlyArray<AdminConsoleNavigationItem>;
  readonly health: HealthStatus;
}

export interface AdminConsoleOverviewPage {
  readonly slug: "overview";
  readonly title: string;
  readonly description: string;
  readonly shell: AdminConsoleShell;
  readonly counts: {
    readonly artifacts: number;
    readonly projects: number;
    readonly activeJobs: number;
    readonly recentAuditEvents: number;
  };
}

export interface AdminConsoleArtifactsPage {
  readonly slug: "artifacts";
  readonly title: string;
  readonly description: string;
  readonly shell: AdminConsoleShell;
  readonly artifacts: ReadonlyArray<ArtifactSummary>;
  readonly activeVersionId?: string | null;
}

export interface AdminConsoleIngestPage {
  readonly slug: "ingest";
  readonly title: string;
  readonly description: string;
  readonly shell: AdminConsoleShell;
  readonly recentJobs: ReadonlyArray<JobMetadata>;
}

export interface AdminConsoleStylesPage {
  readonly slug: "styles";
  readonly title: string;
  readonly description: string;
  readonly shell: AdminConsoleShell;
  readonly styles: ReadonlyArray<StyleListItem>;
}

export interface AdminConsoleProjectsPage {
  readonly slug: "projects";
  readonly title: string;
  readonly description: string;
  readonly shell: AdminConsoleShell;
  readonly projects: ReadonlyArray<Project>;
}

export interface AdminConsoleProjectDetailPage {
  readonly slug: "project-detail";
  readonly title: string;
  readonly description: string;
  readonly shell: AdminConsoleShell;
  readonly project: Project;
  readonly keys: ReadonlyArray<{
    readonly id: string;
    readonly tokenHash: string;
    readonly label: string;
    readonly createdAt: string;
  }>;
  readonly usage: {
    readonly tiles: number;
    readonly raster: number;
    readonly static: number;
  };
  readonly workspaceOwner?: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  } | null;
  readonly showOwnerPii?: boolean;
}

export interface AdminConsoleAuditPage {
  readonly slug: "audit";
  readonly title: string;
  readonly description: string;
  readonly shell: AdminConsoleShell;
  readonly events: ReadonlyArray<AuditEvent>;
  readonly filters: {
    readonly eventType?: string;
    readonly actor?: string;
    readonly outcome?: string;
  };
}

export interface AdminConsoleJobsPage {
  readonly slug: "jobs";
  readonly title: string;
  readonly description: string;
  readonly shell: AdminConsoleShell;
  readonly jobs: ReadonlyArray<JobMetadata>;
  readonly filters: {
    readonly status?: string;
    readonly actor?: string;
  };
}

export interface AdminConsoleAbusePage {
  readonly slug: "abuse";
  readonly title: string;
  readonly description: string;
  readonly shell: AdminConsoleShell;
  readonly suspendedWorkspaces: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly suspendedAt: string;
    readonly suspendedReason?: string | null;
    readonly ownerEmail?: string | null;
  }>;
}

export interface AdminConsoleOperatorsPage {
  readonly slug: "operators";
  readonly title: string;
  readonly description: string;
  readonly shell: AdminConsoleShell;
  readonly operators: ReadonlyArray<{
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly mfaEnabled: boolean;
    readonly roleOperatorGrantedAt?: string | null;
  }>;
}

export type AdminConsolePage =
  | AdminConsoleOverviewPage
  | AdminConsoleArtifactsPage
  | AdminConsoleIngestPage
  | AdminConsoleStylesPage
  | AdminConsoleProjectsPage
  | AdminConsoleProjectDetailPage
  | AdminConsoleAuditPage
  | AdminConsoleJobsPage
  | AdminConsoleAbusePage
  | AdminConsoleOperatorsPage;

export interface AdminConsoleSignInPage {
  readonly title: string;
  readonly error?: string;
}

export interface AdminConsoleRouteRequest {
  readonly method: "GET" | "POST" | "HEAD" | "OPTIONS";
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: Record<string, unknown> | string;
}

export interface AdminConsoleRouteResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}
