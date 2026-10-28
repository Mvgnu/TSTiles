import { getConsoleBootstrap, getConsoleProject, getConsoleProjectUsage, getConsoleSettings, getConsoleStyle, listConsoleNotifications } from "../customer-console/customer-console.service";
import { prisma } from "../../config/db";
import type { ConsoleBootstrap, ConsoleFirstIntegration, IntegrationSnippets } from "../customer-console/types";
import type { BillingSnapshot } from "../billing-sync/types";
import { getBillingPlan } from "../metering/metering.service";
import type { IdentitySession } from "../identity/types";
import type {
  AppConsoleBillingAction,
  AppConsoleBillingMirrorState,
  AppConsoleBanner,
  AppConsoleBillingStateSummary,
  AppConsoleNavigationItem,
  AppConsoleOnboardingStep,
  AppConsolePage,
  AppConsoleProjectDetailPage,
  AppConsoleProjectNewPage,
  AppConsoleProjectPathInput,
  AppConsoleProjectUsagePage,
  AppConsoleProjectUsagePathInput,
  AppConsoleRenderedSnippetsInput,
  AppConsoleSettingsPage,
  AppConsoleSettingsMembersPage,
  AppConsoleSettingsSecurityPage,
  AppConsoleSettingsSecurityMfaPage,
  AppConsoleSettingsSecurityPasswordPage,
  AppConsoleSettingsAccountPage,
  AppConsoleSettingsAccountExportPage,
  AppConsoleSettingsAccountDeletePage,
  AppConsoleNotificationsPage,
  AppConsoleShell,
  AppConsoleSnippet,
  AppConsoleStyleDetailPage,
  AppConsoleStylePathInput,
  AppConsoleStylesPage,
  AppConsolePageSlug,
  AppConsoleBillingPage,
  AppConsoleOverviewPage,
  AppConsoleProjectsPage,
  AppConsoleStat,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSessionIdentifier(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized === "."
    || normalized.includes("/")
    || normalized.includes("\\")
    || normalized.includes("..")
  ) {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  return normalized;
}

function isIdentitySessionRecord(value: unknown): value is IdentitySession {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.createdAt !== "string"
    || typeof value.lastSeenAt !== "string"
    || !isRecord(value.user)
    || !isRecord(value.workspace)
    || !isRecord(value.membership)
  ) {
    return false;
  }
  return (
    typeof value.user.id === "string"
    && typeof value.user.email === "string"
    && typeof value.user.name === "string"
    && typeof value.user.createdAt === "string"
    && typeof value.workspace.id === "string"
    && typeof value.workspace.name === "string"
    && typeof value.workspace.createdAt === "string"
    && typeof value.membership.workspaceId === "string"
    && typeof value.membership.userId === "string"
    && (value.membership.role === "owner" || value.membership.role === "member")
    && typeof value.membership.createdAt === "string"
  );
}

