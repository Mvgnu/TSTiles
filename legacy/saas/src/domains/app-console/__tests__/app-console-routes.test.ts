import { strict as assert } from "node:assert";
import { appConsoleRoute } from "../routes/app-route";
import {
  buildRenderedSnippets,
  getAppBillingPageWithIntent,
  getAppConsolePage,
  getAppOverviewPage,
  getAppSettingsPage,
} from "../app-console.service";
import { issueDemoSession } from "../../identity/identity.service";
import { createConsoleProject } from "../../customer-console/customer-console.service";
import { applyStripeWebhookEvent } from "../../billing-sync/billing-sync.service";
import { createStyleVersion, publishStyleVersion } from "../../styles/styles.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.NODE_ENV = "development";

let sequence = 0;

function uniqueId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function sessionHeaders(token: string): Record<string, string> {
  return {
    cookie: `app_session=${token}`,
  };
}

async function seedPublishedStyle(styleId: string): Promise<void> {
  const version = await createStyleVersion(styleId, {
    version: 8,
    sources: {
      map: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    layers: [],
  });
  await publishStyleVersion(styleId, version.id);
}

test("app console redirects unauthenticated users to sign-in with next path", async () => {
  const response = await appConsoleRoute({
    method: "GET",
    path: "/app/projects",
    headers: {},
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/sign-in?next=%2Fapp%2Fprojects");
});

test("app console route rejects malformed direct request input", async () => {
  const nullRequest = await appConsoleRoute(
    null as unknown as Parameters<typeof appConsoleRoute>[0],
  );
  assert.equal(nullRequest.status, 400);
  assert.equal((nullRequest.body ?? "").includes("The app route input is invalid."), true);

  const badPath = await appConsoleRoute({
    method: "GET",
    path: 42 as unknown as string,
    headers: {},
  });
  assert.equal(badPath.status, 400);

  const badMethod = await appConsoleRoute({
    method: 42 as unknown as "GET",
    path: "/app",
    headers: {},
  });
  assert.equal(badMethod.status, 400);

  const badHeaders = await appConsoleRoute({
    method: "GET",
    path: "/app",
    headers: {
      cookie: 42 as unknown as string,
    },
  });
  assert.equal(badHeaders.status, 400);
});

test("app console service rejects malformed direct page slugs", async () => {
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("page-slug")}@example.com`,
    workspaceId: uniqueId("workspace"),
    workspaceName: "Page Slug Workspace",
  });

  await assert.rejects(async () => {
    await getAppConsolePage(session, { slug: "missing" } as unknown as Parameters<typeof getAppConsolePage>[1]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppConsolePage(session, { slug: 42 } as unknown as Parameters<typeof getAppConsolePage>[1]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppConsolePage(session, null as unknown as Parameters<typeof getAppConsolePage>[1]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppConsolePage(session, 42 as unknown as Parameters<typeof getAppConsolePage>[1]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);
});

test("app console exported page builders reject malformed direct session input", async () => {
  await assert.rejects(async () => {
    await getAppOverviewPage(null as unknown as Parameters<typeof getAppOverviewPage>[0]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppOverviewPage({
      token: "token",
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User",
        createdAt: new Date().toISOString(),
      },
      workspace: {
        id: "workspace-1",
        name: "Workspace",
        createdAt: new Date().toISOString(),
      },
      membership: {
        workspaceId: "workspace-1",
        userId: "user-1",
        role: "admin",
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    } as unknown as Parameters<typeof getAppOverviewPage>[0]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppSettingsPage(42 as unknown as Parameters<typeof getAppSettingsPage>[0]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppConsolePage(null as unknown as Parameters<typeof getAppConsolePage>[0], { slug: "overview" });
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppOverviewPage({
      token: "token",
      user: {
        id: "user/1",
        email: "user@example.com",
        name: "User",
        createdAt: new Date().toISOString(),
      },
      workspace: {
        id: "workspace-1",
        name: "Workspace",
        createdAt: new Date().toISOString(),
      },
      membership: {
        workspaceId: "workspace-1",
        userId: "user/1",
        role: "member",
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    } as unknown as Parameters<typeof getAppOverviewPage>[0]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppSettingsPage({
      token: "token",
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "User",
        createdAt: new Date().toISOString(),
      },
      workspace: {
        id: "workspace-1",
        name: "Workspace",
        createdAt: new Date().toISOString(),
      },
      membership: {
        workspaceId: "workspace-1",
        userId: "different-user",
        role: "member",
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    } as unknown as Parameters<typeof getAppSettingsPage>[0]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);
});

test("app console accepts managed-auth header sessions when the production bridge is enabled", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousManagedMode = process.env.IDENTITY_MANAGED_AUTH_MODE;
  try {
    process.env.NODE_ENV = "production";
    process.env.IDENTITY_MANAGED_AUTH_MODE = "header";
    const response = await appConsoleRoute({
      method: "GET",
      path: "/app",
      headers: {
        "x-auth-user-id": uniqueId("managed-user"),
        "x-auth-email": `${uniqueId("managed-email")}@example.com`,
        "x-auth-name": "Managed Header User",
        "x-auth-workspace-id": uniqueId("managed-workspace"),
        "x-auth-workspace-name": "Managed Header Workspace",
        "x-auth-role": "member",
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
    assert.equal((response.body ?? "").includes("Workspace overview"), true);
    assert.equal((response.body ?? "").includes("Managed Header Workspace"), true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.IDENTITY_MANAGED_AUTH_MODE = previousManagedMode;
  }
});

test("app console fails closed with bad request on malformed managed-auth headers", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousManagedMode = process.env.IDENTITY_MANAGED_AUTH_MODE;
  try {
    process.env.NODE_ENV = "production";
    process.env.IDENTITY_MANAGED_AUTH_MODE = "header";
    const response = await appConsoleRoute({
      method: "GET",
      path: "/app",
      headers: {
        "x-auth-user-id": "managed/user",
        "x-auth-workspace-id": "managed-workspace",
      },
    });
    assert.equal(response.status, 400);
    assert.equal((response.body ?? "").includes("contains unsupported characters"), true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.IDENTITY_MANAGED_AUTH_MODE = previousManagedMode;
  }
});

test("app console treats malformed or blank encoded path segments as missing pages", async () => {
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("malformed-route")}@example.com`,
    workspaceId: uniqueId("workspace"),
    workspaceName: "Malformed Route Workspace",
  });

  const blankProject = await appConsoleRoute({
    method: "GET",
    path: "/app/projects/%20",
    headers: sessionHeaders(session.token),
  });
  assert.equal(blankProject.status, 404);
  assert.equal((blankProject.body ?? "").includes("Page not found"), true);

  const encodedSlashStyle = await appConsoleRoute({
    method: "GET",
    path: "/app/styles/foo%2Fbar",
    headers: sessionHeaders(session.token),
  });
  assert.equal(encodedSlashStyle.status, 404);
  assert.equal((encodedSlashStyle.body ?? "").includes("Page not found"), true);

  const encodedBackslashProject = await appConsoleRoute({
    method: "GET",
    path: "/app/projects/foo%5Cbar",
    headers: sessionHeaders(session.token),
  });
  assert.equal(encodedBackslashProject.status, 404);
  assert.equal((encodedBackslashProject.body ?? "").includes("Page not found"), true);

  const traversalStyle = await appConsoleRoute({
    method: "GET",
    path: "/app/styles/..",
    headers: sessionHeaders(session.token),
  });
  assert.equal(traversalStyle.status, 404);
  assert.equal((traversalStyle.body ?? "").includes("Page not found"), true);

  const embeddedTraversalProject = await appConsoleRoute({
    method: "GET",
    path: "/app/projects/foo..bar",
    headers: sessionHeaders(session.token),
  });
  assert.equal(embeddedTraversalProject.status, 404);
  assert.equal((embeddedTraversalProject.body ?? "").includes("Page not found"), true);

  const embeddedTraversalStyle = await appConsoleRoute({
    method: "GET",
    path: "/app/styles/style..draft",
    headers: sessionHeaders(session.token),
  });
  assert.equal(embeddedTraversalStyle.status, 404);
  assert.equal((embeddedTraversalStyle.body ?? "").includes("Page not found"), true);

  const malformedEncoding = await appConsoleRoute({
    method: "GET",
    path: "/app/projects/%E0%A4%A/usage?window=day",
    headers: sessionHeaders(session.token),
  });
  assert.equal(malformedEncoding.status, 404);
  assert.equal((malformedEncoding.body ?? "").includes("Page not found"), true);
});

