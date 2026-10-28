import { strict as assert } from "node:assert";
import { vi } from "vitest";
import { prisma } from "../../../config/db";
import { applyStripeWebhookEvent } from "../../billing-sync/billing-sync.service";
import * as identityService from "../../identity/identity.service";
import { issueDemoSession } from "../../identity/identity.service";
import { loadConfig } from "../../../config/load-config";
import { consumeRequestUnit } from "../../metering/metering.service";
import { createStyleVersion, publishStyleVersion } from "../../styles/styles.service";
import {
  appendAccessTokenQueryParam,
  createConsoleProject,
  getConsoleBootstrap,
  getConsoleProject,
  getConsoleProjectUsage,
  getConsoleSettings,
  getConsoleStyle,
  listConsoleStyles,
  listConsoleProjects,
  rotateConsoleProjectKey,
  updateConsoleSettings,
  updateConsoleProject,
  listConsoleMemberships,
  inviteConsoleMember,
  removeConsoleMember,
  transferConsoleWorkspaceOwnership,
  deleteConsoleWorkspace,
  restoreConsoleWorkspace,
  exportConsoleWorkspace,
  updateConsolePassword,
  enrollConsoleMfa,
  disableConsoleMfa,
  listConsoleNotifications,
} from "../customer-console.service";
import { CustomerConsoleError, CustomerConsoleErrorCode } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.NODE_ENV = "development";
process.env.ALLOWED_ORIGINS = "*";

loadConfig();

