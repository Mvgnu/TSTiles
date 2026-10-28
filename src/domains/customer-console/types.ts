import type { BillingSnapshot } from "../billing-sync/types";
import type { BillingPlan, UsageCounterWindow } from "../metering/types";
import type { IdentityRole } from "../identity/types";
import type { AllowedEndpointPolicy, ApiKeyRecord, IssuedApiKey } from "../projects/types";

export const enum CustomerConsoleErrorCode {
  BAD_REQUEST = "CUSTOMER_CONSOLE_BAD_REQUEST",
  NOT_FOUND = "CUSTOMER_CONSOLE_NOT_FOUND",
  DEPENDENCY_FAILED = "CUSTOMER_CONSOLE_DEPENDENCY_FAILED",
}

export class CustomerConsoleError extends Error {
  public readonly code: CustomerConsoleErrorCode;
  public readonly details: string;

  public constructor(code: CustomerConsoleErrorCode, details: string) {
    super(`${code}:${details}`);
    this.code = code;
    this.details = details;
    this.name = "CustomerConsoleError";
  }
}

export interface ConsoleWorkspace {
  readonly id: string;
  readonly name: string;
}

export interface ConsoleCurrentUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface ConsoleMembership {
  readonly userId: string;
  readonly role: IdentityRole;
}

export interface UsageBreakdown {
  readonly tiles: number;
  readonly raster: number;
  readonly static: number;
}

export interface UsageSummaryCard {
  readonly window: UsageCounterWindow;
  readonly requestCount: number;
  readonly includedRequests: number;
  readonly percentOfIncludedRequests: number;
  readonly plan: BillingPlan;
  readonly breakdown: UsageBreakdown;
}

export interface IntegrationSnippets {
  readonly styleUrl?: string;
  readonly rasterTileUrl?: string;
  readonly staticMapUrl?: string;
}

export interface ConsoleFirstIntegration {
  readonly readiness: "needs_project" | "needs_style" | "ready";
  readonly quickstartHref: string;
  readonly projectCreateHref: string;
  readonly snippets: IntegrationSnippets;
}

export interface ConsoleProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly planId: string;
  readonly allowedOrigins: readonly string[];
  readonly allowedEndpoints: AllowedEndpointPolicy;
  readonly lastKeyRotationAt?: string;
  readonly latestDayUsage: UsageSummaryCard;
  readonly latestMonthUsage: UsageSummaryCard;
}

export interface ConsoleProjectDetail {
  readonly project: ConsoleProjectSummary;
  readonly keys: ReadonlyArray<ApiKeyRecord>;
  readonly snippets: IntegrationSnippets;
}

export interface ConsoleStyleSummary {
  readonly id: string;
  readonly name: string;
  readonly publishedVersionId?: string;
  readonly styleUrl: string;
  readonly rasterTileUrl: string;
  readonly staticMapUrl: string;
}

export interface ConsoleStyleDetail {
  readonly style: ConsoleStyleSummary;
  readonly snippets: IntegrationSnippets;
}

export type ConsoleProjectUsageWindow = "day" | "month";

export interface ConsoleBootstrap {
  readonly currentUser: ConsoleCurrentUser;
  readonly currentMembership: ConsoleMembership;
  readonly workspace: ConsoleWorkspace;
  readonly billing: BillingSnapshot;
  readonly usageMonth: UsageSummaryCard;
  readonly projects: ReadonlyArray<ConsoleProjectSummary>;
  readonly styles: ReadonlyArray<ConsoleStyleSummary>;
  readonly firstIntegration: ConsoleFirstIntegration;
  readonly onboarding: {
    readonly hasProjects: boolean;
    readonly hasPublishedStyles: boolean;
    readonly needsProjectSetup: boolean;
  };
}

export interface ConsoleSettings {
  readonly currentUser: ConsoleCurrentUser;
  readonly workspace: ConsoleWorkspace;
  readonly billingEmail?: string;
  readonly memberships: ReadonlyArray<ConsoleMembership>;
}

export interface ConsoleProjectCreateInput {
  readonly name: string;
  readonly allowedOrigins?: readonly string[];
  readonly allowedEndpoints?: Partial<AllowedEndpointPolicy>;
}

export interface ConsoleProjectUpdateInput {
  readonly name?: string;
  readonly allowedOrigins?: readonly string[];
  readonly allowedEndpoints?: Partial<AllowedEndpointPolicy>;
}

export interface ConsoleProjectProvisionResult {
  readonly project: ConsoleProjectSummary;
  readonly issuedKey: IssuedApiKey;
  readonly snippets: IntegrationSnippets;
}

export interface ConsoleSettingsUpdateInput {
  readonly workspaceName: string;
}

export interface ConsoleNotification {
  readonly id: string;
  readonly type: "info" | "warn" | "danger";
  readonly title: string;
  readonly message: string;
  readonly actionHref?: string;
  readonly recordedAt: string;
}