test("app console billing route fails closed on malformed billing intent query values", async () => {
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("billing-route")}@example.com`,
    workspaceId: uniqueId("workspace"),
    workspaceName: "Billing Route Workspace",
  });

  const invalidIntent = await appConsoleRoute({
    method: "GET",
    path: "/app/billing?intent=downgrade&plan=pro",
    headers: sessionHeaders(session.token),
  });
  assert.equal(invalidIntent.status, 400);
  assert.equal((invalidIntent.body ?? "").includes("invalid"), true);

  const invalidPlan = await appConsoleRoute({
    method: "GET",
    path: "/app/billing?intent=upgrade&plan=enterprise",
    headers: sessionHeaders(session.token),
  });
  assert.equal(invalidPlan.status, 400);
  assert.equal((invalidPlan.body ?? "").includes("invalid"), true);

  const missingPlan = await appConsoleRoute({
    method: "GET",
    path: "/app/billing?intent=upgrade",
    headers: sessionHeaders(session.token),
  });
  assert.equal(missingPlan.status, 400);
  assert.equal((missingPlan.body ?? "").includes("invalid"), true);

  const invalidCheckoutStatus = await appConsoleRoute({
    method: "GET",
    path: "/app/billing?checkout=pending",
    headers: sessionHeaders(session.token),
  });
  assert.equal(invalidCheckoutStatus.status, 400);
  assert.equal((invalidCheckoutStatus.body ?? "").includes("invalid"), true);
});

test("app console header-mode snippets strip query-token placeholders while preserving other params", () => {
  const snippets = buildRenderedSnippets({
    prefix: "query-shape",
    snippets: {
      styleUrl: "/v1/styles/basic/style.json?draft=published&access_token={access_token}&lang=en",
      rasterTileUrl: "/v1/raster/basic/{z}/{x}/{y}.png?format=png&access_token={access_token}&lang=en",
      staticMapUrl: "/v1/static/basic/{lon},{lat},{zoom}/{width}x{height}.png?scale=2&access_token={access_token}&lang=en",
    },
  });

  const maplibre = snippets.find((entry) => entry.id === "query-shape-maplibre");
  assert.equal(maplibre?.headerCode.includes('style: "/v1/styles/basic/style.json?draft=published&lang=en"'), true);
  assert.equal(maplibre?.headerCode.includes("access_token={access_token}"), false);

  const raster = snippets.find((entry) => entry.id === "query-shape-raster");
  assert.equal(raster?.headerCode.includes("/v1/raster/basic/{z}/{x}/{y}.png"), true);
  assert.equal(raster?.headerCode.includes("format=png"), true);
  assert.equal(raster?.headerCode.includes("lang=en"), true);
  assert.equal(raster?.headerCode.includes("access_token={access_token}"), false);

  const staticMap = snippets.find((entry) => entry.id === "query-shape-static");
  assert.equal(staticMap?.headerCode.includes("/v1/static/basic/{lon},{lat},{zoom}/{width}x{height}.png"), true);
  assert.equal(staticMap?.headerCode.includes("scale=2"), true);
  assert.equal(staticMap?.headerCode.includes("lang=en"), true);
  assert.equal(staticMap?.headerCode.includes("access_token={access_token}"), false);

  assert.throws(() => {
    buildRenderedSnippets(null as unknown as Parameters<typeof buildRenderedSnippets>[0]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  assert.throws(() => {
    buildRenderedSnippets(42 as unknown as Parameters<typeof buildRenderedSnippets>[0]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  assert.throws(() => {
    buildRenderedSnippets({
      prefix: "bad-shape",
      snippets: {
        styleUrl: 42 as unknown as string,
      },
    });
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  assert.throws(() => {
    buildRenderedSnippets({
      prefix: "   ",
      snippets: {
        styleUrl: "/v1/styles/basic/style.json?access_token={access_token}",
      },
    });
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);
});

test("app console html runtime strips query-token placeholders in client-side snippet generation", async () => {
  const styleId = uniqueId("style");
  await seedPublishedStyle(styleId);
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("runtime")}@example.com`,
    workspaceId: uniqueId("workspace"),
    workspaceName: "Runtime Snippet Workspace",
  });

  const create = await appConsoleRoute({
    method: "GET",
    path: "/app/projects/new",
    headers: sessionHeaders(session.token),
  });
  assert.equal(create.status, 200);
  assert.equal((create.body ?? "").includes("async function requestJson(url, init)"), true);
  assert.equal((create.body ?? "").includes("catch (_error)"), true);
  assert.equal((create.body ?? "").includes("return true;"), true);
  assert.equal((create.body ?? "").includes("function stripAccessTokenQueryParam(url)"), true);
  assert.equal((create.body ?? "").includes('var filtered = query.split("&").filter(function (entry) {'), true);
  assert.equal((create.body ?? "").includes('return entry && entry.indexOf("access_token=") !== 0;'), true);
  assert.equal((create.body ?? "").includes('copyButton.textContent = copied ? "Copied" : "Copy failed";'), true);
  assert.equal((create.body ?? "").includes('button.textContent = copied ? "Copied" : "Copy failed";'), true);
  assert.equal((create.body ?? "").includes('replace(/\\\\?access_token=\\\\{access_token\\\\}/g, "")'), false);
});