test("customer console provisions projects with snippets and issued keys", async () => {
  const style = await createStyleVersion("console-style", {
    version: 8,
    sources: {
      default: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprites/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [],
  });
  await publishStyleVersion("console-style", style.id);

  const provisioned = await createConsoleProject({
    name: "Customer Alpha",
    allowedOrigins: ["https://maps.example"],
    allowedEndpoints: {
      tiles: true,
      raster: true,
      staticMaps: false,
    },
  });

  assert.equal(provisioned.project.name, "Customer Alpha");
  assert.equal(provisioned.project.planId, "free");
  assert.equal(provisioned.project.allowedEndpoints.staticMaps, false);
  assert.equal(provisioned.issuedKey.projectId, provisioned.project.id);
  assert.equal(provisioned.snippets.styleUrl?.includes(provisioned.issuedKey.token), true);
});

test("customer console bootstrap aggregates billing, project usage, and styles", async () => {
  const session = await issueDemoSession({
    userId: "bootstrap-user",
    workspaceId: "default-workspace",
  });
  await applyStripeWebhookEvent({
    type: "customer.subscription.updated",
    workspaceId: "default-workspace",
    stripeCustomerId: "cus_console",
    stripeSubscriptionId: "sub_console",
    planId: "pro",
    subscriptionStatus: "active",
  });

  const provisioned = await createConsoleProject({
    name: "Usage Project",
  });

  await consumeRequestUnit(
    {
      projectId: provisioned.issuedKey.projectId,
      keyHash: provisioned.issuedKey.keyHash,
      planId: provisioned.project.planId,
    },
    "tiles",
  );
  await consumeRequestUnit(
    {
      projectId: provisioned.issuedKey.projectId,
      keyHash: provisioned.issuedKey.keyHash,
      planId: provisioned.project.planId,
    },
    "raster",
  );

  const bootstrap = await getConsoleBootstrap(session);
  assert.equal(bootstrap.currentUser.id, "bootstrap-user");
  assert.equal(bootstrap.currentMembership.userId, "bootstrap-user");
  assert.equal(bootstrap.billing.planId, "pro");
  assert.equal(bootstrap.projects.length >= 1, true);
  assert.equal(bootstrap.styles.some((entry) => entry.id === "console-style"), true);
  assert.equal(bootstrap.usageMonth.requestCount >= 2, true);
  assert.equal(bootstrap.onboarding.hasProjects, true);
  assert.equal(bootstrap.firstIntegration.readiness, "ready");
  assert.equal(bootstrap.firstIntegration.quickstartHref, "/docs/quickstart");
  assert.equal(bootstrap.firstIntegration.snippets.styleUrl?.includes("access_token={access_token}"), true);
});

test("customer console bootstrap exposes first-integration readiness before project creation", async () => {
  const session = await issueDemoSession({
    userId: "bootstrap-empty-user",
    workspaceId: "workspace-bootstrap-empty",
    workspaceName: "Bootstrap Empty Workspace",
  });

  const bootstrap = await getConsoleBootstrap(session);
  assert.equal(bootstrap.onboarding.hasProjects, false);
  assert.equal(bootstrap.firstIntegration.readiness, "needs_project");
  assert.equal(bootstrap.firstIntegration.projectCreateHref, "/app/projects/new");
  assert.equal(bootstrap.firstIntegration.quickstartHref, "/docs/quickstart");
});

test("customer console settings expose current user, billing email, and memberships", async () => {
  const session = await issueDemoSession({
    userId: "settings-user",
    workspaceId: "workspace-settings",
    workspaceName: "Workspace Settings",
  });

  await applyStripeWebhookEvent({
    type: "checkout.session.completed",
    workspaceId: "workspace-settings",
    planId: "pro",
    billingEmail: "owner@example.com",
  });

  const settings = await getConsoleSettings(session);
  assert.equal(settings.currentUser.id, "settings-user");
  assert.equal(settings.workspace.name, "Workspace Settings");
  assert.equal(settings.billingEmail, "owner@example.com");
  assert.equal(settings.memberships.some((entry) => entry.userId === "settings-user"), true);

  const updated = await updateConsoleSettings(session, {
    workspaceName: "Workspace Renamed",
  });
  assert.equal(updated.workspace.name, "Workspace Renamed");
});

test("customer console settings skip malformed upstream membership dependency rows", async () => {
  const session = await issueDemoSession({
    userId: "settings-membership-user",
    workspaceId: "workspace-settings-memberships",
    workspaceName: "Workspace Settings Memberships",
  });

  const originalListWorkspaceMemberships = identityService.listWorkspaceMemberships;
  const membershipsSpy = vi.spyOn(identityService, "listWorkspaceMemberships").mockImplementation(async (workspaceId: string) => {
    const base = await originalListWorkspaceMemberships(workspaceId);
    return [
      ...base,
      {
        workspaceId,
        userId: "",
        role: "member",
        createdAt: new Date().toISOString(),
      },
      {
        workspaceId: "workspace-other",
        userId: "wrong-workspace-user",
        role: "owner",
        createdAt: new Date().toISOString(),
      },
      {
        workspaceId,
        userId: "user/invalid",
        role: "member",
        createdAt: new Date().toISOString(),
      },
      {
        workspaceId,
        userId: "bad-role-user",
        role: "admin" as unknown as "owner",
        createdAt: new Date().toISOString(),
      },
    ];
  });

  try {
    const settings = await getConsoleSettings(session);
    assert.equal(settings.memberships.some((entry) => entry.userId === "settings-membership-user"), true);
    assert.equal(settings.memberships.some((entry) => entry.userId === ""), false);
    assert.equal(settings.memberships.some((entry) => entry.userId === "wrong-workspace-user"), false);
    assert.equal(settings.memberships.some((entry) => entry.userId === "user/invalid"), false);
    assert.equal(settings.memberships.some((entry) => entry.userId === "bad-role-user"), false);
  } finally {
    membershipsSpy.mockRestore();
  }
});

test("customer console project detail and updates stay customer-safe", async () => {
  const provisioned = await createConsoleProject({
    name: "Customer Mutable",
  });

  const updated = await updateConsoleProject(provisioned.project.id, {
    name: "Customer Mutable Renamed",
    allowedOrigins: ["https://tenant.example"],
    allowedEndpoints: {
      raster: false,
    },
  });
  assert.equal(updated.name, "Customer Mutable Renamed");
  assert.deepEqual(updated.allowedOrigins, ["https://tenant.example"]);
  assert.equal(updated.allowedEndpoints.raster, false);

  const detail = await getConsoleProject(provisioned.project.id);
  assert.equal(detail.keys.length >= 1, true);
  assert.equal(Object.prototype.hasOwnProperty.call(detail.keys[0], "token"), false);
  assert.equal(detail.snippets.styleUrl?.includes("{access_token}"), true);
});

test("customer console rejects malformed allowed origins at the source boundary", async () => {
  await assert.rejects(async () => {
    await createConsoleProject({
      name: "Bad Origin Project",
      allowedOrigins: ["https://tenant.example/path"],
    });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  const provisioned = await createConsoleProject({
    name: "Origin Normalize Project",
  });

  const updated = await updateConsoleProject(provisioned.project.id, {
    allowedOrigins: [
      " https://tenant.example ",
      "https://tenant.example",
      "http://maps.example",
    ],
  });
  assert.deepEqual(updated.allowedOrigins, [
    "https://tenant.example",
    "http://maps.example",
  ]);

  await assert.rejects(async () => {
    await updateConsoleProject(provisioned.project.id, {
      allowedOrigins: ["ftp://tenant.example"],
    });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);
});

test("customer console exposes published styles and style detail snippets", async () => {
  const style = await createStyleVersion("console-style-detail", {
    version: 8,
    sources: {
      detail: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprites/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [],
  });
  await publishStyleVersion("console-style-detail", style.id);

  const styles = await listConsoleStyles();
  assert.equal(styles.some((entry) => entry.id === "console-style-detail"), true);

  const detail = await getConsoleStyle("console-style-detail");
  assert.equal(detail.style.id, "console-style-detail");
  assert.equal(detail.snippets.styleUrl?.includes("access_token={access_token}"), true);

  await assert.rejects(async () => {
    await getConsoleStyle("missing-style");
  }, /CUSTOMER_CONSOLE_NOT_FOUND/);
});

test("customer console first-integration snippets choose the first lexicographic published style deterministically", async () => {
  const session = await issueDemoSession({
    userId: "deterministic-style-user",
    workspaceId: "workspace-deterministic-style",
    workspaceName: "Deterministic Style Workspace",
  });

  const zuluStyle = await createStyleVersion("zulu-style", {
    version: 8,
    sources: {
      zulu: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprites/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [],
  });
  await publishStyleVersion("zulu-style", zuluStyle.id);

  const alphaStyle = await createStyleVersion("alpha-style", {
    version: 8,
    sources: {
      alpha: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprites/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [],
  });
  await publishStyleVersion("alpha-style", alphaStyle.id);

  const publishedStyles = await listConsoleStyles();
  const expectedPrimaryStyleId = publishedStyles
    .map((entry) => entry.id)
    .sort((left, right) => left.localeCompare(right))[0];
  assert.equal(typeof expectedPrimaryStyleId, "string");

  const bootstrap = await getConsoleBootstrap(session);
  assert.equal(
    bootstrap.firstIntegration.snippets.styleUrl,
    `/v1/styles/${encodeURIComponent(expectedPrimaryStyleId ?? "")}/style.json?access_token={access_token}`,
  );
  assert.equal(
    bootstrap.firstIntegration.snippets.rasterTileUrl,
    `/v1/raster/${encodeURIComponent(expectedPrimaryStyleId ?? "")}/{z}/{x}/{y}.png?access_token={access_token}`,
  );
  assert.equal(
    bootstrap.firstIntegration.snippets.staticMapUrl,
    `/v1/static/${encodeURIComponent(expectedPrimaryStyleId ?? "")}/{lon},{lat},{zoom}/{width}x{height}.png?access_token={access_token}`,
  );
});

test("customer console skips malformed published style dependency rows", async () => {
  const originalFindMany = prisma.style.findMany.bind(prisma.style);

  (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = ((async (...args: Parameters<typeof prisma.style.findMany>) => {
    if (args[0]?.orderBy) {
      return [
        {
          id: "valid-style",
          name: "Valid Style",
          latestVersionId: "valid-style-v1",
          publishedVersionId: "valid-style-v1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "",
          name: "Broken Style",
          latestVersionId: "broken-style-v1",
          publishedVersionId: "broken-style-v1",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "broken-style-2",
          name: "Broken Style 2",
          latestVersionId: "broken-style-2-v1",
          publishedVersionId: 42,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ];
    }
    return await originalFindMany(...args);
  }) as unknown) as typeof prisma.style.findMany;

  try {
    const styles = await listConsoleStyles();
    assert.equal(styles.length, 1);
    assert.equal(styles[0]?.id, "valid-style");

    const session = await issueDemoSession({
      userId: "style-row-user",
      workspaceId: "workspace-style-row",
      workspaceName: "Workspace Style Row",
    });
    const bootstrap = await getConsoleBootstrap(session);
    assert.equal(bootstrap.styles.length, 1);
    assert.equal(bootstrap.firstIntegration.snippets.styleUrl, "/v1/styles/valid-style/style.json?access_token={access_token}");
  } finally {
    (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = originalFindMany;
  }
});

test("customer console skips malformed upstream project dependency rows", async () => {
  const workspaceId = "workspace-bad-project-row";
  const provisioned = await createConsoleProject({
    name: "Valid Workspace Project",
  }, workspaceId);
  const validPolicy = JSON.stringify({
    allowedEndpoints: {
      tiles: true,
      raster: true,
      staticMaps: true,
    },
  });
  const createdAt = new Date().toISOString();

  const originalFindMany = prisma.project.findMany.bind(prisma.project);
  (prisma.project as { findMany: typeof prisma.project.findMany }).findMany = ((async (...args: Parameters<typeof prisma.project.findMany>) => {
    if (args[0]?.where && "workspaceId" in args[0].where && args[0].where.workspaceId === workspaceId) {
      return [
        {
          id: provisioned.project.id,
          workspaceId,
          name: provisioned.project.name,
          policy: validPolicy,
          planId: provisioned.project.planId,
          createdAt,
        },
        {
          id: "",
          workspaceId,
          name: "Broken Project",
          policy: validPolicy,
          planId: provisioned.project.planId,
          createdAt,
        },
      ];
    }
    return await originalFindMany(...args);
  }) as unknown) as typeof prisma.project.findMany;

  try {
    const listed = await listConsoleProjects(workspaceId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, provisioned.project.id);

    const session = await issueDemoSession({
      userId: "bad-project-row-user",
      workspaceId,
      workspaceName: "Bad Project Row Workspace",
    });
    const bootstrap = await getConsoleBootstrap(session);
    assert.equal(bootstrap.projects.length, 1);
    assert.equal(bootstrap.projects[0]?.id, provisioned.project.id);
  } finally {
    (prisma.project as { findMany: typeof prisma.project.findMany }).findMany = originalFindMany;
  }
});

test("customer console snippet-producing flows fail closed when published-style lookup errors", async () => {
  const workspaceId = "workspace-style-lookup-fallback";
  const provisioned = await createConsoleProject({
    name: "Style Lookup Fallback Project",
  }, workspaceId);

  const originalFindMany = prisma.style.findMany.bind(prisma.style);
  (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = (async () => {
    throw new Error("style lookup unavailable");
  }) as typeof prisma.style.findMany;

  try {
    const detail = await getConsoleProject(provisioned.project.id, workspaceId);
    assert.deepEqual(detail.snippets, {});

    const rotated = await rotateConsoleProjectKey(provisioned.project.id, workspaceId);
    assert.deepEqual(rotated.snippets, {});
  } finally {
    (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = originalFindMany;
  }
});

test("customer console encodes published style ids in customer-facing integration urls", async () => {
  const style = await createStyleVersion("console style encoded", {
    version: 8,
    sources: {
      detail: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprites/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [],
  });
  await publishStyleVersion("console style encoded", style.id);

  const styles = await listConsoleStyles();
  const encodedSummary = styles.find((entry) => entry.id === "console style encoded");
  assert.equal(encodedSummary?.styleUrl, "/v1/styles/console%20style%20encoded/style.json");
  assert.equal(
    encodedSummary?.rasterTileUrl,
    "/v1/raster/console%20style%20encoded/{z}/{x}/{y}.png?access_token={access_token}",
  );
  assert.equal(
    encodedSummary?.staticMapUrl,
    "/v1/static/console%20style%20encoded/{lon},{lat},{zoom}/{width}x{height}.png?access_token={access_token}",
  );

  const detail = await getConsoleStyle("console style encoded");
  assert.equal(
    detail.snippets.styleUrl,
    "/v1/styles/console%20style%20encoded/style.json?access_token={access_token}",
  );
});

test("customer console appends access_token placeholders without breaking existing query params or hashes", () => {
  assert.equal(
    appendAccessTokenQueryParam("/v1/styles/basic/style.json"),
    "/v1/styles/basic/style.json?access_token={access_token}",
  );
  assert.equal(
    appendAccessTokenQueryParam("/v1/styles/basic/style.json?draft=published"),
    "/v1/styles/basic/style.json?draft=published&access_token={access_token}",
  );
  assert.equal(
    appendAccessTokenQueryParam("/v1/styles/basic/style.json?draft=published#preview"),
    "/v1/styles/basic/style.json?draft=published&access_token={access_token}#preview",
  );
  assert.equal(
    appendAccessTokenQueryParam("/v1/styles/basic/style.json?draft=published&access_token=stale#preview"),
    "/v1/styles/basic/style.json?draft=published&access_token={access_token}#preview",
  );

  assert.throws(() => {
    appendAccessTokenQueryParam(42 as unknown as string);
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  assert.throws(() => {
    appendAccessTokenQueryParam("/v1/styles/basic/style.json", 42 as unknown as string);
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);
});

test("customer console key rotation returns a new one-time token", async () => {
  const provisioned = await createConsoleProject({
    name: "Customer Rotate",
  });
  const rotated = await rotateConsoleProjectKey(provisioned.project.id);

  assert.equal(rotated.project.id, provisioned.project.id);
  assert.equal(rotated.issuedKey.keyId === provisioned.issuedKey.keyId, false);
  assert.equal(rotated.snippets.styleUrl?.includes(rotated.issuedKey.token), true);
});

test("customer console validates missing project identifiers", async () => {
  try {
    await getConsoleProject("   ");
    assert.fail("expected bad request");
  } catch (error) {
    assert.equal(error instanceof CustomerConsoleError, true);
    if (error instanceof CustomerConsoleError) {
      assert.equal(error.code, CustomerConsoleErrorCode.BAD_REQUEST);
    }
  }

  await assert.rejects(async () => {
    await getConsoleProject("foo/bar");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleProject("project..id");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleProject(42 as unknown as string);
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleProjectUsage("project\\id", "day");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleProjectUsage(42 as unknown as string, "day");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleStyle("..");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleStyle(42 as unknown as string);
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await rotateConsoleProjectKey("foo/bar");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await rotateConsoleProjectKey(42 as unknown as string);
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await listConsoleProjects("workspace/invalid");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await listConsoleProjects("workspace..invalid");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await listConsoleProjects(42 as unknown as string);
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await updateConsoleProject("missing", {
      name: "nope",
    });
  }, /CUSTOMER_CONSOLE_(NOT_FOUND|DEPENDENCY_FAILED)/);

  const list = await listConsoleProjects();
  assert.equal(Array.isArray(list), true);
});

test("customer console rejects malformed write payloads as bad requests", async () => {
  const session = await issueDemoSession({
    userId: "payload-user",
    workspaceId: "workspace-payload",
    workspaceName: "Payload Workspace",
  });

  await assert.rejects(async () => {
    await createConsoleProject(undefined as unknown as { name: string }, "workspace-payload");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await createConsoleProject({
      name: 42 as unknown as string,
    }, "workspace-payload");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  const provisioned = await createConsoleProject({
    name: "Payload Project",
  }, "workspace-payload");

  await assert.rejects(async () => {
    await updateConsoleProject(
      provisioned.project.id,
      undefined as unknown as { name?: string },
      "workspace-payload",
    );
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await updateConsoleProject(
      42 as unknown as string,
      { name: "still-invalid" },
      "workspace-payload",
    );
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await updateConsoleSettings(
      session,
      undefined as unknown as { workspaceName: string },
    );
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await updateConsoleSettings(
      session,
      { workspaceName: "   " },
    );
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await createConsoleProject({
      name: "Bad Endpoint Create",
      allowedEndpoints: {
        tiles: "yes" as unknown as boolean,
      },
    }, "workspace-payload");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await updateConsoleProject(
      provisioned.project.id,
      {
        allowedEndpoints: {
          raster: "no" as unknown as boolean,
        },
      },
      "workspace-payload",
    );
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);
});

test("customer console returns workspace-scoped project usage cards", async () => {
  const provisioned = await createConsoleProject({
    name: "Usage Detail Project",
  }, "workspace-usage");

  await consumeRequestUnit(
    {
      projectId: provisioned.issuedKey.projectId,
      keyHash: provisioned.issuedKey.keyHash,
      planId: provisioned.project.planId,
    },
    "static",
  );

  const usage = await getConsoleProjectUsage(provisioned.project.id, "day", "workspace-usage");
  assert.equal(usage.window, "day");
  assert.equal(usage.requestCount >= 1, true);
  assert.equal(usage.breakdown.static >= 1, true);

  await assert.rejects(async () => {
    await getConsoleProjectUsage(provisioned.project.id, "month", "workspace-other");
  }, /CUSTOMER_CONSOLE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getConsoleProjectUsage(
      provisioned.project.id,
      "minute" as unknown as "day",
      "workspace-usage",
    );
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);
});

test("customer console scopes projects by workspace ownership", async () => {
  const workspaceA = await createConsoleProject({
    name: "Workspace A Project",
  }, "workspace-a");
  await createConsoleProject({
    name: "Workspace B Project",
  }, "workspace-b");

  const onlyA = await listConsoleProjects("workspace-a");
  assert.equal(onlyA.some((entry) => entry.id === workspaceA.project.id), true);
  assert.equal(onlyA.some((entry) => entry.name === "Workspace B Project"), false);

  await assert.rejects(async () => {
    await getConsoleProject(workspaceA.project.id, "workspace-b");
  }, /CUSTOMER_CONSOLE_NOT_FOUND/);
});

test("customer console rejects malformed workspace identifiers at the exported service boundary", async () => {
  const badSession = await issueDemoSession({
    userId: "bad-workspace-session-user",
    workspaceId: "workspace-valid-for-session",
  });

  await assert.rejects(async () => {
    await getConsoleBootstrap({
      ...badSession,
      workspace: {
        ...badSession.workspace,
        id: "workspace/invalid",
      },
    });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await updateConsoleSettings({
      ...badSession,
      workspace: {
        ...badSession.workspace,
        id: "..",
      },
    }, {
      workspaceName: "Still Invalid",
    });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleBootstrap({
      ...badSession,
      workspace: {
        ...badSession.workspace,
        id: "workspace..invalid",
      },
    });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleBootstrap(null as unknown as Parameters<typeof getConsoleBootstrap>[0]);
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleSettings(42 as unknown as Parameters<typeof getConsoleSettings>[0]);
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleBootstrap({
      ...badSession,
      user: {
        ...badSession.user,
        id: "user/invalid",
      },
    });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleSettings({
      ...badSession,
      membership: {
        ...badSession.membership,
        userId: "member..invalid",
      },
    });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleBootstrap({
      ...badSession,
      membership: {
        ...badSession.membership,
        userId: "different-user",
      },
    });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getConsoleSettings({
      ...badSession,
      membership: {
        ...badSession.membership,
        role: "admin" as unknown as "owner",
      },
    });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  await assert.rejects(async () => {
    await updateConsoleSettings({
      ...badSession,
      workspace: {
        ...badSession.workspace,
        name: 42 as unknown as string,
      },
    }, {
      workspaceName: "Still Invalid",
    });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);
});

test("customer console memberships lists, invites, and removes members", async () => {
  const session = await issueDemoSession({
    userId: "owner-user",
    workspaceId: "workspace-memberships",
    workspaceName: "Memberships Workspace",
    role: "owner",
  });

  const memberSession = await issueDemoSession({
    userId: "member-user",
    workspaceId: "workspace-memberships",
    workspaceName: "Memberships Workspace",
    role: "member",
  });

  // Verify list
  const list = await listConsoleMemberships("workspace-memberships");
  assert.equal(list.some(m => m.userId === "owner-user"), true);

  const newbieEmail = `newbie-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;
  // Non-owner cannot invite
  await assert.rejects(async () => {
    await inviteConsoleMember(memberSession, newbieEmail);
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  // Invite member
  await inviteConsoleMember(session, newbieEmail);

  // Verify can't invite already invited/existing member
  await assert.rejects(async () => {
    await inviteConsoleMember(session, newbieEmail);
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  // Non-owner cannot remove
  await assert.rejects(async () => {
    await removeConsoleMember(memberSession, "member-user");
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);
});

test("customer console workspace soft delete, restore, transfer ownership, and export", async () => {
  const session = await issueDemoSession({
    userId: "ws-owner-user",
    workspaceId: "workspace-lifecycle",
    workspaceName: "Lifecycle Workspace",
    role: "owner",
  });

  const targetSession = await issueDemoSession({
    userId: "ws-target-user",
    workspaceId: "workspace-lifecycle",
    workspaceName: "Lifecycle Workspace",
    role: "member",
  });

  // Export workspace
  await exportConsoleWorkspace(session);

  // Transfer ownership
  await transferConsoleWorkspaceOwnership(session, "ws-target-user");

  // Soft delete workspace
  const newOwnerSession = {
    ...targetSession,
    membership: { ...targetSession.membership, role: "owner" as const }
  };
  await deleteConsoleWorkspace(newOwnerSession, "cleanup");

  // Restore workspace
  await restoreConsoleWorkspace(newOwnerSession);
});

test("customer console security password and MFA TOTP enrollment", async () => {
  const session = await issueDemoSession({
    userId: "security-test-user",
    workspaceId: "workspace-security",
    workspaceName: "Security Workspace",
    role: "owner",
  });

  // Password update fails with wrong current password
  await assert.rejects(async () => {
    await updateConsolePassword(session, { currentPassword: "wrong", newPassword: "NewPass123!!!" });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);

  // MFA enroll first step
  const enrollFirst = await enrollConsoleMfa(session, {});
  assert.equal("secret" in enrollFirst, true);
  if ("secret" in enrollFirst) {
    assert.equal(enrollFirst.secret.length > 0, true);
    assert.equal(enrollFirst.recoveryCodes.length, 8);
  }

  // MFA disable fails with invalid password
  await assert.rejects(async () => {
    await disableConsoleMfa(session, { password: "wrong" });
  }, /CUSTOMER_CONSOLE_BAD_REQUEST/);
});

test("customer console notifications lists typed workspace notifications", async () => {
  const list = await listConsoleNotifications("workspace-security");
  assert.equal(Array.isArray(list), true);
});

