import { strict as assert } from "node:assert";
import { identityDemoSignInRoute } from "../routes/demo-sign-in-route";
import { identityDemoSignOutRoute } from "../routes/demo-sign-out-route";
import { identitySessionRoute } from "../routes/session-route";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.NODE_ENV = "development";

test("identity routes issue demo sessions and resolve current session", async () => {
  const signIn = await identityDemoSignInRoute({
    method: "POST",
    path: "/auth/demo/sign-in",
    body: {
      userId: "route-user",
      workspaceId: "route-workspace",
    },
  });
  assert.equal(signIn.status, 201);
  const created = JSON.parse(signIn.body ?? "{}") as { token?: string };
  const token = created.token ?? "";
  assert.equal(token.length > 0, true);

  const session = await identitySessionRoute({
    method: "GET",
    path: "/app-api/session",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(session.status, 200);

  const sessionViaMixedCaseHeader = await identitySessionRoute({
    method: "GET",
    path: "/app-api/session",
    headers: {
      "X-Session-Token": token,
    },
  });
  assert.equal(sessionViaMixedCaseHeader.status, 200);

  const sessionViaAuthorization = await identitySessionRoute({
    method: "GET",
    path: "/app-api/session",
    headers: {
      Authorization: `Session ${token}`,
    },
  });
  assert.equal(sessionViaAuthorization.status, 200);

  const sessionViaCookie = await identitySessionRoute({
    method: "GET",
    path: "/app-api/session",
    headers: {
      Cookie: `app_session=${token}`,
    },
  });
  assert.equal(sessionViaCookie.status, 200);

  const updatedMembership = await identityDemoSignInRoute({
    method: "POST",
    path: "/auth/demo/sign-in",
    body: {
      userId: "route-user",
      workspaceId: "route-workspace",
      role: "member",
    },
  });
  assert.equal(updatedMembership.status, 201);
  const updatedMembershipBody = JSON.parse(updatedMembership.body ?? "{}") as {
    membership?: { role?: string };
  };
  assert.equal(updatedMembershipBody.membership?.role, "member");

  const originalSessionAfterRoleUpdate = await identitySessionRoute({
    method: "GET",
    path: "/app-api/session",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(originalSessionAfterRoleUpdate.status, 200);
  const originalSessionAfterRoleUpdateBody = JSON.parse(originalSessionAfterRoleUpdate.body ?? "{}") as {
    membership?: { role?: string };
  };
  assert.equal(originalSessionAfterRoleUpdateBody.membership?.role, "member");

  const refreshedProfile = await identityDemoSignInRoute({
    method: "POST",
    path: "/auth/demo/sign-in",
    body: {
      userId: "route-user",
      email: "route-user-updated@example.com",
      name: "Route User Updated",
      workspaceId: "route-workspace",
      workspaceName: "Route Workspace Updated",
    },
  });
  assert.equal(refreshedProfile.status, 201);

  const sessionAfterProfileRefresh = await identitySessionRoute({
    method: "GET",
    path: "/app-api/session",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(sessionAfterProfileRefresh.status, 200);
  const sessionAfterProfileRefreshBody = JSON.parse(sessionAfterProfileRefresh.body ?? "{}") as {
    user?: { email?: string; name?: string };
    workspace?: { name?: string };
  };
  assert.equal(sessionAfterProfileRefreshBody.user?.email, "route-user-updated@example.com");
  assert.equal(sessionAfterProfileRefreshBody.user?.name, "Route User Updated");
  assert.equal(sessionAfterProfileRefreshBody.workspace?.name, "Route Workspace Updated");
});

test("identity routes reject missing sessions and support options", async () => {
  const unauthorized = await identitySessionRoute({
    method: "GET",
    path: "/app-api/session",
    headers: {},
  });
  assert.equal(unauthorized.status, 401);

  const options = await identityDemoSignInRoute({
    method: "OPTIONS",
    path: "/auth/demo/sign-in",
  });
  assert.equal(options.status, 204);
  assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-user-id"), false);
  assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-workspace-id"), false);

  const malformedSessionRequest = await identitySessionRoute(
    null as unknown as Parameters<typeof identitySessionRoute>[0],
  );
  assert.equal(malformedSessionRequest.status, 400);

  const malformedSignInPath = await identityDemoSignInRoute({
    method: "POST",
    path: 42 as unknown as string,
    body: {},
  });
  assert.equal(malformedSignInPath.status, 400);

  const malformedSignInBody = await identityDemoSignInRoute({
    method: "POST",
    path: "/auth/demo/sign-in",
    body: "route-user" as unknown as Record<string, unknown>,
  });
  assert.equal(malformedSignInBody.status, 400);

  const malformedSignOutHeaders = await identityDemoSignOutRoute({
    method: "POST",
    path: "/auth/demo/sign-out",
    headers: {
      cookie: 42 as unknown as string,
    },
  });
  assert.equal(malformedSignOutHeaders.status, 400);
});

test("identity session route resolves managed-auth header sessions when explicitly enabled", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMode = process.env.IDENTITY_MANAGED_AUTH_MODE;
  try {
    process.env.NODE_ENV = "production";
    process.env.IDENTITY_MANAGED_AUTH_MODE = "header";
    const session = await identitySessionRoute({
      method: "GET",
      path: "/app-api/session",
      headers: {
        "x-auth-user-id": "managed-route-user",
        "x-auth-email": "managed-route@example.com",
        "x-auth-workspace-id": "managed-route-workspace",
        "x-auth-workspace-name": "Managed Route Workspace",
        "x-auth-role": "member",
      },
    });
    assert.equal(session.status, 200);
    const body = JSON.parse(session.body ?? "{}") as {
      user?: { id?: string; email?: string };
      workspace?: { id?: string; name?: string };
      membership?: { role?: string };
    };
    assert.equal(body.user?.id, "managed-route-user");
    assert.equal(body.user?.email, "managed-route@example.com");
    assert.equal(body.workspace?.id, "managed-route-workspace");
    assert.equal(body.workspace?.name, "Managed Route Workspace");
    assert.equal(body.membership?.role, "member");

    const options = await identitySessionRoute({
      method: "OPTIONS",
      path: "/app-api/session",
      headers: {},
    });
    assert.equal(options.status, 204);
    assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-user-id"), true);
    assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-workspace-id"), true);
    assert.equal(options.headers["access-control-allow-headers"].includes("x-auth-session-id"), true);

    const malformedManagedSession = await identitySessionRoute({
      method: "GET",
      path: "/app-api/session",
      headers: {
        "x-auth-user-id": "managed/route-user",
        "x-auth-workspace-id": "managed-route-workspace",
      },
    });
    assert.equal(malformedManagedSession.status, 400);

    const malformedManagedSessionId = await identitySessionRoute({
      method: "GET",
      path: "/app-api/session",
      headers: {
        "x-auth-user-id": "managed-route-user",
        "x-auth-workspace-id": "managed-route-workspace",
        "x-auth-session-id": ".",
      },
    });
    assert.equal(malformedManagedSessionId.status, 400);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.IDENTITY_MANAGED_AUTH_MODE = previousMode;
  }
});

test("identity routes revoke demo sessions and clear cookie", async () => {
  const signIn = await identityDemoSignInRoute({
    method: "POST",
    path: "/auth/demo/sign-in",
    body: {
      userId: "route-signout-user",
      workspaceId: "route-signout-workspace",
    },
  });
  assert.equal(signIn.status, 201);
  const created = JSON.parse(signIn.body ?? "{}") as { token?: string };
  const token = created.token ?? "";
  assert.equal(token.length > 0, true);

  const signOut = await identityDemoSignOutRoute({
    method: "POST",
    path: "/auth/demo/sign-out",
    headers: {
      cookie: `app_session=${token}`,
    },
  });
  assert.equal(signOut.status, 200);
  assert.equal(signOut.headers["set-cookie"].includes("Max-Age=0"), true);

  const sessionAfter = await identitySessionRoute({
    method: "GET",
    path: "/app-api/session",
    headers: {
      "x-session-token": token,
    },
  });
  assert.equal(sessionAfter.status, 401);
});

test("identity demo auth routes are unavailable outside development", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const signIn = await identityDemoSignInRoute({
      method: "POST",
      path: "/auth/demo/sign-in",
      body: {},
    });
    assert.equal(signIn.status, 404);

    const signOut = await identityDemoSignOutRoute({
      method: "POST",
      path: "/auth/demo/sign-out",
      headers: {},
    });
    assert.equal(signOut.status, 404);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