test("app console renders overview and project creation surfaces", async () => {
  const styleId = uniqueId("style");
  await seedPublishedStyle(styleId);
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("overview")}@example.com`,
    workspaceId: uniqueId("workspace"),
    workspaceName: "Overview Workspace",
  });

  const overview = await appConsoleRoute({
    method: "GET",
    path: "/app",
    headers: sessionHeaders(session.token),
  });
  assert.equal(overview.status, 200);
  assert.equal(overview.headers["content-type"], "text/html; charset=utf-8");
  assert.equal((overview.body ?? "").includes("Workspace overview"), true);
  assert.equal((overview.body ?? "").includes("Setup checklist"), true);
  assert.equal((overview.body ?? "").includes("Step 1 of 3"), true);
  assert.equal((overview.body ?? "").includes("Create the first project"), true);
  assert.equal((overview.body ?? "").includes("Copy the one-time token and starter snippet"), true);
  assert.equal((overview.body ?? "").includes("First integration snippets"), true);
  assert.equal((overview.body ?? "").includes('<main id="main-content" tabindex="-1">'), true);
  assert.equal((overview.body ?? "").includes('class="mobile-menu"'), true);
  assert.equal((overview.body ?? "").includes('aria-current="page"'), true);
  assert.equal((overview.body ?? "").includes("data-sign-out-button"), false);
  assert.equal((overview.body ?? "").includes('<form class="sign-out-form" action="/sign-out" method="post">'), true);
  assert.equal((overview.body ?? "").includes("/security"), true);
  assert.equal((overview.body ?? "").includes("/status"), true);
  assert.equal((overview.body ?? "").includes("/legal/terms"), true);
  assert.equal((overview.body ?? "").includes("/legal/privacy"), true);
  assert.equal((overview.body ?? "").includes("/legal/dpa"), true);
  assert.equal((overview.body ?? "").includes("/legal/acceptable-use"), true);
  assert.equal((overview.body ?? "").includes("Issue one project token and store it immediately. It will not be shown again."), true);
  for (const theatricalCopy of ["TENANT UNINITIALIZED", "uplink", "perimeter", "compute cycles", "payloads executing", "God-tier", "ACTIVE TELEMETRY STREAM"]) {
    assert.equal((overview.body ?? "").includes(theatricalCopy), false);
  }

  const create = await appConsoleRoute({
    method: "GET",
    path: "/app/projects/new",
    headers: sessionHeaders(session.token),
  });
  assert.equal(create.status, 200);
  assert.equal((create.body ?? "").includes("Create project"), true);
  assert.equal((create.body ?? "").includes("Token will be shown once after creation and will not be shown again"), true);
  assert.equal((create.body ?? "").includes("data-project-create-form"), true);
  assert.equal((create.body ?? "").includes("This card stays visible until you dismiss it."), true);
  assert.equal((create.body ?? "").includes("data-dismiss-provision"), true);
});

test("app console renders project, style, billing, and settings pages", async () => {
  const styleId = uniqueId("style");
  await seedPublishedStyle(styleId);
  const workspaceId = uniqueId("workspace");
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("console")}@example.com`,
    workspaceId,
    workspaceName: "Console Workspace",
  });
  const created = await createConsoleProject({
    name: "Console Project",
    allowedOrigins: ["https://maps.example.com"],
    allowedEndpoints: {
      tiles: true,
      raster: true,
      staticMaps: false,
    },
  }, workspaceId);

  const projects = await appConsoleRoute({
    method: "GET",
    path: "/app/projects",
    headers: sessionHeaders(session.token),
  });
  assert.equal(projects.status, 200);
  assert.equal((projects.body ?? "").includes("Workspace projects"), true);
  assert.equal((projects.body ?? "").includes("Console Project"), true);
  assert.equal((projects.body ?? "").includes("Rotate key"), true);
  assert.equal((projects.body ?? "").includes("data-rotate-confirm-dialog"), true);
  assert.equal((projects.body ?? "").includes("Confirm key rotation"), true);

  const detail = await appConsoleRoute({
    method: "GET",
    path: `/app/projects/${encodeURIComponent(created.project.id)}`,
    headers: sessionHeaders(session.token),
  });
  assert.equal(detail.status, 200);
  assert.equal((detail.body ?? "").includes("Project settings"), true);
  assert.equal((detail.body ?? "").includes("Key management"), true);
  assert.equal((detail.body ?? "").includes("Usage snapshot"), true);
  assert.equal((detail.body ?? "").includes("Endpoint coverage"), true);
  assert.equal((detail.body ?? "").includes("previous token will stop working immediately"), true);
  assert.equal((detail.body ?? "").includes("data-dismiss-provision"), true);

  const usage = await appConsoleRoute({
    method: "GET",
    path: `/app/projects/${encodeURIComponent(created.project.id)}/usage?window=day`,
    headers: sessionHeaders(session.token),
  });
  assert.equal(usage.status, 200);
  assert.equal((usage.body ?? "").includes("Daily request volume"), true);

  const trimmedUsage = await appConsoleRoute({
    method: "GET",
    path: `/app/projects/${encodeURIComponent(created.project.id)}/usage?window=%20DAY%20`,
    headers: sessionHeaders(session.token),
  });
  assert.equal(trimmedUsage.status, 200);
  assert.equal((trimmedUsage.body ?? "").includes("Daily request volume"), true);

  const invalidUsage = await appConsoleRoute({
    method: "GET",
    path: `/app/projects/${encodeURIComponent(created.project.id)}/usage?window=year`,
    headers: sessionHeaders(session.token),
  });
  assert.equal(invalidUsage.status, 400);
  assert.equal((invalidUsage.body ?? "").includes("Bad request"), true);

  const styles = await appConsoleRoute({
    method: "GET",
    path: `/app/styles/${encodeURIComponent(styleId)}`,
    headers: sessionHeaders(session.token),
  });
  assert.equal(styles.status, 200);
  assert.equal((styles.body ?? "").includes("Integration hints"), true);
  assert.equal((styles.body ?? "").includes(styleId), true);
  assert.equal((styles.body ?? "").includes("Static map preview"), true);
  assert.equal((styles.body ?? "").includes("Copy style URL"), true);
  assert.equal((styles.body ?? "").includes("Copy raster URL"), true);
  assert.equal((styles.body ?? "").includes("Copy static URL"), true);
  assert.equal((styles.body ?? "").includes('data-style-preview-empty'), true);
  assert.equal((styles.body ?? "").includes("Preview unavailable without a project token"), true);
  assert.equal((styles.body ?? "").includes("Preview not loaded"), true);
  assert.equal((styles.body ?? "").includes('/v1/static/'), true);
  assert.equal((styles.body ?? "").includes('access_token=demo-public-token'), false);

  const stylesIndex = await appConsoleRoute({
    method: "GET",
    path: "/app/styles",
    headers: sessionHeaders(session.token),
  });
  assert.equal(stylesIndex.status, 200);
  assert.equal((stylesIndex.body ?? "").includes("Static map preview"), true);
  assert.equal((stylesIndex.body ?? "").includes("Raster example"), true);
  assert.equal((stylesIndex.body ?? "").includes("Static example"), true);
  assert.equal((stylesIndex.body ?? "").includes("Copy raster URL"), true);
  assert.equal((stylesIndex.body ?? "").includes("Copy static URL"), true);
  assert.equal((stylesIndex.body ?? "").includes('data-style-preview-empty'), true);
  assert.equal((stylesIndex.body ?? "").includes("Preview unavailable without a project token"), true);

  const billing = await appConsoleRoute({
    method: "GET",
    path: "/app/billing",
    headers: sessionHeaders(session.token),
  });
  assert.equal(billing.status, 200);
  assert.equal((billing.body ?? "").includes("Stripe-managed billing"), true);
  assert.equal((billing.body ?? "").includes("Upgrade with Stripe"), true);
  assert.equal((billing.body ?? "").includes("Free capacity tier"), true);
  assert.equal((billing.body ?? "").includes("Last Stripe sync"), true);
  assert.equal((billing.body ?? "").includes("Awaiting first Stripe webhook"), true);
  assert.equal((billing.body ?? "").includes("Stripe customer reference"), true);
  assert.equal((billing.body ?? "").includes("Created after the first hosted checkout"), true);
  assert.equal((billing.body ?? "").includes("Continue to Stripe Checkout for the Pro plan"), true);
  assert.equal((billing.body ?? "").includes('aria-describedby="billing-action-guidance"'), true);

  const billingIntent = await appConsoleRoute({
    method: "GET",
    path: "/app/billing?intent=upgrade&plan=pro",
    headers: sessionHeaders(session.token),
  });
  assert.equal(billingIntent.status, 200);
  assert.equal((billingIntent.body ?? "").includes("Checkout handoff ready"), true);
  assert.equal((billingIntent.body ?? "").includes("data-billing-auto-open=\"true\""), true);

  const trimmedBillingIntent = await appConsoleRoute({
    method: "GET",
    path: "/app/billing?intent=%20UPGRADE%20&plan=%20pro%20&checkout=%20SUCCESS%20",
    headers: sessionHeaders(session.token),
  });
  assert.equal(trimmedBillingIntent.status, 200);
  assert.equal((trimmedBillingIntent.body ?? "").includes("Checkout handoff ready"), true);
  assert.equal((trimmedBillingIntent.body ?? "").includes("Checkout started"), true);
  assert.equal((trimmedBillingIntent.body ?? "").includes("data-billing-auto-open=\"true\""), true);

  const unsupportedBillingIntent = await appConsoleRoute({
    method: "GET",
    path: "/app/billing?intent=upgrade&plan=enterprise",
    headers: sessionHeaders(session.token),
  });
  assert.equal(unsupportedBillingIntent.status, 400);
  assert.equal((unsupportedBillingIntent.body ?? "").includes("invalid"), true);

  const settings = await appConsoleRoute({
    method: "GET",
    path: "/app/settings",
    headers: sessionHeaders(session.token),
  });
  assert.equal(settings.status, 200);
  assert.equal((settings.body ?? "").includes("Workspace settings"), true);
  assert.equal((settings.body ?? "").includes("Console Workspace"), true);
});

