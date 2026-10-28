import type { HttpMethod } from "../../../contracts/types";
import { getAppConsolePage } from "../app-console.service";
import { renderAppConsoleHtml } from "./html";
import { requireSession } from "../../identity/identity.service";
import { IdentityError, IdentityErrorCode } from "../../identity/types";
import { CustomerConsoleError, CustomerConsoleErrorCode } from "../../customer-console/types";
import { escapeHtml } from "../../design-system/components";
import { getGlobalCss } from "../../design-system/styles";

interface AppConsoleRouteRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface AppConsoleRouteResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRouteHeaders(value: unknown): Readonly<Record<string, string | undefined>> | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries: Array<[string, string | undefined]> = [];
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof key !== "string") {
      return null;
    }
    if (typeof headerValue !== "string" && headerValue !== undefined) {
      return null;
    }
    entries.push([key, headerValue]);
  }
  return Object.fromEntries(entries);
}

function normalizeRouteRequest(input: unknown): AppConsoleRouteRequest | null {
  if (!isRecord(input)) {
    return null;
  }
  if (typeof input.method !== "string" || typeof input.path !== "string") {
    return null;
  }
  const headers = normalizeRouteHeaders(input.headers);
  if (headers === null) {
    return null;
  }
  return {
    method: input.method as HttpMethod,
    path: input.path,
    headers,
  };
}

type ResolvedAppPath =
  | { readonly slug: "invalid" }
  | { readonly slug: "overview" }
  | { readonly slug: "projects" }
  | { readonly slug: "project-new" }
  | { readonly slug: "project-detail"; readonly projectId: string }
  | { readonly slug: "project-usage"; readonly projectId: string; readonly window: "day" | "month" }
  | { readonly slug: "styles" }
  | { readonly slug: "style-detail"; readonly styleId: string }
  | { readonly slug: "billing"; readonly checkoutIntentPlanId?: string; readonly checkoutStatus?: "success" | "cancel" }
  | { readonly slug: "settings" }
  | { readonly slug: "settings-members" }
  | { readonly slug: "settings-security" }
  | { readonly slug: "settings-security-mfa" }
  | { readonly slug: "settings-security-password" }
  | { readonly slug: "settings-account" }
  | { readonly slug: "settings-account-export" }
  | { readonly slug: "settings-account-delete" }
  | { readonly slug: "notifications" };

function normalizePath(path: string): string {
  return path.split("?")[0] ?? "/";
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function bodyForMethod(method: HttpMethod, body: string): string | undefined {
  if (method === "HEAD") {
    return undefined;
  }
  return body;
}

function htmlResponse(method: HttpMethod, status: number, body: string, location?: string): AppConsoleRouteResponse {
  return {
    status,
    body: bodyForMethod(method, body),
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(byteLengthUtf8(body)),
      "cache-control": "no-store",
      ...(location ? { location } : {}),
    },
  };
}

function redirectResponse(location: string): AppConsoleRouteResponse {
  return {
    status: 302,
    headers: {
      location,
      "content-length": "0",
      "cache-control": "no-store",
    },
  };
}

