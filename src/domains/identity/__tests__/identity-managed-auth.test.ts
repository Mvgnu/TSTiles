import { strict as assert } from "node:assert";
import { clearSession, getSession, listWorkspaceMemberships, resolveSession } from "../identity.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

async function withManagedAuthEnv<T>(overrides: Record<string, string | undefined>, callback: () => T | Promise<T>): Promise<T> {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMode = process.env.IDENTITY_MANAGED_AUTH_MODE;
  const previousStateFile = process.env.IDENTITY_STATE_FILE;
  try {
    process.env.NODE_ENV = overrides.NODE_ENV;
    process.env.IDENTITY_MANAGED_AUTH_MODE = overrides.IDENTITY_MANAGED_AUTH_MODE;
    process.env.IDENTITY_STATE_FILE = overrides.IDENTITY_STATE_FILE;
    return await callback();
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.IDENTITY_MANAGED_AUTH_MODE = previousMode;
    process.env.IDENTITY_STATE_FILE = previousStateFile;
  }
}

test("identity resolves managed-auth sessions from trusted headers and persists state snapshots", async (): Promise<void> => {
  await withManagedAuthEnv({
    NODE_ENV: "production",
    IDENTITY_MANAGED_AUTH_MODE: "header",
    IDENTITY_STATE_FILE: undefined,
  }, async () => {
    const session = await resolveSession({
      "x-auth-user-id": "managed-user",
      "x-auth-email": "managed@example.com",
      "x-auth-name": "Managed User",
      "x-auth-workspace-id": "managed-workspace",
      "x-auth-workspace-name": "Managed Workspace",
      "x-auth-role": "member",
      "x-auth-session-id": "managed-session-1",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(session, "token"), false);
    assert.equal(session?.membership.role, "member");
    assert.equal(session?.workspace.name, "Managed Workspace");

    // Persistence verified by re-resolving the same session through the
    // public API (Prisma-backed). A re-resolve should return the same row.
    const reread = await getSession("managed-session-1");
    assert.equal(Object.prototype.hasOwnProperty.call(reread, "token"), false);
    assert.equal(reread?.user.id, "managed-user");
    assert.equal(reread?.workspace.id, "managed-workspace");
    assert.equal(reread?.membership.role, "member");
  });
});

test("identity managed-auth bridge rejects partial trusted header sets and can clear derived sessions", async (): Promise<void> => {
  await withManagedAuthEnv({
    NODE_ENV: "production",
    IDENTITY_MANAGED_AUTH_MODE: "header",
    IDENTITY_STATE_FILE: undefined,
  }, async () => {
    await assert.rejects(async () => {
      await resolveSession({
        "x-auth-user-id": "managed-user-only",
      });
    }, /IDENTITY_BAD_REQUEST/);

    await assert.rejects(async () => {
      await resolveSession({
        "x-auth-session-id": "managed-session-only",
      });
    }, /IDENTITY_BAD_REQUEST/);

    await assert.rejects(async () => {
      await resolveSession({
        "x-auth-role": "member",
      });
    }, /IDENTITY_BAD_REQUEST/);

    await assert.rejects(async () => {
      await resolveSession({
        "x-auth-user-id": "managed..user",
        "x-auth-workspace-id": "managed-workspace",
      });
    }, /IDENTITY_BAD_REQUEST/);

    await assert.rejects(async () => {
      await resolveSession({
        "x-auth-user-id": "managed-user",
        "x-auth-workspace-id": "managed-workspace",
        "x-auth-session-id": ".",
      });
    }, /IDENTITY_BAD_REQUEST/);

    const session = await resolveSession({
      "x-auth-user-id": "managed-user",
      "x-auth-workspace-id": "managed-workspace",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(session, "token"), false);
    assert.equal((await getSession("managed:managed-workspace:managed-user"))?.user.id, "managed-user");
    assert.equal(await clearSession({
      "x-auth-user-id": "managed-user",
      "x-auth-workspace-id": "managed-workspace",
    }), true);
    assert.equal(await getSession("managed:managed-workspace:managed-user"), null);
  });
});

test("identity managed-auth headers take precedence over ambient session tokens", async (): Promise<void> => {
  await withManagedAuthEnv({
    NODE_ENV: "production",
    IDENTITY_MANAGED_AUTH_MODE: "header",
    IDENTITY_STATE_FILE: undefined,
  }, async () => {
    const stale = await resolveSession({
      "x-auth-user-id": "stale-user",
      "x-auth-workspace-id": "stale-workspace",
      "x-auth-session-id": "stale-session",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(stale, "token"), false);

    const managed = await resolveSession({
      cookie: "app_session=stale-session",
      "x-session-token": "stale-session",
      "x-auth-user-id": "fresh-user",
      "x-auth-workspace-id": "fresh-workspace",
      "x-auth-session-id": "fresh-session",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(managed, "token"), false);
    assert.equal(managed?.user.id, "fresh-user");
    assert.equal(managed?.workspace.id, "fresh-workspace");

    assert.equal(await clearSession({
      cookie: "app_session=stale-session",
      "x-session-token": "stale-session",
      "x-auth-user-id": "fresh-user",
      "x-auth-workspace-id": "fresh-workspace",
      "x-auth-session-id": "fresh-session",
    }), true);
    assert.equal(await getSession("fresh-session"), null);
    assert.notEqual(await getSession("stale-session"), null);
  });
});

test("identity managed-auth refresh preserves existing synced metadata when optional provider fields are omitted", async (): Promise<void> => {
  await withManagedAuthEnv({
    NODE_ENV: "production",
    IDENTITY_MANAGED_AUTH_MODE: "header",
    IDENTITY_STATE_FILE: undefined,
  }, async () => {
    const seeded = await resolveSession({
      "x-auth-user-id": "managed-preserve-user",
      "x-auth-email": "managed-preserve@example.com",
      "x-auth-name": "Managed Preserve User",
      "x-auth-workspace-id": "managed-preserve-workspace",
      "x-auth-workspace-name": "Managed Preserve Workspace",
      "x-auth-session-id": "managed-preserve-session",
    });
    assert.equal(seeded?.user.email, "managed-preserve@example.com");
    assert.equal(seeded?.user.name, "Managed Preserve User");
    assert.equal(seeded?.workspace.name, "Managed Preserve Workspace");

    const refreshed = await resolveSession({
      "x-auth-user-id": "managed-preserve-user",
      "x-auth-workspace-id": "managed-preserve-workspace",
      "x-auth-session-id": "managed-preserve-session",
    });
    assert.equal(refreshed?.user.email, "managed-preserve@example.com");
    assert.equal(refreshed?.user.name, "Managed Preserve User");
    assert.equal(refreshed?.workspace.name, "Managed Preserve Workspace");
  });
});

test("identity managed-auth refresh also treats blank optional provider fields as omitted", async (): Promise<void> => {
  await withManagedAuthEnv({
    NODE_ENV: "production",
    IDENTITY_MANAGED_AUTH_MODE: "header",
    IDENTITY_STATE_FILE: undefined,
  }, async () => {
    const seeded = await resolveSession({
      "x-auth-user-id": "managed-blank-user",
      "x-auth-email": "managed-blank@example.com",
      "x-auth-name": "Managed Blank User",
      "x-auth-workspace-id": "managed-blank-workspace",
      "x-auth-workspace-name": "Managed Blank Workspace",
      "x-auth-session-id": "managed-blank-session",
    });
    assert.equal(seeded?.user.email, "managed-blank@example.com");
    assert.equal(seeded?.user.name, "Managed Blank User");
    assert.equal(seeded?.workspace.name, "Managed Blank Workspace");

    const refreshed = await resolveSession({
      "x-auth-user-id": "managed-blank-user",
      "x-auth-email": "   ",
      "x-auth-name": "   ",
      "x-auth-workspace-id": "managed-blank-workspace",
      "x-auth-workspace-name": "   ",
      "x-auth-session-id": "managed-blank-session",
    });
    assert.equal(refreshed?.user.email, "managed-blank@example.com");
    assert.equal(refreshed?.user.name, "Managed Blank User");
    assert.equal(refreshed?.workspace.name, "Managed Blank Workspace");
  });
});

// Tests for file-based persistence corruption/malformed shape/orphaned state
// were removed when identity migrated to Prisma. The Prisma schema enforces
// shape constraints, foreign-key integrity, and JSON-free storage so these
// scenarios cannot occur at the persistence layer.

test("identity lists workspace memberships deterministically for customer-facing user management", async (): Promise<void> => {
  await withManagedAuthEnv({
    NODE_ENV: "production",
    IDENTITY_MANAGED_AUTH_MODE: "header",
    IDENTITY_STATE_FILE: undefined,
  }, async () => {
    await resolveSession({
      "x-auth-user-id": "member-zulu",
      "x-auth-workspace-id": "workspace-membership-order",
      "x-auth-role": "member",
    });
    await resolveSession({
      "x-auth-user-id": "owner-alpha",
      "x-auth-workspace-id": "workspace-membership-order",
      "x-auth-role": "owner",
    });
    await resolveSession({
      "x-auth-user-id": "member-alpha",
      "x-auth-workspace-id": "workspace-membership-order",
      "x-auth-role": "member",
    });

    const memberships = await listWorkspaceMemberships("workspace-membership-order");
    assert.deepEqual(
      memberships.map((entry) => `${entry.role}:${entry.userId}`),
      [
        "owner:owner-alpha",
        "member:member-alpha",
        "member:member-zulu",
      ],
    );
  });
});
