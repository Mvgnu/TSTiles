import { strict as assert } from "node:assert";
import { loadConfig } from "../../../config/load-config";
import { identityDemoSignInRoute } from "../../identity/routes/demo-sign-in-route";
import { createStyleVersion, publishStyleVersion } from "../../styles/styles.service";
import { customerConsoleBootstrapRoute } from "../routes/bootstrap-route";
import { customerConsoleProjectRoute } from "../routes/project-route";
import { customerConsoleProjectsRoute } from "../routes/projects-route";
import { customerConsoleSettingsRoute } from "../routes/settings-route";
import { customerConsoleStylesRoute } from "../routes/styles-route";
import { customerConsoleMembershipsRoute } from "../routes/memberships-route";
import { customerConsoleWorkspaceRoute } from "../routes/workspace-route";
import { customerConsoleSecurityRoute } from "../routes/security-route";
import { customerConsoleNotificationsRoute } from "../routes/notifications-route";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.NODE_ENV = "development";
process.env.ALLOWED_ORIGINS = "*";

loadConfig();

async function issueRouteSession(workspaceId = "route-workspace"): Promise<string> {
  const response = await identityDemoSignInRoute({
    method: "POST",
    path: "/auth/demo/sign-in",
    body: {
      userId: `user-${workspaceId}`,
      workspaceId,
    },
  });
  const body = JSON.parse(response.body ?? "{}") as { token?: string };
  return body.token ?? "";
}