test("app console overview reflects bootstrap first-integration links after project creation", async () => {
  const styleId = uniqueId("style");
  await seedPublishedStyle(styleId);
  const workspaceId = uniqueId("workspace");
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("style-gap")}@example.com`,
    workspaceId,
    workspaceName: "Style Gap Workspace",
  });
  const created = await createConsoleProject({
    name: "Project Without Published Style",
  }, workspaceId);

  const overview = await appConsoleRoute({
    method: "GET",
    path: "/app",
    headers: sessionHeaders(session.token),
  });
  assert.equal(overview.status, 200);
  assert.equal((overview.body ?? "").includes("Open project"), true);
  assert.equal((overview.body ?? "").includes(`/app/projects/${created.project.id}`), true);
  assert.equal((overview.body ?? "").includes("Open quickstart"), true);
  assert.equal((overview.body ?? "").includes("MapLibre style example"), true);
  assert.equal((overview.body ?? "").includes("needs_style"), false);
});

test("app console billing page varies the primary stripe action by mirrored state", async () => {
  const workspaceId = uniqueId("workspace");
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("billing-state")}@example.com`,
    workspaceId,
    workspaceName: "Billing Workspace",
  });

  await applyStripeWebhookEvent({
    type: "customer.subscription.created",
    workspaceId,
    stripeCustomerId: uniqueId("cus"),
    stripeSubscriptionId: uniqueId("sub"),
    planId: "pro",
    subscriptionStatus: "active",
    billingEmail: "billing@example.com",
    currentPeriodEnd: "2026-04-01T00:00:00.000Z",
    occurredAt: "2026-03-07T10:00:00.000Z",
  });
  const active = await appConsoleRoute({
    method: "GET",
    path: "/app/billing",
    headers: sessionHeaders(session.token),
  });
  assert.equal(active.status, 200);
  assert.equal((active.body ?? "").includes("Subscription active"), true);
  assert.equal((active.body ?? "").includes("Manage in Stripe"), true);
  assert.equal((active.body ?? "").includes("Renews"), true);
  assert.equal((active.body ?? "").includes("Mirrored Stripe state"), true);
  assert.equal((active.body ?? "").includes("mirrored from Stripe"), true);
  assert.equal((active.body ?? "").includes("billing@example.com"), true);
  assert.equal((active.body ?? "").includes("Stripe customer reference"), true);
  assert.equal((active.body ?? "").includes("Continue to the Stripe Customer Portal for the Pro plan"), true);

  const activeUpgradeIntent = await appConsoleRoute({
    method: "GET",
    path: "/app/billing?intent=upgrade&plan=pro",
    headers: sessionHeaders(session.token),
  });
  assert.equal(activeUpgradeIntent.status, 200);
  assert.equal((activeUpgradeIntent.body ?? "").includes("Checkout handoff ready"), true);
  assert.equal((activeUpgradeIntent.body ?? "").includes("Upgrade with Stripe"), true);
  assert.equal((activeUpgradeIntent.body ?? "").includes('data-billing-endpoint="/billing/checkout"'), true);
  assert.equal((activeUpgradeIntent.body ?? "").includes('data-billing-auto-open="true"'), true);

  await applyStripeWebhookEvent({
    type: "invoice.payment_failed",
    workspaceId,
    stripeCustomerId: uniqueId("cus"),
    stripeSubscriptionId: uniqueId("sub"),
    occurredAt: "2026-03-07T11:00:00.000Z",
  });
  const pastDue = await appConsoleRoute({
    method: "GET",
    path: "/app/billing",
    headers: sessionHeaders(session.token),
  });
  assert.equal(pastDue.status, 200);
  assert.equal((pastDue.body ?? "").includes("Payment method needs attention"), true);
  assert.equal((pastDue.body ?? "").includes("Open billing portal"), true);
  assert.equal((pastDue.body ?? "").includes("data-portal-endpoint=\"/billing/portal\""), true);
  assert.equal((pastDue.body ?? "").includes("past due"), true);

  await applyStripeWebhookEvent({
    type: "customer.subscription.updated",
    workspaceId,
    stripeCustomerId: uniqueId("cus"),
    stripeSubscriptionId: uniqueId("sub"),
    planId: "pro",
    subscriptionStatus: "active",
    billingEmail: "billing@example.com",
    currentPeriodEnd: "2026-04-01T00:00:00.000Z",
    cancelAtPeriodEnd: true,
    occurredAt: "2026-03-07T12:00:00.000Z",
  });
  const cancellationScheduled = await appConsoleRoute({
    method: "GET",
    path: "/app/billing",
    headers: sessionHeaders(session.token),
  });
  assert.equal(cancellationScheduled.status, 200);
  assert.equal((cancellationScheduled.body ?? "").includes("Cancellation scheduled"), true);
  assert.equal((cancellationScheduled.body ?? "").includes("Resume in Stripe"), true);
  assert.equal((cancellationScheduled.body ?? "").includes("Scheduled period end"), true);
});