function errorHtml(title: string, message: string, href: string, cta: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | Tileserver App</title>
  <style>
    ${getGlobalCss()}
    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    article { width: min(100%, 620px); padding: 32px; background: var(--surface); }
    h1 { margin: 0 0 12px; font-size: 2rem; }
    p { margin: 0 0 18px; color: var(--muted); line-height: 1.55; }
    .skip-link { position: fixed; inset-block-start: 8px; inset-inline-start: 8px; translate: 0 -160%; padding: 8px 12px; border: 2px solid var(--accent); border-radius: var(--rad-1); background: var(--bg); color: var(--ink); font-weight: 600; }
    .skip-link:focus { translate: 0; }
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <main id="main-content" tabindex="-1">
    <article class="ds-card">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a class="ds-button ds-button-primary" href="${escapeHtml(href)}">${escapeHtml(cta)}</a>
    </article>
  </main>
</body>
</html>`;
}

function decodePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    if (
      decoded.length === 0
      || decoded.includes("/")
      || decoded.includes("\\")
      || decoded === "."
      || decoded.includes("..")
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function normalizeUsageWindow(path: string): "day" | "month" | null {
  const url = new URL(path, "http://app-console.local");
  const rawWindow = url.searchParams.get("window");
  if (rawWindow === null) {
    return "month";
  }
  const window = rawWindow.trim().toLowerCase();
  if (window.length === 0 || window === "month") {
    return "month";
  }
  if (window === "day") {
    return "day";
  }
  return null;
}

function normalizeBillingIntent(path: string): {
  readonly invalid?: true;
  readonly checkoutIntentPlanId?: string;
  readonly checkoutStatus?: "success" | "cancel";
} {
  const url = new URL(path, "http://app-console.local");
  const intent = url.searchParams.get("intent")?.trim().toLowerCase();
  const plan = url.searchParams.get("plan")?.trim().toLowerCase();
  const checkout = url.searchParams.get("checkout")?.trim().toLowerCase();
  const hasIntent = url.searchParams.has("intent");
  const hasPlan = url.searchParams.has("plan");
  const hasUpgradeIntent = intent === "upgrade";
  const validUpgradePlan = plan === "pro";
  const validCheckoutStatus = checkout === undefined || checkout === "success" || checkout === "cancel";

  if (
    (hasIntent && !hasUpgradeIntent)
    || (hasUpgradeIntent && !validUpgradePlan)
    || (hasPlan && (!hasUpgradeIntent || !validUpgradePlan))
    || !validCheckoutStatus
  ) {
    return {
      invalid: true,
    };
  }

  return {
    checkoutIntentPlanId: hasUpgradeIntent && validUpgradePlan ? "pro" : undefined,
    checkoutStatus: checkout === "success" || checkout === "cancel" ? checkout : undefined,
  };
}

function resolveAppPath(path: string): ResolvedAppPath | null {
  const normalized = normalizePath(path);
  if (normalized === "/app" || normalized === "/app/") {
    return { slug: "overview" };
  }
  if (normalized === "/app/projects" || normalized === "/app/projects/") {
    return { slug: "projects" };
  }
  if (normalized === "/app/projects/new" || normalized === "/app/projects/new/") {
    return { slug: "project-new" };
  }
  if (normalized === "/app/styles" || normalized === "/app/styles/") {
    return { slug: "styles" };
  }
  if (normalized === "/app/billing" || normalized === "/app/billing/") {
    const intent = normalizeBillingIntent(path);
    if (intent.invalid) {
      return {
        slug: "invalid",
      };
    }
    return {
      slug: "billing",
      ...intent,
    };
  }
  if (normalized === "/app/settings" || normalized === "/app/settings/") {
    return { slug: "settings" };
  }
  if (normalized === "/app/settings/members" || normalized === "/app/settings/members/") {
    return { slug: "settings-members" };
  }
  if (normalized === "/app/settings/security" || normalized === "/app/settings/security/") {
    return { slug: "settings-security" };
  }
  if (normalized === "/app/settings/security/mfa" || normalized === "/app/settings/security/mfa/") {
    return { slug: "settings-security-mfa" };
  }
  if (normalized === "/app/settings/security/password" || normalized === "/app/settings/security/password/") {
    return { slug: "settings-security-password" };
  }
  if (normalized === "/app/settings/account" || normalized === "/app/settings/account/") {
    return { slug: "settings-account" };
  }
  if (normalized === "/app/settings/account/export" || normalized === "/app/settings/account/export/") {
    return { slug: "settings-account-export" };
  }
  if (normalized === "/app/settings/account/delete" || normalized === "/app/settings/account/delete/") {
    return { slug: "settings-account-delete" };
  }
  if (normalized === "/app/notifications" || normalized === "/app/notifications/") {
    return { slug: "notifications" };
  }
  const projectUsageMatch = /^\/app\/projects\/([^/]+)\/usage\/?$/.exec(normalized);
  if (projectUsageMatch?.[1]) {
    const projectId = decodePathSegment(projectUsageMatch[1]);
    const window = normalizeUsageWindow(path);
    if (!projectId) {
      return null;
    }
    if (!window) {
      return {
        slug: "invalid",
      };
    }
    return {
      slug: "project-usage",
      projectId,
      window,
    };
  }
  const projectMatch = /^\/app\/projects\/([^/]+)\/?$/.exec(normalized);
  if (projectMatch?.[1]) {
    const projectId = decodePathSegment(projectMatch[1]);
    if (!projectId) {
      return null;
    }
    return {
      slug: "project-detail",
      projectId,
    };
  }
  const styleMatch = /^\/app\/styles\/([^/]+)\/?$/.exec(normalized);
  if (styleMatch?.[1]) {
    const styleId = decodePathSegment(styleMatch[1]);
    if (!styleId) {
      return null;
    }
    return {
      slug: "style-detail",
      styleId,
    };
  }
  return null;
}

function methodsHeader(): string {
  return "GET,HEAD,OPTIONS";
}

export async function appConsoleRoute(input: AppConsoleRouteRequest): Promise<AppConsoleRouteResponse> {
  const request = normalizeRouteRequest(input);
  if (!request) {
    return htmlResponse(
      "GET",
      400,
      errorHtml("Bad request", "The app route input is invalid.", "/app", "Back to app"),
    );
  }
  if (request.method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        allow: methodsHeader(),
        "cache-control": "public, max-age=60",
      },
    };
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return htmlResponse(request.method, 400, errorHtml("Bad request", "This route only supports GET, HEAD, and OPTIONS.", "/app", "Back to app"));
  }
  const resolved = resolveAppPath(request.path);
  if (!resolved) {
    return htmlResponse(request.method, 404, errorHtml("Page not found", "The requested app page does not exist.", "/app", "Open overview"));
  }
  if (resolved.slug === "invalid") {
    return htmlResponse(request.method, 400, errorHtml("Bad request", "The requested app page parameters are invalid.", "/app", "Open overview"));
  }
  try {
    const session = await requireSession(request.headers);
    const page = await getAppConsolePage(session, resolved);
    return htmlResponse(request.method, 200, renderAppConsoleHtml(page));
  } catch (error) {
    if (error instanceof IdentityError) {
      if (error.code === IdentityErrorCode.UNAUTHORIZED) {
        return redirectResponse(`/sign-in?next=${encodeURIComponent(request.path)}`);
      }
      if (error.code === IdentityErrorCode.BAD_REQUEST) {
        return htmlResponse(
          request.method,
          400,
          errorHtml("Bad request", error.details, "/app", "Open overview"),
        );
      }
    }
    if (error instanceof CustomerConsoleError) {
      const status = error.code === CustomerConsoleErrorCode.NOT_FOUND ? 404 : error.code === CustomerConsoleErrorCode.BAD_REQUEST ? 400 : 503;
      const body = errorHtml(
        status === 404 ? "Resource not found" : "App unavailable",
        error.details,
        "/app",
        "Open overview",
      );
      return htmlResponse(request.method, status, body);
    }
    const fallback = errorHtml(
      "App unavailable",
      "The app console could not load this page. Review customer-console and billing dependencies before retrying.",
      "/app",
      "Open overview",
    );
    return htmlResponse(request.method, 503, fallback);
  }
}