function normalizeAppConsoleSession(session: unknown): IdentitySession {
  if (!isIdentitySessionRecord(session)) {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  const userId = normalizeSessionIdentifier(session.user.id);
  const workspaceId = normalizeSessionIdentifier(session.workspace.id);
  const membershipUserId = normalizeSessionIdentifier(session.membership.userId);
  const membershipWorkspaceId = normalizeSessionIdentifier(session.membership.workspaceId);
  if (membershipUserId !== userId || membershipWorkspaceId !== workspaceId) {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  return {
    ...session,
    user: {
      ...session.user,
      id: userId,
    },
    workspace: {
      ...session.workspace,
      id: workspaceId,
    },
    membership: {
      ...session.membership,
      userId: membershipUserId,
      workspaceId: membershipWorkspaceId,
    },
  };
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "Pending webhook confirmation";
  }
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "Awaiting first Stripe webhook";
  }
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sentenceCaseStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function buildNavigation(active: AppConsolePageSlug): AppConsoleNavigationItem[] {
  return [
    { label: "Overview", href: "/app", active: active === "overview" },
    { label: "Projects", href: "/app/projects", active: active === "projects" || active === "project-new" || active === "project-detail" || active === "project-usage" },
    { label: "Styles", href: "/app/styles", active: active === "styles" || active === "style-detail" },
    { label: "Billing", href: "/app/billing", active: active === "billing" },
    { label: "Settings", href: "/app/settings", active: active.startsWith("settings") },
    { label: "Notifications", href: "/app/notifications", active: active === "notifications" },
  ];
}

function buildStatusBanners(bootstrap: ConsoleBootstrap): AppConsoleBanner[] {
  const banners: AppConsoleBanner[] = [];
  const { billing, usageMonth } = bootstrap;
  if (billing.subscriptionStatus === "past_due") {
    banners.push({
      tone: "danger",
      title: "Payment required",
      body: "Stripe reports an overdue invoice. Update the payment method in Stripe before map delivery is interrupted.",
      ctaHref: "/app/billing",
      ctaLabel: "Review billing",
    });
  }
  if (billing.cancelAtPeriodEnd) {
    banners.push({
      tone: "warning",
      title: "Cancellation scheduled",
      body: `The paid plan remains active until ${formatDate(billing.currentPeriodEnd)}. After that date, the workspace returns to the free plan.`,
      ctaHref: "/app/billing",
      ctaLabel: "Review billing",
    });
  }
  if (usageMonth.percentOfIncludedRequests >= 80) {
    banners.push({
      tone: billing.planId === "free" ? "warning" : "info",
      title: "Monthly usage is nearing the included limit",
      body: `${Math.round(usageMonth.percentOfIncludedRequests)}% of included monthly requests have been used.`,
      ctaHref: billing.planId === "free" ? "/app/billing" : "/app/projects",
      ctaLabel: billing.planId === "free" ? "Review plans" : "Review project usage",
    });
  }
  if (bootstrap.onboarding.needsProjectSetup) {
    banners.push({
      tone: "info",
      title: "Create your first project",
      body: "Create a project to issue an access token, choose allowed origins, and make the first tile request.",
      ctaHref: "/app/projects/new",
      ctaLabel: "Create project",
    });
  }
  return banners;
}

function buildShell(session: IdentitySession, active: AppConsolePageSlug, bootstrap: ConsoleBootstrap): AppConsoleShell {
  return {
    currentUser: {
      ...bootstrap.currentUser,
      mfaEnabledAt: session.user.mfaEnabledAt ?? null,
    },
    currentMembership: bootstrap.currentMembership,
    workspace: bootstrap.workspace,
    billing: bootstrap.billing,
    usageMonth: bootstrap.usageMonth,
    navigation: buildNavigation(active),
    statusBanners: buildStatusBanners(bootstrap),
  };
}

const appConsolePageSlugs = new Set<AppConsolePageSlug>([
  "overview",
  "projects",
  "project-new",
  "project-detail",
  "project-usage",
  "styles",
  "style-detail",
  "billing",
  "settings",
  "settings-members",
  "settings-security",
  "settings-security-mfa",
  "settings-security-password",
  "settings-account",
  "settings-account-export",
  "settings-account-delete",
  "notifications",
]);

function normalizeAppConsolePageSlug(value: unknown): AppConsolePageSlug {
  if (typeof value !== "string") {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  const normalized = value.trim();
  if (!appConsolePageSlugs.has(normalized as AppConsolePageSlug)) {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  return normalized as AppConsolePageSlug;
}

function isAppConsolePageInput(
  value: unknown,
): value is Parameters<typeof getAppConsolePage>[1] {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "slug" in value;
}

function isBillingIntentInput(
  value: unknown,
): value is Parameters<typeof getAppBillingPageWithIntent>[1] {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCheckoutPlanId(planId: unknown): string {
  if (planId === undefined) {
    return "pro";
  }
  if (typeof planId !== "string") {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  const normalized = planId.trim().toLowerCase();
  if (normalized.length === 0) {
    return "pro";
  }
  const resolvedPlan = getBillingPlan(normalized).planId;
  if (resolvedPlan !== normalized || resolvedPlan === "free") {
    return "pro";
  }
  return resolvedPlan;
}

function normalizeCheckoutIntentPlanId(planId: unknown): string | undefined {
  if (planId === undefined) {
    return undefined;
  }
  if (typeof planId !== "string") {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  const normalized = planId.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }
  const resolvedPlan = getBillingPlan(normalized).planId;
  if (resolvedPlan !== normalized || resolvedPlan === "free") {
    return undefined;
  }
  return resolvedPlan;
}

function normalizeCheckoutStatus(value: unknown): "success" | "cancel" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "success" || normalized === "cancel") {
    return normalized;
  }
  throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
}

function buildBillingStateSummary(billing: BillingSnapshot): AppConsoleBillingStateSummary {
  if (billing.cancelAtPeriodEnd) {
    return {
      tone: "warning",
      title: "Cancellation scheduled",
      body: `The workspace remains on ${billing.planId} until ${formatDate(billing.currentPeriodEnd)}. Use Stripe before period end to keep the paid plan active.`,
      periodLabel: "Scheduled period end",
    };
  }
  switch (billing.subscriptionStatus) {
    case "past_due":
      return {
        tone: "danger",
        title: "Payment method needs attention",
        body: "Stripe could not collect the latest invoice. Open the billing portal to update payment details before service is interrupted.",
        periodLabel: "Current period end",
      };
    case "unpaid":
      return {
        tone: "danger",
        title: "Subscription is unpaid",
        body: "Stripe marked the subscription as unpaid. Reopen the billing portal to resolve payment details before starting a new checkout.",
        periodLabel: "Current period end",
      };
    case "canceled":
      return {
        tone: "warning",
        title: "No active paid subscription",
        body: "Stripe confirmed cancellation for this workspace. Start a new hosted checkout when you need paid capacity again.",
        periodLabel: "Last period end",
      };
    case "checkout_pending":
      return {
        tone: "info",
        title: "Checkout awaiting confirmation",
        body: "Stripe checkout has started. The mirrored plan will update here after webhook confirmation arrives.",
        periodLabel: "Pending period end",
      };
    case "trialing":
      return {
        tone: "info",
        title: "Trial active",
        body: "This workspace is on a trial. Add a payment method in Stripe before the trial ends to keep the paid plan active.",
        periodLabel: "Trial ends",
      };
    case "active":
      return {
        tone: "info",
        title: "Subscription active",
        body: "Stripe confirms that this workspace has an active paid subscription. Plan and renewal changes are managed in Stripe.",
        periodLabel: "Renews",
      };
    case "free":
    default:
      return {
        tone: "info",
        title: "Free capacity tier",
        body: "This workspace is on the free plan. Open Stripe Checkout when you need the request allowance included with the Pro plan.",
        periodLabel: "Current period end",
      };
  }
}

function buildBillingPrimaryAction(
  billing: BillingSnapshot,
  checkoutIntentPlanId: string | undefined,
): AppConsoleBillingAction {
  if (
    checkoutIntentPlanId !== undefined
    && !billing.cancelAtPeriodEnd
    && billing.subscriptionStatus !== "past_due"
    && billing.subscriptionStatus !== "unpaid"
  ) {
    return {
      label: "Upgrade with Stripe",
      endpoint: "/billing/checkout",
      appearance: "primary",
      planId: normalizeCheckoutPlanId(checkoutIntentPlanId),
      autoOpen: true,
    };
  }
  if (billing.cancelAtPeriodEnd) {
    return {
      label: "Resume in Stripe",
      endpoint: "/billing/portal",
      appearance: "primary",
      autoOpen: false,
    };
  }
  if (billing.subscriptionStatus === "past_due" || billing.subscriptionStatus === "unpaid") {
    return {
      label: "Open billing portal",
      endpoint: "/billing/portal",
      appearance: "primary",
      autoOpen: false,
    };
  }
  if (billing.planId === "free" || billing.subscriptionStatus === "canceled" || billing.subscriptionStatus === "checkout_pending") {
    return {
      label: "Upgrade with Stripe",
      endpoint: "/billing/checkout",
      appearance: "primary",
      planId: normalizeCheckoutPlanId(checkoutIntentPlanId),
      autoOpen: checkoutIntentPlanId !== undefined,
    };
  }
  return {
    label: "Manage in Stripe",
    endpoint: "/billing/portal",
    appearance: "ghost",
    autoOpen: false,
  };
}

function buildBillingMirrorState(billing: BillingSnapshot): AppConsoleBillingMirrorState {
  const customerReference = billing.stripeCustomerId
    ?? (billing.planId === "free" ? "Created after the first hosted checkout" : "Pending Stripe customer sync");
  const subscriptionReference = billing.stripeSubscriptionId
    ?? (billing.planId === "free" ? "No paid subscription yet" : "Pending Stripe subscription sync");
  if (billing.subscriptionStatus === "checkout_pending") {
    return {
      lastWebhookAtLabel: formatDateTime(billing.lastWebhookAt),
      customerReference,
      subscriptionReference,
      syncStatusLabel: "checkout pending",
      syncGuidance: "Hosted Checkout has started. Refresh after Stripe webhook delivery to confirm the paid plan and renewal date here.",
    };
  }
  if (billing.lastWebhookAt === undefined) {
    return {
      lastWebhookAtLabel: formatDateTime(undefined),
      customerReference,
      subscriptionReference,
      syncStatusLabel: "waiting for Stripe",
      syncGuidance: "No Stripe webhook has been mirrored for this workspace yet. Starting hosted Checkout creates the first Stripe-linked billing record.",
    };
  }
  return {
    lastWebhookAtLabel: formatDateTime(billing.lastWebhookAt),
    customerReference,
    subscriptionReference,
    syncStatusLabel: "mirrored from Stripe",
    syncGuidance: "Plan, renewal, and recovery state are mirrored from Stripe webhooks. Use Checkout or the Customer Portal for changes, then return here after sync completes.",
  };
}

function stripAccessTokenQueryParam(url: string): string {
  try {
    const parsed = new URL(url, "http://app-console.local");
    parsed.searchParams.delete("access_token");
    const pathnameAndSearch = decodeURI(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return `${parsed.origin}${pathnameAndSearch}`;
    }
    return pathnameAndSearch;
  } catch {
    return url
      .replace(/([?&])access_token=\{access_token\}(&?)/g, (_match, prefix: string, suffix: string) => {
        if (prefix === "?" && suffix === "&") {
          return "?";
        }
        if (prefix === "&" && suffix === "&") {
          return "&";
        }
        return prefix === "?" ? "" : "";
      })
      .replace(/\?$/g, "")
      .replace(/&&/g, "&")
      .replace(/\?&/g, "?");
  }
}

function toMapLibreHeaderSnippet(styleUrl: string): string {
  const plainStyleUrl = stripAccessTokenQueryParam(styleUrl);
  return [
    'const token = "{access_token}";',
    "const map = new maplibregl.Map({",
    '  container: "map",',
    `  style: "${plainStyleUrl}",`,
    "  transformRequest: (url) => ({",
    "    url,",
    '    headers: { Authorization: `Bearer ${token}` },',
    "  }),",
    "});",
  ].join("\n");
}

export function buildRenderedSnippets(input: AppConsoleRenderedSnippetsInput): AppConsoleSnippet[] {
  if (!isRecord(input)) {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  const { snippets: values, prefix } = input;
  if (!isRecord(values) || typeof prefix !== "string") {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  const normalizedPrefix = prefix.trim();
  if (normalizedPrefix.length === 0) {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  if (values.styleUrl !== undefined && typeof values.styleUrl !== "string") {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  if (values.rasterTileUrl !== undefined && typeof values.rasterTileUrl !== "string") {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  if (values.staticMapUrl !== undefined && typeof values.staticMapUrl !== "string") {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  const snippets: AppConsoleSnippet[] = [];
  if (values.styleUrl) {
    snippets.push({
      id: `${normalizedPrefix}-maplibre`,
      title: "MapLibre style example",
      description: "Use the published style URL directly in browser clients.",
      queryCode: [
        "const map = new maplibregl.Map({",
        '  container: "map",',
        `  style: "${values.styleUrl}",`,
        "});",
      ].join("\n"),
      headerCode: toMapLibreHeaderSnippet(values.styleUrl),
      preferredMode: "query",
    });
  }
  if (values.rasterTileUrl) {
    const headerUrl = stripAccessTokenQueryParam(values.rasterTileUrl);
    snippets.push({
      id: `${normalizedPrefix}-raster`,
      title: "Raster tiles",
      description: "Use when a raster layer is easier than a vector style pipeline.",
      queryCode: `curl "${values.rasterTileUrl}" --output tile.png`,
      headerCode: `curl -H "Authorization: Bearer {access_token}" "${headerUrl}" --output tile.png`,
      preferredMode: "query",
    });
  }
  if (values.staticMapUrl) {
    const headerUrl = stripAccessTokenQueryParam(values.staticMapUrl);
    snippets.push({
      id: `${normalizedPrefix}-static`,
      title: "Static maps",
      description: "Generate images for previews, email, and sharing.",
      queryCode: `curl "${values.staticMapUrl}" --output map.png`,
      headerCode: `curl -H "Authorization: Bearer {access_token}" "${headerUrl}" --output map.png`,
      preferredMode: "query",
    });
  }
  return snippets;
}

function buildOverviewStats(bootstrap: ConsoleBootstrap): AppConsoleStat[] {
  return [
    {
      label: "Plan",
      value: bootstrap.billing.planId,
      detail: sentenceCaseStatus(bootstrap.billing.subscriptionStatus),
      href: "/app/billing",
    },
    {
      label: "Monthly usage",
      value: formatNumber(bootstrap.usageMonth.requestCount),
      detail: `${Math.round(bootstrap.usageMonth.percentOfIncludedRequests)}% of included allowance`,
      href: "/app/billing",
    },
    {
      label: "Projects",
      value: String(bootstrap.projects.length),
      detail: bootstrap.projects.length === 0 ? "Create the first project" : "Open access, keys, and usage",
      href: "/app/projects",
    },
    {
      label: "Published styles",
      value: String(bootstrap.styles.length),
      detail: bootstrap.styles.length === 0 ? "No public style published yet" : "Ready for snippets and previews",
      href: "/app/styles",
    },
  ];
}

function buildOverviewOnboardingSteps(bootstrap: ConsoleBootstrap): AppConsoleOnboardingStep[] {
  const hasProjects = bootstrap.projects.length > 0;
  const firstIntegration = bootstrap.firstIntegration;
  return [
    {
      label: "Create the first project",
      detail: hasProjects
        ? "At least one project exists in this workspace."
        : "Mint a project, define allowed origins, and unlock a live API token.",
      status: hasProjects ? "complete" : "current",
      href: firstIntegration.projectCreateHref,
    },
    {
      label: "Copy the one-time token and starter snippet",
      detail: hasProjects
        ? "Open a project detail page any time to rotate keys and regenerate starter snippets."
        : "Project issuance reveals the token once and links straight into quickstart-ready snippets.",
      status: hasProjects ? "current" : "blocked",
      href: firstIntegration.projectCreateHref,
    },
    {
      label: "Run the docs quickstart and load the first map",
      detail: firstIntegration.readiness === "needs_style"
        ? "No published style is available yet, so style, raster, and static snippets are still waiting on a published integration target."
        : "The published style URL is ready for the quickstart's first browser integration.",
      status: hasProjects
        ? (firstIntegration.readiness === "needs_style" ? "blocked" : "current")
        : "blocked",
      href: firstIntegration.readiness === "needs_style" ? "/app/styles" : firstIntegration.quickstartHref,
    },
  ];
}

function getOverviewSnippets(firstIntegration: ConsoleFirstIntegration): IntegrationSnippets {
  return firstIntegration.snippets;
}

async function getBootstrap(session: IdentitySession): Promise<ConsoleBootstrap> {
  return await getConsoleBootstrap(session);
}

export async function getAppOverviewPage(session: IdentitySession): Promise<AppConsoleOverviewPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  return {
    slug: "overview",
    title: "Workspace overview",
    description: "Current state, onboarding, and first integration paths.",
    shell: buildShell(normalizedSession, "overview", bootstrap),
    bootstrap,
    stats: buildOverviewStats(bootstrap),
    onboardingSteps: buildOverviewOnboardingSteps(bootstrap),
    snippets: buildRenderedSnippets({
      snippets: getOverviewSnippets(bootstrap.firstIntegration),
      prefix: "overview",
    }),
  };
}

export async function getAppProjectsPage(session: IdentitySession): Promise<AppConsoleProjectsPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  return {
    slug: "projects",
    title: "Projects",
    description: "Review project access, request usage, allowed origins, and API keys.",
    shell: buildShell(normalizedSession, "projects", bootstrap),
    bootstrap,
  };
}

export async function getAppProjectNewPage(session: IdentitySession): Promise<AppConsoleProjectNewPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  return {
    slug: "project-new",
    title: "Create project",
    description: "Create a project, choose its allowed origins, and issue its first access token.",
    shell: buildShell(normalizedSession, "project-new", bootstrap),
    bootstrap,
    seedSnippets: buildRenderedSnippets({
      snippets: bootstrap.firstIntegration.snippets,
      prefix: "project-new",
    }),
  };
}

export async function getAppProjectDetailPage(
  session: IdentitySession,
  input: AppConsoleProjectPathInput,
): Promise<AppConsoleProjectDetailPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const detail = await getConsoleProject(input.projectId, normalizedSession.workspace.id);
  return {
    slug: "project-detail",
    title: detail.project.name,
    description: "Policy summary, usage snapshot, key rotation, and copy-first integration snippets.",
    shell: buildShell(normalizedSession, "project-detail", bootstrap),
    bootstrap,
    detail,
    snippets: buildRenderedSnippets({
      snippets: detail.snippets,
      prefix: `project-${detail.project.id}`,
    }),
  };
}

export async function getAppProjectUsagePage(
  session: IdentitySession,
  input: AppConsoleProjectUsagePathInput,
): Promise<AppConsoleProjectUsagePage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const detail = await getConsoleProject(input.projectId, normalizedSession.workspace.id);
  const usage = await getConsoleProjectUsage(input.projectId, input.window, normalizedSession.workspace.id);
  return {
    slug: "project-usage",
    title: `${detail.project.name} usage`,
    description: "Review request volume and included allowance for the current day or month.",
    shell: buildShell(normalizedSession, "project-usage", bootstrap),
    bootstrap,
    detail,
    usage,
    window: input.window,
  };
}

export async function getAppStylesPage(session: IdentitySession): Promise<AppConsoleStylesPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  return {
    slug: "styles",
    title: "Published styles",
    description: "Review published styles and copy their style, raster, and static map URLs.",
    shell: buildShell(normalizedSession, "styles", bootstrap),
    bootstrap,
  };
}

export async function getAppStyleDetailPage(
  session: IdentitySession,
  input: AppConsoleStylePathInput,
): Promise<AppConsoleStyleDetailPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const detail = await getConsoleStyle(input.styleId);
  return {
    slug: "style-detail",
    title: detail.style.name,
    description: "Published style details and direct integration URLs.",
    shell: buildShell(normalizedSession, "style-detail", bootstrap),
    bootstrap,
    detail,
    snippets: buildRenderedSnippets({
      snippets: detail.snippets,
      prefix: `style-${detail.style.id}`,
    }),
  };
}

export async function getAppBillingPage(session: IdentitySession): Promise<AppConsoleBillingPage> {
  return await getAppBillingPageWithIntent(session, {});
}

export async function getAppBillingPageWithIntent(
  session: IdentitySession,
  input: {
    readonly checkoutIntentPlanId?: string;
    readonly checkoutStatus?: "success" | "cancel";
  },
): Promise<AppConsoleBillingPage> {
  if (!isBillingIntentInput(input)) {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const checkoutIntentPlanId = normalizeCheckoutIntentPlanId(input.checkoutIntentPlanId);
  const checkoutStatus = normalizeCheckoutStatus(input.checkoutStatus);
  const primaryAction = buildBillingPrimaryAction(bootstrap.billing, checkoutIntentPlanId);
  return {
    slug: "billing",
    title: "Billing",
    description: "Mirror Stripe state and route all billing actions through Stripe Checkout or the customer portal.",
    shell: buildShell(normalizedSession, "billing", bootstrap),
    bootstrap,
    plan: getBillingPlan(bootstrap.billing.planId),
    stateSummary: buildBillingStateSummary(bootstrap.billing),
    mirrorState: buildBillingMirrorState(bootstrap.billing),
    primaryAction,
    checkoutIntentPlanId,
    checkoutStatus,
  };
}

export async function getAppSettingsPage(session: IdentitySession): Promise<AppConsoleSettingsPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const settings = await getConsoleSettings(normalizedSession);
  return {
    slug: "settings",
    title: "Workspace settings",
    description: "Update workspace details and review the billing contact.",
    shell: buildShell(normalizedSession, "settings", bootstrap),
    bootstrap,
    settings,
  };
}

export async function getAppSettingsMembersPage(session: IdentitySession): Promise<AppConsoleSettingsMembersPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const settings = await getConsoleSettings(normalizedSession);
  return {
    slug: "settings-members",
    title: "Members",
    description: "Manage workspace members and invitations.",
    shell: buildShell(normalizedSession, "settings", bootstrap),
    bootstrap,
    settings,
  };
}

export async function getAppSettingsSecurityPage(session: IdentitySession): Promise<AppConsoleSettingsSecurityPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const settings = await getConsoleSettings(normalizedSession);
  
  const rawSessions = await prisma.identitySession.findMany({
    where: {
      userId: normalizedSession.user.id,
      revokedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const activeSessions = rawSessions.map((s) => ({
    tokenHash: s.tokenHash.slice(0, 10),
    userAgent: s.userAgent,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
  }));

  return {
    slug: "settings-security",
    title: "Security settings",
    description: "Manage your password, multi-factor authentication, and active sessions.",
    shell: buildShell(normalizedSession, "settings", bootstrap),
    bootstrap,
    settings,
    activeSessions,
  };
}

export async function getAppSettingsSecurityMfaPage(session: IdentitySession): Promise<AppConsoleSettingsSecurityMfaPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const settings = await getConsoleSettings(normalizedSession);
  
  return {
    slug: "settings-security-mfa",
    title: "MFA enrollment",
    description: "Secure your account operations with a standard TOTP authenticator device.",
    shell: buildShell(normalizedSession, "settings", bootstrap),
    bootstrap,
    settings,
  };
}

export async function getAppSettingsSecurityPasswordPage(session: IdentitySession): Promise<AppConsoleSettingsSecurityPasswordPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const settings = await getConsoleSettings(normalizedSession);
  return {
    slug: "settings-security-password",
    title: "Change password",
    description: "Confirm your current password and choose a new account password.",
    shell: buildShell(normalizedSession, "settings", bootstrap),
    bootstrap,
    settings,
  };
}

export async function getAppSettingsAccountPage(session: IdentitySession): Promise<AppConsoleSettingsAccountPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const settings = await getConsoleSettings(normalizedSession);
  return {
    slug: "settings-account",
    title: "Account management",
    description: "Export workspace data or schedule this workspace for deletion.",
    shell: buildShell(normalizedSession, "settings", bootstrap),
    bootstrap,
    settings,
  };
}