test("app console billing intent normalizes supported plans and drops unsupported direct service input", async () => {
  const workspaceId = uniqueId("workspace");
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("billing-intent")}@example.com`,
    workspaceId,
    workspaceName: "Billing Intent Workspace",
  });

  const trimmedIntent = await getAppBillingPageWithIntent(session, {
    checkoutIntentPlanId: " PRO ",
    checkoutStatus: "success",
  });
  assert.equal(trimmedIntent.checkoutIntentPlanId, "pro");
  assert.equal(trimmedIntent.primaryAction.endpoint, "/billing/checkout");
  assert.equal(trimmedIntent.primaryAction.planId, "pro");

  const unsupportedIntent = await getAppBillingPageWithIntent(session, {
    checkoutIntentPlanId: "enterprise",
  });
  assert.equal(unsupportedIntent.checkoutIntentPlanId, undefined);
  assert.equal(unsupportedIntent.primaryAction.planId, "pro");
  assert.equal(unsupportedIntent.primaryAction.autoOpen, false);

  await assert.rejects(async () => {
    await getAppBillingPageWithIntent(session, null as unknown as Parameters<typeof getAppBillingPageWithIntent>[1]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppBillingPageWithIntent(session, 42 as unknown as Parameters<typeof getAppBillingPageWithIntent>[1]);
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppBillingPageWithIntent(session, {
      checkoutStatus: "pending" as unknown as "success",
    });
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppBillingPageWithIntent(session, {
      checkoutStatus: 42 as unknown as "success",
    });
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getAppBillingPageWithIntent(session, {
      checkoutIntentPlanId: 42 as unknown as string,
    });
  }, /APP_CONSOLE_PAGE_NOT_FOUND/);
});

test("app console service keeps direct billing intent checkout state on supported plans only", async () => {
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("billing-service")}@example.com`,
    workspaceId: uniqueId("workspace"),
    workspaceName: "Billing Service Workspace",
  });

  const supported = await getAppBillingPageWithIntent(session, {
    checkoutIntentPlanId: "pro",
  });
  assert.equal(supported.primaryAction.endpoint, "/billing/checkout");
  assert.equal(supported.primaryAction.planId, "pro");
  assert.equal(supported.primaryAction.autoOpen, true);

  const unsupported = await getAppBillingPageWithIntent(session, {
    checkoutIntentPlanId: "enterprise",
  });
  assert.equal(unsupported.primaryAction.endpoint, "/billing/checkout");
  assert.equal(unsupported.primaryAction.planId, "pro");
  assert.equal(unsupported.primaryAction.autoOpen, false);
  assert.equal(unsupported.checkoutIntentPlanId, undefined);
});

