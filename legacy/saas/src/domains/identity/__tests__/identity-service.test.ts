import { strict as assert } from "node:assert";
import {
  clearSession,
  getWorkspace,
  getSession,
  issueDemoSession,
  listWorkspaceMemberships,
  requireSession,
  revokeSession,
  resolveSession,
  updateWorkspace,
} from "../identity.service";
import { IdentityError, IdentityErrorCode } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.NODE_ENV = "development";

test("identity issues and resolves sessions from headers", async (): Promise<void> => {
  const session = await issueDemoSession({
    userId: "alice",
    email: "alice@example.com",
    workspaceId: "workspace-a",
    workspaceName: "Workspace A",
  });

  const resolved = await resolveSession({
    "x-session-token": session.token,
  });
  assert.equal(resolved?.user.id, "alice");
  assert.equal(resolved?.workspace.id, "workspace-a");

  const fromCookie = await requireSession({
    cookie: `foo=bar; app_session=${session.token}; another=value`,
  });
  assert.equal(fromCookie.workspace.name, "Workspace A");

  const direct = await getSession(session.token);
  assert.equal(direct?.membership.workspaceId, "workspace-a");
});

test("identity tracks workspace memberships", async (): Promise<void> => {
  const session = await issueDemoSession({
    userId: "bob",
    workspaceId: "workspace-members",
    role: "member",
  });

  const memberships = await listWorkspaceMemberships(session.workspace.id);
  assert.equal(memberships.some((entry) => entry.userId === "bob"), true);
  assert.equal(memberships.some((entry) => entry.role === "member"), true);
});

test("identity demo sign-in updates existing membership roles and active sessions", async (): Promise<void> => {
  const firstSession = await issueDemoSession({
    userId: "membership-update-user",
    workspaceId: "membership-update-workspace",
    role: "owner",
  });
  assert.equal(firstSession.membership.role, "owner");

  const secondSession = await issueDemoSession({
    userId: "membership-update-user",
    workspaceId: "membership-update-workspace",
    role: "member",
  });
  assert.equal(secondSession.membership.role, "member");
  assert.equal((await getSession(firstSession.token))?.membership.role, "member");
  assert.equal(
    (await listWorkspaceMemberships("membership-update-workspace")).find((entry) => entry.userId === "membership-update-user")?.role,
    "member",
  );
});

test("identity demo sign-in refreshes existing user and workspace metadata across active sessions", async (): Promise<void> => {
  const firstSession = await issueDemoSession({
    userId: "profile-refresh-user",
    email: "before@example.com",
    name: "Before Name",
    workspaceId: "profile-refresh-workspace",
    workspaceName: "Workspace Before",
  });
  assert.equal(firstSession.user.email, "before@example.com");
  assert.equal(firstSession.user.name, "Before Name");
  assert.equal(firstSession.workspace.name, "Workspace Before");

  const secondSession = await issueDemoSession({
    userId: "profile-refresh-user",
    email: "after@example.com",
    name: "After Name",
    workspaceId: "profile-refresh-workspace",
    workspaceName: "Workspace After",
  });
  assert.equal(secondSession.user.email, "after@example.com");
  assert.equal(secondSession.user.name, "After Name");
  assert.equal(secondSession.workspace.name, "Workspace After");
  assert.equal((await getSession(firstSession.token))?.user.email, "after@example.com");
  assert.equal((await getSession(firstSession.token))?.user.name, "After Name");
  assert.equal((await getSession(firstSession.token))?.workspace.name, "Workspace After");
});

test("identity updates workspace names and refreshes active sessions", async (): Promise<void> => {
  const session = await issueDemoSession({
    userId: "carol",
    workspaceId: "workspace-update",
    workspaceName: "Workspace Before",
  });

  const updated = await updateWorkspace("workspace-update", {
    name: "Workspace After",
  });
  assert.equal(updated.name, "Workspace After");
  assert.equal((await getWorkspace("workspace-update")).name, "Workspace After");
  assert.equal((await getSession(session.token))?.workspace.name, "Workspace After");

  await assert.rejects(async () => {
    await updateWorkspace("workspace-update", {
      name: 42 as unknown as string,
    });
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await updateWorkspace("workspace-update", null as unknown as Parameters<typeof updateWorkspace>[1]);
  }, /IDENTITY_BAD_REQUEST/);
});

test("identity rejects unauthorized and invalid inputs", async (): Promise<void> => {
  try {
    await requireSession({});
    assert.fail("expected unauthorized");
  } catch (error) {
    assert.equal(error instanceof IdentityError, true);
    if (error instanceof IdentityError) {
      assert.equal(error.code, IdentityErrorCode.UNAUTHORIZED);
    }
  }

  await assert.rejects(async () => {
    await issueDemoSession({
      email: "invalid-email",
    });
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await issueDemoSession({
      role: "admin" as unknown as "owner",
    });
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await issueDemoSession({
      name: 42 as unknown as string,
    });
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await issueDemoSession({
      workspaceName: 42 as unknown as string,
    });
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await issueDemoSession({
      userId: "bad/user",
    });
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await issueDemoSession({
      workspaceId: "..",
    });
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await issueDemoSession({
      userId: "bad..user",
    });
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await issueDemoSession(null as unknown as Parameters<typeof issueDemoSession>[0]);
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await issueDemoSession(42 as unknown as Parameters<typeof issueDemoSession>[0]);
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getWorkspace("workspace..bad");
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getWorkspace(42 as unknown as string);
  }, /IDENTITY_BAD_REQUEST/);

  await assert.rejects(async () => {
    await listWorkspaceMemberships({ id: "workspace-a" } as unknown as string);
  }, /IDENTITY_BAD_REQUEST/);

  assert.equal(await resolveSession(42 as unknown as Record<string, string | undefined>), null);
  assert.equal(await clearSession(42 as unknown as Record<string, string | undefined>), false);

  try {
    await requireSession(42 as unknown as Record<string, string | undefined>);
    assert.fail("expected unauthorized");
  } catch (error) {
    assert.equal(error instanceof IdentityError, true);
    if (error instanceof IdentityError) {
      assert.equal(error.code, IdentityErrorCode.UNAUTHORIZED);
    }
  }
});

test("identity can revoke and clear sessions", async (): Promise<void> => {
  const session = await issueDemoSession({
    userId: "dave",
    workspaceId: "workspace-revoke",
  });

  assert.equal(await clearSession({
    cookie: `app_session=${session.token}`,
  }), true);
  assert.equal(await getSession(session.token), null);

  const second = await issueDemoSession({
    userId: "erin",
    workspaceId: "workspace-revoke-2",
  });
  assert.equal(await revokeSession(second.token), true);
  assert.equal(await getSession(second.token), null);
  assert.equal(await revokeSession("missing-token"), false);
  assert.equal(await getSession("bad/session"), null);
  assert.equal(await getSession("bad..session"), null);
  assert.equal(await revokeSession("bad\\session"), false);
  assert.equal(await revokeSession("bad..session"), false);
});

test("identity disables demo session issuance outside development", async (): Promise<void> => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(async () => {
      await issueDemoSession();
    }, /IDENTITY_NOT_FOUND/);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