test("customer console routes expose bootstrap and project lifecycle payloads", async () => {
  const style = await createStyleVersion("route-style", {
    version: 8,
    sources: {
      map: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprites/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [],
  });
  await publishStyleVersion("route-style", style.id);
  const token = await issueRouteSession();

  const bootstrap = await customerConsoleBootstrapRoute({
    method: "GET",
    path: "/app-api/bootstrap",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(bootstrap.status, 200);
  const bootstrapBody = JSON.parse(bootstrap.body ?? "{}") as {
    currentUser?: { id?: string };
    firstIntegration?: { readiness?: string; quickstartHref?: string };
  };
  assert.equal(bootstrapBody.currentUser?.id, "user-route-workspace");
  assert.equal(bootstrapBody.firstIntegration?.readiness, "needs_project");
  assert.equal(bootstrapBody.firstIntegration?.quickstartHref, "/docs/quickstart");

  const created = await customerConsoleProjectsRoute({
    method: "POST",
    path: "/app-api/projects",
    headers: {
      "x-session-token": token,
    },
    body: {
      name: "Route Project",
    },
  });
  assert.equal(created.status, 201);
  const createdBody = JSON.parse(created.body ?? "{}") as { project?: { id?: string } };
  const projectId = createdBody.project?.id ?? "";
  assert.equal(projectId.length > 0, true);

  const detail = await customerConsoleProjectRoute({
    method: "GET",
    path: `/app-api/projects/${projectId}`,
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(detail.status, 200);

  const bootstrapAfterProject = await customerConsoleBootstrapRoute({
    method: "GET",
    path: "/app-api/bootstrap",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(bootstrapAfterProject.status, 200);
  const bootstrapAfterProjectBody = JSON.parse(bootstrapAfterProject.body ?? "{}") as {
    firstIntegration?: { readiness?: string; projectCreateHref?: string; snippets?: { styleUrl?: string } };
  };
  assert.equal(bootstrapAfterProjectBody.firstIntegration?.readiness, "ready");
  assert.equal((bootstrapAfterProjectBody.firstIntegration?.projectCreateHref ?? "").includes("/app/projects/"), true);
  assert.equal((bootstrapAfterProjectBody.firstIntegration?.snippets?.styleUrl ?? "").includes("access_token={access_token}"), true);

  const rotated = await customerConsoleProjectRoute({
    method: "POST",
    path: `/app-api/projects/${projectId}/keys/rotate`,
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(rotated.status, 200);

  const usage = await customerConsoleProjectRoute({
    method: "GET",
    path: `/app-api/projects/${projectId}/usage?window=month`,
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(usage.status, 200);

  const trimmedUsageWindow = await customerConsoleProjectRoute({
    method: "GET",
    path: `/app-api/projects/${projectId}/usage?window=%20month%20`,
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(trimmedUsageWindow.status, 200);

  const styles = await customerConsoleStylesRoute({
    method: "GET",
    path: "/app-api/styles",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(styles.status, 200);
  const stylesBody = JSON.parse(styles.body ?? "[]") as Array<{ id?: string }>;
  assert.equal(Array.isArray(stylesBody), true);
  assert.equal(stylesBody.some((entry) => entry.id === "route-style"), true);

  const styleDetail = await customerConsoleStylesRoute({
    method: "GET",
    path: "/app-api/styles/route-style",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(styleDetail.status, 200);
});

test("customer console routes handle options and invalid paths", async () => {
  const token = await issueRouteSession("invalid-route-shape-workspace");
  const options = await customerConsoleProjectsRoute({
    method: "OPTIONS",
    path: "/app-api/projects",
    headers: {},
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers["access-control-allow-headers"].includes("x-session-token"), true);
  assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-user-id"), false);
  assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-workspace-id"), false);

  const missing = await customerConsoleBootstrapRoute({
    method: "GET",
    path: "/app-api/missing",
    headers: {},
  });
  assert.equal(missing.status, 404);

  const unauthorized = await customerConsoleProjectsRoute({
    method: "GET",
    path: "/app-api/projects",
    headers: {},
  });
  assert.equal(unauthorized.status, 401);

  const malformedBootstrap = await customerConsoleBootstrapRoute(
    null as unknown as Parameters<typeof customerConsoleBootstrapRoute>[0],
  );
  assert.equal(malformedBootstrap.status, 400);

  const malformedProjects = await customerConsoleProjectsRoute({
    method: "GET",
    path: 42 as unknown as string,
    headers: {},
  });
  assert.equal(malformedProjects.status, 400);

  const malformedProjectDetail = await customerConsoleProjectRoute({
    method: 42 as unknown as "GET",
    path: "/app-api/projects/example-project",
    headers: {},
  });
  assert.equal(malformedProjectDetail.status, 400);

  const malformedProjectsBody = await customerConsoleProjectsRoute({
    method: "POST",
    path: "/app-api/projects",
    headers: {
      "x-session-token": token,
    },
    body: "Route Project" as unknown as Record<string, unknown>,
  });
  assert.equal(malformedProjectsBody.status, 400);

  const malformedProjectPatchBody = await customerConsoleProjectRoute({
    method: "PATCH",
    path: "/app-api/projects/example-project",
    headers: {
      "x-session-token": token,
    },
    body: "rename" as unknown as Record<string, unknown>,
  });
  assert.equal(malformedProjectPatchBody.status, 400);

  const malformedSettings = await customerConsoleSettingsRoute({
    method: "GET",
    path: "/app-api/settings",
    headers: {
      "x-session-token": 42 as unknown as string,
    },
  });
  assert.equal(malformedSettings.status, 400);

  const malformedSettingsBody = await customerConsoleSettingsRoute({
    method: "PATCH",
    path: "/app-api/settings",
    headers: {
      "x-session-token": token,
    },
    body: "workspace-name" as unknown as Record<string, unknown>,
  });
  assert.equal(malformedSettingsBody.status, 400);

  const malformedStyles = await customerConsoleStylesRoute({
    method: "GET",
    path: "/app-api/styles",
    headers: {
      "x-session-token": 42 as unknown as string,
    },
  });
  assert.equal(malformedStyles.status, 400);
});

test("customer console routes accept managed-auth header sessions when explicitly enabled", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousManagedMode = process.env.IDENTITY_MANAGED_AUTH_MODE;
  try {
    process.env.NODE_ENV = "production";
    process.env.IDENTITY_MANAGED_AUTH_MODE = "header";
    const options = await customerConsoleBootstrapRoute({
      method: "OPTIONS",
      path: "/app-api/bootstrap",
      headers: {},
    });
    assert.equal(options.status, 204);
    assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-user-id"), true);
    assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-workspace-id"), true);
    assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-session-id"), true);

    const bootstrap = await customerConsoleBootstrapRoute({
      method: "GET",
      path: "/app-api/bootstrap",
      headers: {
        "x-auth-user-id": "managed-customer-user",
        "x-auth-email": "managed-customer@example.com",
        "x-auth-workspace-id": "managed-customer-workspace",
        "x-auth-workspace-name": "Managed Customer Workspace",
        "x-auth-role": "member",
      },
    });
    assert.equal(bootstrap.status, 200);
    const body = JSON.parse(bootstrap.body ?? "{}") as {
      currentUser?: { id?: string; email?: string };
      workspace?: { id?: string; name?: string };
      currentMembership?: { role?: string };
    };
    assert.equal(body.currentUser?.id, "managed-customer-user");
    assert.equal(body.currentUser?.email, "managed-customer@example.com");
    assert.equal(body.workspace?.id, "managed-customer-workspace");
    assert.equal(body.workspace?.name, "Managed Customer Workspace");
    assert.equal(body.currentMembership?.role, "member");
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.IDENTITY_MANAGED_AUTH_MODE = previousManagedMode;
  }
});

test("customer console settings route returns and updates workspace settings", async () => {
  const token = await issueRouteSession("settings-route-workspace");
  const current = await customerConsoleSettingsRoute({
    method: "GET",
    path: "/app-api/settings",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(current.status, 200);

  const updated = await customerConsoleSettingsRoute({
    method: "PATCH",
    path: "/app-api/settings",
    headers: {
      "x-session-token": token,
    },
    body: {
      workspaceName: "Settings Route Workspace",
    },
  });
  assert.equal(updated.status, 200);
  const updatedBody = JSON.parse(updated.body ?? "{}") as { workspace?: { name?: string } };
  assert.equal(updatedBody.workspace?.name, "Settings Route Workspace");
});

test("customer console style and usage routes validate auth and query shape", async () => {
  const token = await issueRouteSession("styles-route-workspace");
  const project = await customerConsoleProjectsRoute({
    method: "POST",
    path: "/app-api/projects",
    headers: {
      "x-session-token": token,
    },
    body: {
      name: "Usage Route Project",
    },
  });
  const projectBody = JSON.parse(project.body ?? "{}") as { project?: { id?: string } };
  const projectId = projectBody.project?.id ?? "";

  const missingAuth = await customerConsoleStylesRoute({
    method: "GET",
    path: "/app-api/styles",
    headers: {},
  });
  assert.equal(missingAuth.status, 401);

  const invalidWindow = await customerConsoleProjectRoute({
    method: "GET",
    path: `/app-api/projects/${projectId}/usage?window=minute`,
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(invalidWindow.status, 400);

  const invalidCreateAllowedEndpoints = await customerConsoleProjectsRoute({
    method: "POST",
    path: "/app-api/projects",
    headers: {
      "x-session-token": token,
    },
    body: {
      name: "Invalid Endpoint Route Project",
      allowedEndpoints: {
        tiles: "yes",
      },
    },
  });
  assert.equal(invalidCreateAllowedEndpoints.status, 400);

  const invalidUpdateAllowedEndpoints = await customerConsoleProjectRoute({
    method: "PATCH",
    path: `/app-api/projects/${projectId}`,
    headers: {
      "x-session-token": token,
    },
    body: {
      allowedEndpoints: {
        staticMaps: "no",
      },
    },
  });
  assert.equal(invalidUpdateAllowedEndpoints.status, 400);

  const blankProjectId = await customerConsoleProjectRoute({
    method: "GET",
    path: "/app-api/projects/%20",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(blankProjectId.status, 404);

  const encodedSlashProjectId = await customerConsoleProjectRoute({
    method: "POST",
    path: "/app-api/projects/foo%2Fbar/keys/rotate",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(encodedSlashProjectId.status, 404);

  const encodedBackslashProjectId = await customerConsoleProjectRoute({
    method: "GET",
    path: "/app-api/projects/foo%5Cbar",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(encodedBackslashProjectId.status, 404);

  const traversalProjectId = await customerConsoleProjectRoute({
    method: "GET",
    path: "/app-api/projects/../usage?window=day",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(traversalProjectId.status, 404);

  const embeddedTraversalProjectId = await customerConsoleProjectRoute({
    method: "GET",
    path: "/app-api/projects/project..id",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(embeddedTraversalProjectId.status, 404);

  const malformedProjectId = await customerConsoleProjectRoute({
    method: "GET",
    path: "/app-api/projects/%E0%A4%A/usage?window=day",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(malformedProjectId.status, 404);

  const malformedStyleId = await customerConsoleStylesRoute({
    method: "GET",
    path: "/app-api/styles/foo%2Fbar",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(malformedStyleId.status, 404);

  const traversalStyleId = await customerConsoleStylesRoute({
    method: "GET",
    path: "/app-api/styles/..",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(traversalStyleId.status, 404);

  const embeddedTraversalStyleId = await customerConsoleStylesRoute({
    method: "GET",
    path: "/app-api/styles/style..draft",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(embeddedTraversalStyleId.status, 404);
});

test("customer console route integrations for memberships, workspace, security, and notifications", async () => {
  const token = await issueRouteSession("route-lifecycle-workspace");

  // 1. Memberships list route
  const listResponse = await customerConsoleMembershipsRoute({
    method: "GET",
    path: "/app-api/memberships",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(listResponse.status, 200);

  // 2. Memberships invite route
  const inviteEmail = `route-invite-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;
  const inviteResponse = await customerConsoleMembershipsRoute({
    method: "POST",
    path: "/app-api/memberships/invite",
    headers: {
      "x-session-token": token,
    },
    body: {
      email: inviteEmail,
    },
  });
  assert.equal(inviteResponse.status, 200);

  // 3. Workspace export route
  const exportResponse = await customerConsoleWorkspaceRoute({
    method: "POST",
    path: "/app-api/workspace/export",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(exportResponse.status, 200);

  // 4. Workspace delete route (soft delete)
  const deleteResponse = await customerConsoleWorkspaceRoute({
    method: "POST",
    path: "/app-api/workspace/delete",
    headers: {
      "x-session-token": token,
    },
    body: {
      reason: "API Route test",
    },
  });
  assert.equal(deleteResponse.status, 200);

  // 5. Workspace restore route
  const restoredToken = await issueRouteSession("route-lifecycle-workspace");
  const restoreResponse = await customerConsoleWorkspaceRoute({
    method: "POST",
    path: "/app-api/workspace/restore",
    headers: {
      "x-session-token": restoredToken,
    },
  });
  assert.equal(restoreResponse.status, 200);

  // 6. Security password update route (expected 400 due to wrong current password)
  const passwordResponse = await customerConsoleSecurityRoute({
    method: "POST",
    path: "/app-api/security/password",
    headers: {
      "x-session-token": restoredToken,
    },
    body: {
      currentPassword: "wrong",
      newPassword: "NewPass123!!!",
    },
  });
  assert.equal(passwordResponse.status, 400);

  // 7. Security MFA enroll route
  const mfaResponse = await customerConsoleSecurityRoute({
    method: "POST",
    path: "/app-api/security/mfa/enroll",
    headers: {
      "x-session-token": restoredToken,
    },
    body: {},
  });
  assert.equal(mfaResponse.status, 200);

  // 8. Notifications list route
  const notificationsResponse = await customerConsoleNotificationsRoute({
    method: "GET",
    path: "/app-api/notifications",
    headers: {
      "x-session-token": restoredToken,
    },
  });
  assert.equal(notificationsResponse.status, 200);
});