test("app console supports head, options, and not found pages", async () => {
  const session = await issueDemoSession({
    userId: uniqueId("user"),
    email: `${uniqueId("head")}@example.com`,
    workspaceId: uniqueId("workspace"),
    workspaceName: "Head Workspace",
  });
  const get = await appConsoleRoute({
    method: "GET",
    path: "/app/styles",
    headers: sessionHeaders(session.token),
  });
  const head = await appConsoleRoute({
    method: "HEAD",
    path: "/app/styles",
    headers: sessionHeaders(session.token),
  });
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers["content-length"], get.headers["content-length"]);

  const options = await appConsoleRoute({
    method: "OPTIONS",
    path: "/app/styles",
    headers: sessionHeaders(session.token),
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers.allow, "GET,HEAD,OPTIONS");

  const missing = await appConsoleRoute({
    method: "GET",
    path: "/app/missing",
    headers: sessionHeaders(session.token),
  });
  assert.equal(missing.status, 404);
  assert.equal((missing.body ?? "").includes("Page not found"), true);
});

test("app console renders all new settings pages and notifications feed", async () => {
  const session = await issueDemoSession({
    userId: uniqueId("settings-user"),
    email: `${uniqueId("settings-email")}@example.com`,
    workspaceId: uniqueId("settings-workspace"),
    workspaceName: "Settings Integrated Workspace",
  });

  const headers = sessionHeaders(session.token);

  const members = await appConsoleRoute({ method: "GET", path: "/app/settings/members", headers });
  assert.equal(members.status, 200);
  assert.equal((members.body ?? "").includes("Members"), true);
  assert.equal((members.body ?? "").includes("Invite new member"), true);

  const security = await appConsoleRoute({ method: "GET", path: "/app/settings/security", headers });
  assert.equal(security.status, 200);
  assert.equal((security.body ?? "").includes("Security settings"), true);
  assert.equal((security.body ?? "").includes("Active sessions"), true);
  assert.equal((security.body ?? "").includes("Individual session revocation is not available here yet"), true);

  const mfa = await appConsoleRoute({ method: "GET", path: "/app/settings/security/mfa", headers });
  assert.equal(mfa.status, 200);
  assert.equal((mfa.body ?? "").includes("TOTP authenticator setup"), true);
  assert.equal((mfa.body ?? "").includes("Recovery codes"), true);
  assert.equal((mfa.body ?? "").includes("Start MFA setup"), true);
  assert.equal((mfa.body ?? "").includes("No MFA secret has been created from this page load"), true);

  const password = await appConsoleRoute({ method: "GET", path: "/app/settings/security/password", headers });
  assert.equal(password.status, 200);
  assert.equal((password.body ?? "").includes("Change password"), true);

  const account = await appConsoleRoute({ method: "GET", path: "/app/settings/account", headers });
  assert.equal(account.status, 200);
  assert.equal((account.body ?? "").includes("Workspace details"), true);
  assert.equal((account.body ?? "").includes("Access ends immediately"), true);

  const exportData = await appConsoleRoute({ method: "GET", path: "/app/settings/account/export", headers });
  assert.equal(exportData.status, 200);
  assert.equal((exportData.body ?? "").includes("Export workspace data"), true);

  const deleteWorkspace = await appConsoleRoute({ method: "GET", path: "/app/settings/account/delete", headers });
  assert.equal(deleteWorkspace.status, 200);
  assert.equal((deleteWorkspace.body ?? "").includes("Delete workspace"), true);
  assert.equal((deleteWorkspace.body ?? "").includes("schedules permanent deletion in 30 days"), true);
  assert.equal((deleteWorkspace.body ?? "").includes("Schedule workspace deletion"), true);

  const notifications = await appConsoleRoute({ method: "GET", path: "/app/notifications", headers });
  assert.equal(notifications.status, 200);
  assert.equal((notifications.body ?? "").includes("Workspace notifications"), true);
  assert.equal((notifications.body ?? "").includes('href="/app/notifications" aria-current="page"'), true);
});