export async function getAppSettingsAccountExportPage(session: IdentitySession): Promise<AppConsoleSettingsAccountExportPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const settings = await getConsoleSettings(normalizedSession);
  return {
    slug: "settings-account-export",
    title: "Export workspace data",
    description: "Request a workspace data export and receive a download link by email when it is ready.",
    shell: buildShell(normalizedSession, "settings", bootstrap),
    bootstrap,
    settings,
  };
}

export async function getAppSettingsAccountDeletePage(session: IdentitySession): Promise<AppConsoleSettingsAccountDeletePage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const settings = await getConsoleSettings(normalizedSession);
  return {
    slug: "settings-account-delete",
    title: "Delete workspace",
    description: "Schedule this workspace for deletion after a 30-day recovery period.",
    shell: buildShell(normalizedSession, "settings", bootstrap),
    bootstrap,
    settings,
  };
}

export async function getAppNotificationsPage(session: IdentitySession): Promise<AppConsoleNotificationsPage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  const bootstrap = await getBootstrap(normalizedSession);
  const notifications = await listConsoleNotifications(normalizedSession.workspace.id);
  return {
    slug: "notifications",
    title: "Workspace notifications",
    description: "Review workspace, billing, and account events recorded during the last 90 days.",
    shell: buildShell(normalizedSession, "notifications", bootstrap),
    bootstrap,
    notifications,
  };
}

