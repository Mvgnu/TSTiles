import { strict as assert } from "node:assert";
import {
  createProject,
  deleteProject,
  getProjectPolicy,
  listProjects,
  revokeApiKey,
  resolveProjectIdentity,
  verifyApiKey,
  rotateApiKey,
} from "../projects.service";
import { ProjectsError, ProjectsErrorCode } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.ADMIN_TOKEN = "admin-token";
process.env.ALLOWED_TOKENS = "unused";
process.env.ALLOWED_TILES_TOKENS = "tile-token";
process.env.ALLOWED_ORIGINS = "*";
process.env.NODE_ENV = "development";
process.env.OBJECT_STORE_BUCKET = "test-bucket";

test("project bootstrap, identity, and policy", (): void => {
  const legacy = resolveProjectIdentity({
    rawToken: "tile-token",
  });
  assert.equal(legacy !== null, true);
  assert.equal(typeof legacy?.projectId, "string");
  assert.equal(typeof legacy?.keyHash, "string");

  const verified = verifyApiKey("tile-token");
  assert.equal(verified !== null, true);
  assert.equal(verified?.projectId, legacy?.projectId);

  const created = createProject({
    name: "Project Alpha",
  });
  const policy = getProjectPolicy(created.id);
  assert.equal(policy.allowedEndpoints.tiles, true);
  assert.equal(policy.allowedEndpoints.raster, true);
  assert.equal(policy.allowedEndpoints.staticMaps, true);

  const key = rotateApiKey(created.id);
  assert.equal(key.projectId, created.id);
  assert.equal(key.revoked, false);
  assert.equal(typeof key.token, "string");
  assert.equal(key.token.length > 0, true);

  const trimmedKey = rotateApiKey(` ${created.id} `);
  assert.equal(trimmedKey.projectId, created.id);
  assert.equal(typeof trimmedKey.token, "string");

  const records = listProjects();
  assert.equal(records.some((entry) => entry.id === created.id), true);

  const trimmedPolicy = getProjectPolicy(` ${created.id} `);
  assert.equal(trimmedPolicy.allowedEndpoints.tiles, true);

  try {
    getProjectPolicy("missing");
    assert.fail("Expected missing project policy to throw");
  } catch (error) {
    assert.equal(error instanceof ProjectsError, true);
    if (error instanceof ProjectsError) {
      assert.equal(error.code, ProjectsErrorCode.PROJECT_NOT_FOUND);
      assert.equal(error.message.includes("PROJECTS_PROJECT_NOT_FOUND"), true);
    }
  }

  assert.throws(() => {
    rotateApiKey("   ");
  }, /PROJECTS_PROJECT_NOT_FOUND/);

  assert.throws(() => {
    getProjectPolicy("   ");
  }, /PROJECTS_PROJECT_NOT_FOUND/);
});

test("project rotation returns distinct active key identities", () => {
  const project = createProject({
    name: "Project Beta",
  });
  const first = rotateApiKey(project.id);
  const second = rotateApiKey(project.id);

  assert.equal(first.projectId, project.id);
  assert.equal(second.projectId, project.id);
  assert.equal(first.keyId === second.keyId, false);
  assert.equal(first.keyHash === second.keyHash, false);
  assert.equal(first.revoked, false);
  assert.equal(second.revoked, false);
  assert.equal(verifyApiKey(first.token) !== null, false);
  const verifiedSecond = verifyApiKey(second.token);
  assert.equal(verifiedSecond !== null, true);
  assert.equal(verifiedSecond?.keyId, second.keyId);

  const revokedFirst = revokeApiKey(project.id, first.keyId);
  assert.equal(revokedFirst.revoked, true);
});

test("project and key outputs are immutable snapshots", () => {
  const project = createProject({
    name: "Project Snapshot",
    policy: {
      allowedOrigins: ["https://allowed.example"],
    },
  });

  (project.policy.allowedOrigins as string[] | undefined)?.push("https://mutated.example");
  const policy = getProjectPolicy(project.id);
  assert.equal(policy.allowedOrigins?.includes("https://mutated.example"), false);

  const listed = listProjects().find((entry) => entry.id === project.id);
  assert.equal(listed !== undefined, true);
  if (listed) {
    (listed as { name: string }).name = "Mutated Name";
  }
  const listedAgain = listProjects().find((entry) => entry.id === project.id);
  assert.equal(listedAgain?.name, "Project Snapshot");

  const key = rotateApiKey(project.id);
  (key as { revoked: boolean }).revoked = true;
  const legacy = verifyApiKey("tile-token");
  assert.equal(legacy !== null, true);
  if (legacy) {
    (legacy as { revoked: boolean }).revoked = true;
  }
  const legacyAgain = verifyApiKey("tile-token");
  assert.equal(legacyAgain?.revoked, false);
  const revoked = revokeApiKey(project.id, key.keyId);
  assert.equal(revoked.revoked, true);
});

test("revokeApiKey and deleteProject enforce lifecycle controls", () => {
  const project = createProject({
    name: "Project Gamma",
  });
  const key = rotateApiKey(project.id);

  const revoked = revokeApiKey(project.id, key.keyId);
  assert.equal(revoked.revoked, true);

  const resolved = resolveProjectIdentity({
    rawToken: key.keyHash,
  });
  assert.equal(resolved, null);

  deleteProject(project.id);
  assert.throws(() => {
    getProjectPolicy(project.id);
  }, /PROJECTS_PROJECT_NOT_FOUND/);
});

test("createProject rejects invalid policy input", () => {
  assert.throws(() => {
    createProject({
      name: "Project Invalid Quota",
      policy: {
        quotas: {
          dailyRequests: -1,
        },
      },
    });
  }, /PROJECTS_POLICY_INVALID/);

  assert.throws(() => {
    createProject({
      name: "Project Invalid Origins",
      policy: {
        allowedOrigins: ["https://ok.example", ""],
      },
    });
  }, /PROJECTS_POLICY_INVALID/);

  assert.throws(() => {
    createProject({
      name: "   ",
    });
  }, /PROJECTS_POLICY_INVALID/);

  assert.throws(() => {
    createProject({
      name: "Project Invalid Plan",
      planId: " ",
    });
  }, /PROJECTS_POLICY_INVALID/);

  assert.throws(() => {
    createProject({
      name: "Project Invalid Delimited Plan",
      planId: "pro|enterprise",
    });
  }, /PROJECTS_POLICY_INVALID/);

  const normalizedPlan = createProject({
    name: "Project Trimmed Plan",
    planId: "  pro  ",
  });
  assert.equal(normalizedPlan.planId, "pro");

  const uppercasePlan = createProject({
    name: "Project Uppercase Plan",
    planId: "PRO",
  });
  assert.equal(uppercasePlan.planId, "pro");
});
