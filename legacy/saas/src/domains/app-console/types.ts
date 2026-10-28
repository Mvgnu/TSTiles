import type { BillingSnapshot } from "../billing-sync/types";
import type {
  ConsoleBootstrap,
  ConsoleProjectDetail,
  ConsoleSettings,
  ConsoleStyleDetail,
  IntegrationSnippets,
  UsageSummaryCard,
  ConsoleNotification,
} from "../customer-console/types";
import type { BillingPlan } from "../metering/types";

export type AppConsolePageSlug =
  | "overview"
  | "projects"
  | "project-new"
  | "project-detail"
  | "project-usage"
  | "styles"
  | "style-detail"
  | "billing"
  | "settings"
  | "settings-members"
  | "settings-security"
  | "settings-security-mfa"
  | "settings-security-password"
  | "settings-account"
  | "settings-account-export"
  | "settings-account-delete"
  | "notifications";

export type AppConsoleBannerTone = "info" | "warning" | "danger" | "success";
export type AppConsoleSnippetMode = "query" | "header";

export interface AppConsoleNavigationItem {
  readonly label: string;
  readonly href: string;
  readonly active: boolean;
}

export interface AppConsoleBanner {
  readonly tone: AppConsoleBannerTone;
  readonly title: string;
  readonly body: string;
  readonly ctaHref?: string;
  readonly ctaLabel?: string;
}

export interface AppConsoleBillingStateSummary {
  readonly tone: AppConsoleBannerTone;
  readonly title: string;
  readonly body: string;
  readonly periodLabel: string;
}

export interface AppConsoleBillingAction {
  readonly label: string;
  readonly endpoint: "/billing/checkout" | "/billing/portal";
  readonly appearance: "primary" | "ghost";
  readonly planId?: string;
  readonly autoOpen: boolean;
}

export interface AppConsoleBillingMirrorState {
  readonly lastWebhookAtLabel: string;
  readonly customerReference: string;
  readonly subscriptionReference: string;
  readonly syncStatusLabel: string;
  readonly syncGuidance: string;
}

export interface AppConsoleStat {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly href?: string;
}

export interface AppConsoleOnboardingStep {
  readonly label: string;
  readonly detail: string;
  readonly status: "complete" | "current" | "blocked";
  readonly href?: string;
}

export interface AppConsoleSnippet {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly queryCode: string;
  readonly headerCode: string;
  readonly preferredMode: AppConsoleSnippetMode;
}

export interface AppConsoleShell {
  readonly currentUser: ConsoleBootstrap["currentUser"] & { readonly mfaEnabledAt?: string | null };
  readonly currentMembership: ConsoleBootstrap["currentMembership"];
  readonly workspace: ConsoleBootstrap["workspace"];
  readonly billing: BillingSnapshot;
  readonly usageMonth: UsageSummaryCard;
  readonly navigation: ReadonlyArray<AppConsoleNavigationItem>;
  readonly statusBanners: ReadonlyArray<AppConsoleBanner>;
}

export interface AppConsoleOverviewPage {
  readonly slug: "overview";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly stats: ReadonlyArray<AppConsoleStat>;
  readonly onboardingSteps: ReadonlyArray<AppConsoleOnboardingStep>;
  readonly snippets: ReadonlyArray<AppConsoleSnippet>;
}

export interface AppConsoleProjectsPage {
  readonly slug: "projects";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
}

export interface AppConsoleProjectNewPage {
  readonly slug: "project-new";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly seedSnippets: ReadonlyArray<AppConsoleSnippet>;
}

export interface AppConsoleProjectDetailPage {
  readonly slug: "project-detail";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly detail: ConsoleProjectDetail;
  readonly snippets: ReadonlyArray<AppConsoleSnippet>;
}

export interface AppConsoleProjectUsagePage {
  readonly slug: "project-usage";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly detail: ConsoleProjectDetail;
  readonly usage: UsageSummaryCard;
  readonly window: "day" | "month";
}

export interface AppConsoleStylesPage {
  readonly slug: "styles";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
}

export interface AppConsoleStyleDetailPage {
  readonly slug: "style-detail";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly detail: ConsoleStyleDetail;
  readonly snippets: ReadonlyArray<AppConsoleSnippet>;
}

export interface AppConsoleBillingPage {
  readonly slug: "billing";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly plan: BillingPlan;
  readonly stateSummary: AppConsoleBillingStateSummary;
  readonly mirrorState: AppConsoleBillingMirrorState;
  readonly primaryAction: AppConsoleBillingAction;
  readonly checkoutIntentPlanId?: string;
  readonly checkoutStatus?: "success" | "cancel";
}

export interface AppConsoleSettingsPage {
  readonly slug: "settings";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly settings: ConsoleSettings;
}

export interface AppConsoleSettingsMembersPage {
  readonly slug: "settings-members";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly settings: ConsoleSettings;
}

export interface AppConsoleSettingsSecurityPage {
  readonly slug: "settings-security";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly settings: ConsoleSettings;
  readonly activeSessions: ReadonlyArray<{
    readonly tokenHash: string;
    readonly userAgent?: string | null;
    readonly createdAt: string;
    readonly lastSeenAt: string;
  }>;
}

export interface AppConsoleSettingsSecurityMfaPage {
  readonly slug: "settings-security-mfa";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly settings: ConsoleSettings;
  readonly mfaEnrollment?: {
    readonly secret: string;
    readonly recoveryCodes: ReadonlyArray<string>;
  };
}

export interface AppConsoleSettingsSecurityPasswordPage {
  readonly slug: "settings-security-password";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly settings: ConsoleSettings;
}

export interface AppConsoleSettingsAccountPage {
  readonly slug: "settings-account";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly settings: ConsoleSettings;
}

export interface AppConsoleSettingsAccountExportPage {
  readonly slug: "settings-account-export";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly settings: ConsoleSettings;
}

export interface AppConsoleSettingsAccountDeletePage {
  readonly slug: "settings-account-delete";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly settings: ConsoleSettings;
}

export interface AppConsoleNotificationsPage {
  readonly slug: "notifications";
  readonly title: string;
  readonly description: string;
  readonly shell: AppConsoleShell;
  readonly bootstrap: ConsoleBootstrap;
  readonly notifications: ReadonlyArray<ConsoleNotification>;
}

export type AppConsolePage =
  | AppConsoleOverviewPage
  | AppConsoleProjectsPage
  | AppConsoleProjectNewPage
  | AppConsoleProjectDetailPage
  | AppConsoleProjectUsagePage
  | AppConsoleStylesPage
  | AppConsoleStyleDetailPage
  | AppConsoleBillingPage
  | AppConsoleSettingsPage
  | AppConsoleSettingsMembersPage
  | AppConsoleSettingsSecurityPage
  | AppConsoleSettingsSecurityMfaPage
  | AppConsoleSettingsSecurityPasswordPage
  | AppConsoleSettingsAccountPage
  | AppConsoleSettingsAccountExportPage
  | AppConsoleSettingsAccountDeletePage
  | AppConsoleNotificationsPage;

export interface AppConsoleProjectPathInput {
  readonly projectId: string;
}

export interface AppConsoleProjectUsagePathInput extends AppConsoleProjectPathInput {
  readonly window: "day" | "month";
}

export interface AppConsoleStylePathInput {
  readonly styleId: string;
}

export interface AppConsoleRenderedSnippetsInput {
  readonly snippets: IntegrationSnippets;
  readonly prefix: string;
}