export async function getAppConsolePage(
  session: IdentitySession,
  input:
    | { readonly slug: "overview" }
    | { readonly slug: "projects" }
    | { readonly slug: "project-new" }
    | ({ readonly slug: "project-detail" } & AppConsoleProjectPathInput)
    | ({ readonly slug: "project-usage" } & AppConsoleProjectUsagePathInput)
    | { readonly slug: "styles" }
    | ({ readonly slug: "style-detail" } & AppConsoleStylePathInput)
    | { readonly slug: "billing"; readonly checkoutIntentPlanId?: string; readonly checkoutStatus?: "success" | "cancel" }
    | { readonly slug: "settings" }
    | { readonly slug: "settings-members" }
    | { readonly slug: "settings-security" }
    | { readonly slug: "settings-security-mfa" }
    | { readonly slug: "settings-security-password" }
    | { readonly slug: "settings-account" }
    | { readonly slug: "settings-account-export" }
    | { readonly slug: "settings-account-delete" }
    | { readonly slug: "notifications" },
): Promise<AppConsolePage> {
  const normalizedSession = normalizeAppConsoleSession(session);
  if (!isAppConsolePageInput(input)) {
    throw new Error("APP_CONSOLE_PAGE_NOT_FOUND");
  }
  normalizeAppConsolePageSlug(input.slug);
  switch (input.slug) {
    case "overview":
      return await getAppOverviewPage(normalizedSession);
    case "projects":
      return await getAppProjectsPage(normalizedSession);
    case "project-new":
      return await getAppProjectNewPage(normalizedSession);
    case "project-detail":
      return await getAppProjectDetailPage(normalizedSession, input);
    case "project-usage":
      return await getAppProjectUsagePage(normalizedSession, input);
    case "styles":
      return await getAppStylesPage(normalizedSession);
    case "style-detail":
      return await getAppStyleDetailPage(normalizedSession, input);
    case "billing":
      return await getAppBillingPageWithIntent(normalizedSession, {
        checkoutIntentPlanId: "checkoutIntentPlanId" in input ? input.checkoutIntentPlanId : undefined,
        checkoutStatus: "checkoutStatus" in input ? input.checkoutStatus : undefined,
      });
    case "settings":
      return await getAppSettingsPage(normalizedSession);
    case "settings-members":
      return await getAppSettingsMembersPage(normalizedSession);
    case "settings-security":
      return await getAppSettingsSecurityPage(normalizedSession);
    case "settings-security-mfa":
      return await getAppSettingsSecurityMfaPage(normalizedSession);
    case "settings-security-password":
      return await getAppSettingsSecurityPasswordPage(normalizedSession);
    case "settings-account":
      return await getAppSettingsAccountPage(normalizedSession);
    case "settings-account-export":
      return await getAppSettingsAccountExportPage(normalizedSession);
    case "settings-account-delete":
      return await getAppSettingsAccountDeletePage(normalizedSession);
    case "notifications":
      return await getAppNotificationsPage(normalizedSession);
  }
}
