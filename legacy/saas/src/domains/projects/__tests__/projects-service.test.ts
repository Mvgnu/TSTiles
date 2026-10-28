import { strict as assert } from "node:assert";
import { prisma } from "../../../config/db";
import {
  createProject,
  deleteProject,
  getProjectPolicy,
  listProjectKeys,
  listProjects,
  listProjectsByWorkspace,
  revokeApiKey,
  resolveProjectIdentity,
  syncWorkspaceProjectPlan,
  updateProject,
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

test("project bootstrap, identity, and policy", async (): Promise<void> => {
  const legacy = resolveProjectIdentity({
    rawToken: "tile-token",
  });
  assert.equal(legacy !== null, true);
  assert.equal(typeof (await legacy)?.projectId, "string");
  assert.equal(typeof (await legacy)?.keyHash, "string");

  const verified = verifyApiKey("tile-token");
  assert.equal(verified !== null, true);
  assert.equal((await verified)?.projectId, (await legacy)?.projectId);

  assert.equal(await verifyApiKey(42 as unknown as string), null);
  assert.equal(await resolveProjectIdentity(42 as unknown as string), null);
  assert.equal(
    await resolveProjectIdentity({ rawToken: 42 as unknown as string }),
    null,
  );

  const created = await createProject({
    name: "Project Alpha",
  });
  assert.equal(created.workspaceId, "default-workspace");
  const policy = await getProjectPolicy(created.id);
  assert.equal(policy.allowedEndpoints.tiles, true);
  assert.equal(policy.allowedEndpoints.raster, true);
  assert.equal(policy.allowedEndpoints.staticMaps, true);

  const key = await rotateApiKey(created.id);
  assert.equal((await key).projectId, created.id);
  assert.equal((await key).revoked, false);
  assert.equal(typeof (await key).token, "string");
  assert.equal((await key).token.length > 0, true);

  const trimmedKey = await rotateApiKey(` ${created.id} `);
  assert.equal(trimmedKey.projectId, created.id);
  assert.equal(typeof trimmedKey.token, "string");

  const records = await listProjects();
  assert.equal(records.some((entry) => entry.id === created.id), true);

  const trimmedPolicy = await getProjectPolicy(` ${created.id} `);
  assert.equal(trimmedPolicy.allowedEndpoints.tiles, true);

  try {
    await getProjectPolicy("missing");
    assert.fail("Expected missing project policy to throw");
  } catch (error) {
    assert.equal(error instanceof ProjectsError, true);
    if (error instanceof ProjectsError) {
      assert.equal(error.code, ProjectsErrorCode.PROJECT_NOT_FOUND);
      assert.equal(error.message.includes("PROJECTS_PROJECT_NOT_FOUND"), true);
    }
  }

  await assert.rejects(async () => {
    await rotateApiKey("   ");
  }, /PROJECTS_PROJECT_NOT_FOUND/);

  await assert.rejects(async () => {
    await getProjectPolicy("   ");
  }, /PROJECTS_PROJECT_NOT_FOUND/);

  await assert.rejects(async () => {
    await rotateApiKey("project/id");
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await getProjectPolicy("project\\\\id");
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await rotateApiKey("project..id");
  }, /PROJECTS_POLICY_INVALID/);
});

test("project rotation returns distinct active key identities", async () => {
  const project = await createProject({
    name: "Project Beta",
    workspaceId: "workspace-beta",
  });
  const first = await rotateApiKey((await project).id);
  const second = await rotateApiKey((await project).id);

  assert.equal((await first).projectId, (await project).id);
  assert.equal((await second).projectId, (await project).id);
  assert.equal((await first).keyId === (await second).keyId, false);
  assert.equal((await first).keyHash === (await second).keyHash, false);
  assert.equal((await first).revoked, false);
  assert.equal((await second).revoked, false);
  assert.equal((await verifyApiKey((await first).token)) !== null, false);
  const verifiedSecond = await verifyApiKey((await second).token);
  assert.equal(verifiedSecond !== null, true);
  assert.equal((await verifiedSecond)?.keyId, (await second).keyId);

  const revokedFirst = revokeApiKey((await project).id, (await first).keyId);
  assert.equal((await revokedFirst).revoked, true);

  await assert.rejects(async () => {
    await revokeApiKey((await project).id, "key/id");
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await revokeApiKey((await project).id, "key..id");
  }, /PROJECTS_POLICY_INVALID/);
});

test("rotateApiKey keeps the previous active key when transactional issuance fails", async () => {
  const project = await createProject({
    name: "Project Rotation Transaction",
    workspaceId: "workspace-rotation-transaction",
  });
  const active = await rotateApiKey(project.id);

  const originalTransaction = prisma.$transaction.bind(prisma);
  const originalFindUnique = prisma.project.findUnique.bind(prisma.project);
  const simulatedFailure = new Error("simulated key issuance failure");

  const fakeTransaction = async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
    const fakeTx = {
      project: {
        findUnique: async (...args: Parameters<typeof prisma.project.findUnique>) => await originalFindUnique(...args),
      },
      apiKey: {
        updateMany: async () => ({ count: 1 }),
        create: async () => {
          throw simulatedFailure;
        },
      },
    };
    return await callback(fakeTx);
  };

  (prisma as { $transaction: typeof prisma.$transaction }).$transaction = fakeTransaction as typeof prisma.$transaction;
  try {
    await assert.rejects(async () => {
      await rotateApiKey(project.id);
    }, (error: unknown) => {
      assert.equal(error, simulatedFailure);
      return true;
    });
  } finally {
    (prisma as { $transaction: typeof prisma.$transaction }).$transaction = originalTransaction;
  }

  const surviving = await verifyApiKey(active.token);
  assert.equal(surviving?.projectId, project.id);
  assert.equal(surviving?.revoked, false);
});

test("project and key outputs are immutable snapshots", async () => {
  const project = await createProject({
    name: "Project Snapshot",
    workspaceId: "workspace-snapshot",
    policy: {
      allowedOrigins: ["https://allowed.example"],
    },
  });

  (project.policy.allowedOrigins as string[] | undefined)?.push("https://mutated.example");
  const policy = await getProjectPolicy((await project).id);
  assert.equal(policy.allowedOrigins?.includes("https://mutated.example"), false);

  const pId = (await project).id;
  const listed = (await listProjects()).find((entry) => entry.id === pId);
  assert.equal(listed !== undefined, true);
  if (listed) {
    (listed as { name: string }).name = "Mutated Name";
  }
  const listedAgain = (await listProjects()).find((entry) => entry.id === pId);
  assert.equal(listedAgain?.name, "Project Snapshot");

  const key = await rotateApiKey((await project).id);
  const token = (await key).token;
  (key as { revoked: boolean }).revoked = true;
  
  const fetched = await verifyApiKey(token);
  assert.equal(fetched !== null, true);
  if (fetched) {
    (fetched as { revoked: boolean }).revoked = true;
  }
  const fetchedAgain = await verifyApiKey(token);
  assert.equal(fetchedAgain?.revoked, false);
  
  const revoked = revokeApiKey((await project).id, (await key).keyId);
  assert.equal((await revoked).revoked, true);
});

test("revokeApiKey and deleteProject enforce lifecycle controls", async () => {
  const project = await createProject({
    name: "Project Gamma",
    workspaceId: "workspace-gamma",
  });
  const key = await rotateApiKey((await project).id);

  const revoked = revokeApiKey((await project).id, (await key).keyId);
  assert.equal((await revoked).revoked, true);

  const resolved = await resolveProjectIdentity({
    rawToken: (await key).keyHash,
  });
  assert.equal(resolved, null);

  const survivingKey = await rotateApiKey((await project).id);
  assert.equal((await verifyApiKey(survivingKey.token))?.projectId, (await project).id);
  await deleteProject((await project).id);
  assert.equal(await verifyApiKey(survivingKey.token), null);
  await assert.rejects(async () => {
    await getProjectPolicy((await project).id);
  }, /PROJECTS_PROJECT_NOT_FOUND/);
});

test("deleteProject preserves non-not-found persistence failures", async () => {
  const project = await createProject({
    name: "Project Delete Failure",
    workspaceId: "workspace-delete-failure",
  });

  const originalTransaction = prisma.$transaction.bind(prisma);
  const simulatedFailure = new Error("simulated delete transaction failure");

  (prisma as { $transaction: typeof prisma.$transaction }).$transaction = (async () => {
    throw simulatedFailure;
  }) as typeof prisma.$transaction;

  try {
    await assert.rejects(async () => {
      await deleteProject(project.id);
    }, (error: unknown) => {
      assert.equal(error, simulatedFailure);
      return true;
    });
  } finally {
    (prisma as { $transaction: typeof prisma.$transaction }).$transaction = originalTransaction;
  }
});

test("createProject rejects invalid policy input", async () => {
  await assert.rejects(async () => {
    await createProject(null as unknown as Parameters<typeof createProject>[0]);
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await createProject(42 as unknown as Parameters<typeof createProject>[0]);
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await createProject({
      name: 42 as unknown as string,
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await createProject({
      name: "Project Invalid Quota",
      policy: {
        quotas: {
          dailyRequests: -1,
        },
      },
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await createProject({
      name: "Project Invalid Origins",
      policy: {
        allowedOrigins: ["https://ok.example", ""],
      },
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await createProject({
      name: "Project Invalid Origin Path",
      policy: {
        allowedOrigins: ["https://ok.example/path"],
      },
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await createProject({
      name: "Project Invalid Origin Scheme",
      policy: {
        allowedOrigins: ["ftp://ok.example"],
      },
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await createProject({
      name: "   ",
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await createProject({
      name: "Project Invalid Plan",
      planId: " ",
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await createProject({
      name: "Project Invalid Delimited Plan",
      planId: "pro|enterprise",
    });
  }, /PROJECTS_POLICY_INVALID/);

  const normalizedPlan = await createProject({
    name: "Project Trimmed Plan",
    workspaceId: "workspace-plan",
    planId: "  pro  ",
  });
  assert.equal(normalizedPlan.planId, "pro");

  const normalizedOrigins = await createProject({
    name: "Project Normalized Origins",
    workspaceId: "workspace-origin-normalized",
    policy: {
      allowedOrigins: [
        "https://maps.example/",
        "https://maps.example",
        "http://preview.example",
      ],
    },
  });
  assert.deepEqual(normalizedOrigins.policy.allowedOrigins, [
    "https://maps.example",
    "http://preview.example",
  ]);

  const uppercasePlan = await createProject({
    name: "Project Uppercase Plan",
    workspaceId: "workspace-plan",
    planId: "PRO",
  });
  assert.equal(uppercasePlan.planId, "pro");

  await assert.rejects(async () => {
    await createProject({
      name: "Project Invalid Workspace",
      workspaceId: " ",
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await createProject({
      name: "Project Invalid Workspace Type",
      workspaceId: 42 as unknown as string,
    });
  }, /PROJECTS_POLICY_INVALID/);

  await createProject({
    name: "Project Duplicate Name",
    workspaceId: "workspace-duplicate-name-a",
  });
  await assert.rejects(async () => {
    await createProject({
      name: "Project Duplicate Name",
      workspaceId: "workspace-duplicate-name-b",
    });
  }, /PROJECTS_POLICY_INVALID:project name already exists/);
});

test("updateProject merges editable policy fields without dropping existing settings", async () => {
  const project = await createProject({
    name: "Project Mutable",
    workspaceId: "workspace-mutable",
    policy: {
      allowedOrigins: ["https://allowed.example"],
      allowedEndpoints: {
        tiles: true,
        raster: false,
        staticMaps: true,
      },
      quotas: {
        dailyRequests: 1000,
        monthlyRequests: 5000,
      },
    },
  });

  const updated = await updateProject((await project).id, {
    name: "Project Mutable Renamed",
    policy: {
      allowedOrigins: ["https://updated.example"],
      allowedEndpoints: {
        tiles: true,
        raster: true,
        staticMaps: false,
      },
    },
  });

  assert.equal(updated.name, "Project Mutable Renamed");
  assert.deepEqual(updated.policy.allowedOrigins, ["https://updated.example"]);
  assert.equal(updated.policy.allowedEndpoints.tiles, true);
  assert.equal(updated.policy.allowedEndpoints.raster, true);
  assert.equal(updated.policy.allowedEndpoints.staticMaps, false);
  assert.equal(updated.policy.quotas?.dailyRequests, 1000);
  assert.equal(updated.policy.quotas?.monthlyRequests, 5000);

  const policy = await getProjectPolicy((await project).id);
  assert.deepEqual(policy.allowedOrigins, ["https://updated.example"]);
  assert.equal(policy.allowedEndpoints.staticMaps, false);
});

test("updateProject preserves unspecified endpoint toggles on partial service-level updates", async () => {
  const project = await createProject({
    name: "Project Partial Endpoints",
    workspaceId: "workspace-partial-endpoints",
    policy: {
      allowedEndpoints: {
        tiles: false,
        raster: false,
        staticMaps: true,
      },
    },
  });

  const updated = await updateProject(project.id, {
    policy: {
      allowedEndpoints: {
        raster: true,
      },
    },
  });

  assert.equal(updated.policy.allowedEndpoints.tiles, false);
  assert.equal(updated.policy.allowedEndpoints.raster, true);
  assert.equal(updated.policy.allowedEndpoints.staticMaps, true);

  const policy = await getProjectPolicy(project.id);
  assert.equal(policy.allowedEndpoints.tiles, false);
  assert.equal(policy.allowedEndpoints.raster, true);
  assert.equal(policy.allowedEndpoints.staticMaps, true);
});

test("listProjectKeys returns sanitized key metadata ordered newest-first", async () => {
  const project = await createProject({
    name: "Project Keys",
    workspaceId: "workspace-keys",
  });

  const first = await rotateApiKey((await project).id);
  const second = await rotateApiKey((await project).id);
  const keys = await listProjectKeys((await project).id);

  assert.equal(keys.length >= 2, true);
  const pId = (await project).id;
  assert.equal(keys.every((entry) => entry.projectId === pId), true);
  const fId = (await first).keyId;
  assert.equal(keys.some((entry) => entry.keyId === fId), true);
  const sId = (await second).keyId;
  assert.equal(keys.some((entry) => entry.keyId === sId), true);
  assert.equal(Object.prototype.hasOwnProperty.call(keys[0], "token"), false);

  const tiedCreatedAt = "2026-01-01T00:00:00.000Z";
  await prisma.apiKey.updateMany({
    where: { projectId: pId },
    data: { createdAt: tiedCreatedAt },
  });
  const tiedKeys = await listProjectKeys(pId);
  const tiedOrder = [fId, sId].sort((left, right) => right.localeCompare(left));
  assert.deepEqual(
    tiedKeys.slice(0, 2).map((entry) => entry.keyId),
    tiedOrder,
  );
});

test("updateProject validates lifecycle and plan updates", async () => {
  const project = await createProject({
    name: "Project Update Plan",
    workspaceId: "workspace-update",
  });
  const conflicting = await createProject({
    name: "Project Update Conflict",
    workspaceId: "workspace-update-conflict",
  });
  const updated = await updateProject(` ${(await project).id} `, {
    planId: " PRO ",
  });
  assert.equal(updated.planId, "pro");

  await assert.rejects(async () => {
    await updateProject(project.id, null as unknown as Parameters<typeof updateProject>[1]);
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await updateProject(project.id, 42 as unknown as Parameters<typeof updateProject>[1]);
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await updateProject((await project).id, {
      name: "   ",
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await updateProject("missing", {
      name: "Nope",
    });
  }, /PROJECTS_PROJECT_NOT_FOUND/);

  await assert.rejects(async () => {
    await updateProject(project.id, {
      planId: 42 as unknown as string,
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await updateProject("..", {
      name: "Nope",
    });
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await listProjectKeys("missing");
  }, /PROJECTS_PROJECT_NOT_FOUND/);

  await assert.rejects(async () => {
    await listProjectKeys("project/id");
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await listProjectKeys(42 as unknown as string);
  }, /PROJECTS_POLICY_INVALID/);

  await assert.rejects(async () => {
    await updateProject(conflicting.id, {
      name: "Project Update Plan",
    });
  }, /PROJECTS_POLICY_INVALID:project name already exists/);
});

test("projects can be filtered and plan-synced by workspace", async () => {
  const workspaceA = await createProject({
    name: "Workspace A One",
    workspaceId: "workspace-a",
    planId: "free",
  });
  const workspaceASecond = await createProject({
    name: "Workspace A Two",
    workspaceId: "workspace-a",
    planId: "free",
  });
  await createProject({
    name: "Workspace B One",
    workspaceId: "workspace-b",
    planId: "free",
  });

  const workspaceAProjects = await listProjectsByWorkspace("workspace-a");
  assert.equal(workspaceAProjects.some((entry) => entry.id === workspaceA.id), true);
  assert.equal(workspaceAProjects.some((entry) => entry.id === workspaceASecond.id), true);
  assert.equal(workspaceAProjects.every((entry) => entry.workspaceId === "workspace-a"), true);

  const synced = syncWorkspaceProjectPlan("workspace-a", "pro");
  assert.equal((await synced).length >= 2, true);
  assert.equal((await synced).every((entry) => entry.planId === "pro"), true);
  assert.equal((await listProjectsByWorkspace("workspace-a")).every((entry) => entry.planId === "pro"), true);
  assert.equal((await listProjectsByWorkspace("workspace-b")).every((entry) => entry.planId === "free"), true);

  await assert.rejects(async () => {
    await listProjectsByWorkspace(42 as unknown as string);
  }, /PROJECTS_POLICY_INVALID/);
});

test("project listing surfaces are deterministic newest-first with stable id tie-breaks", async () => {
  await createProject({
    name: "Listing Order A",
    workspaceId: "workspace-list-order",
    planId: "free",
  });
  await createProject({
    name: "Listing Order B",
    workspaceId: "workspace-list-order",
    planId: "free",
  });

  const originalFindMany = prisma.project.findMany.bind(prisma.project);
  const capturedArgs: Array<Parameters<typeof prisma.project.findMany>[0]> = [];
  (prisma.project as { findMany: typeof prisma.project.findMany }).findMany = (async (...args: Parameters<typeof prisma.project.findMany>) => {
    capturedArgs.push(args[0]);
    return await originalFindMany(...args);
  }) as typeof prisma.project.findMany;

  try {
    await listProjects();
    await listProjectsByWorkspace("workspace-list-order");
    assert.deepEqual(capturedArgs[0]?.orderBy, [
      { createdAt: "desc" },
      { id: "asc" },
    ]);
    assert.deepEqual(capturedArgs[1]?.orderBy, [
      { createdAt: "desc" },
      { id: "asc" },
    ]);
  } finally {
    (prisma.project as { findMany: typeof prisma.project.findMany }).findMany = originalFindMany;
  }
});

test("syncWorkspaceProjectPlan is transactional and leaves plans unchanged on failure", async () => {
  const first = await createProject({
    name: "Workspace Sync Atomic One",
    workspaceId: "workspace-sync-atomic",
    planId: "free",
  });
  const second = await createProject({
    name: "Workspace Sync Atomic Two",
    workspaceId: "workspace-sync-atomic",
    planId: "free",
  });

  const originalTransaction = prisma.$transaction.bind(prisma);
  const originalFindMany = prisma.project.findMany.bind(prisma.project);
  const simulatedFailure = new Error("simulated workspace plan sync failure");

  const fakeTransaction = async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
    const fakeTx = {
      project: {
        findMany: async (...args: Parameters<typeof prisma.project.findMany>) => await originalFindMany(...args),
        updateMany: async () => {
          throw simulatedFailure;
        },
      },
    };
    return await callback(fakeTx);
  };

  (prisma as { $transaction: typeof prisma.$transaction }).$transaction = fakeTransaction as typeof prisma.$transaction;
  try {
    await assert.rejects(async () => {
      await syncWorkspaceProjectPlan("workspace-sync-atomic", "pro");
    }, (error: unknown) => {
      assert.equal(error, simulatedFailure);
      return true;
    });
  } finally {
    (prisma as { $transaction: typeof prisma.$transaction }).$transaction = originalTransaction;
  }

  const afterFailure = await listProjectsByWorkspace("workspace-sync-atomic");
  assert.equal(afterFailure.some((entry) => entry.id === first.id && entry.planId === "free"), true);
  assert.equal(afterFailure.some((entry) => entry.id === second.id && entry.planId === "free"), true);
});

test("project read surfaces fail closed on malformed persisted policy state", async () => {
  const originalFindUnique = prisma.project.findUnique.bind(prisma.project);
  const originalFindMany = prisma.project.findMany.bind(prisma.project);

  (prisma.project as { findUnique: typeof prisma.project.findUnique }).findUnique = ((async (...args: Parameters<typeof prisma.project.findUnique>) => {
    const whereId = args[0]?.where && "id" in args[0].where ? args[0].where.id : undefined;
    if (whereId === "broken-policy-json") {
      return {
        id: "broken-policy-json",
        workspaceId: "workspace-broken",
        name: "Broken Policy Json",
        policy: "{bad json",
        planId: "free",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    }
    if (whereId === "broken-policy-shape") {
      return {
        id: "broken-policy-shape",
        workspaceId: "workspace-broken",
        name: "Broken Policy Shape",
        policy: JSON.stringify({
          allowedEndpoints: {
            tiles: "yes",
          },
        }),
        planId: "free",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    }
    return await originalFindUnique(...args);
  }) as unknown) as typeof prisma.project.findUnique;

  (prisma.project as { findMany: typeof prisma.project.findMany }).findMany = ((async (...args: Parameters<typeof prisma.project.findMany>) => {
    const workspaceId = args[0]?.where && "workspaceId" in args[0].where ? args[0].where.workspaceId : undefined;
    if (workspaceId === "workspace-broken-list") {
      return [
        {
          id: "broken-policy-list",
          workspaceId: "workspace-broken-list",
          name: "Broken Policy List",
          policy: JSON.stringify({
            allowedOrigins: ["https://ok.example/path"],
          }),
          planId: "free",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ];
    }
    return await originalFindMany(...args);
  }) as unknown) as typeof prisma.project.findMany;

  try {
    await assert.rejects(async () => {
      await getProjectPolicy("broken-policy-json");
    }, /PROJECTS_POLICY_INVALID:stored project policy is invalid/);

    await assert.rejects(async () => {
      await getProjectPolicy("broken-policy-shape");
    }, /PROJECTS_POLICY_INVALID:allowedEndpoints.tiles must be boolean/);

    await assert.rejects(async () => {
      await listProjectsByWorkspace("workspace-broken-list");
    }, /PROJECTS_POLICY_INVALID:allowedOrigins entries must be bare origins without path, query, or fragment/);
  } finally {
    (prisma.project as { findUnique: typeof prisma.project.findUnique }).findUnique = originalFindUnique;
    (prisma.project as { findMany: typeof prisma.project.findMany }).findMany = originalFindMany;
  }
});

test("project read surfaces skip malformed persisted project rows and fail closed on malformed targeted rows", async () => {
  const project = await createProject({
    name: "Project Bad Stored Rows",
    workspaceId: "workspace-bad-stored-rows",
  });
  const issued = await rotateApiKey(project.id);

  const originalFindUnique = prisma.project.findUnique.bind(prisma.project);
  const originalFindMany = prisma.project.findMany.bind(prisma.project);

  (prisma.project as { findUnique: typeof prisma.project.findUnique }).findUnique = ((async (...args: Parameters<typeof prisma.project.findUnique>) => {
    const whereId = args[0]?.where && "id" in args[0].where ? args[0].where.id : undefined;
    if (whereId === "broken-project-row") {
      return {
        id: "",
        workspaceId: "workspace-bad-stored-rows",
        name: "Broken Project Row",
        policy: JSON.stringify({
          allowedEndpoints: {
            tiles: true,
            raster: true,
            staticMaps: true,
          },
        }),
        planId: "free",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    }
    if (whereId === project.id) {
      return {
        id: project.id,
        workspaceId: project.workspaceId,
        name: project.name,
        policy: project.policy ? JSON.stringify(project.policy) : "{}",
        planId: "",
        createdAt: project.createdAt,
      };
    }
    return await originalFindUnique(...args);
  }) as unknown) as typeof prisma.project.findUnique;

  (prisma.project as { findMany: typeof prisma.project.findMany }).findMany = ((async (...args: Parameters<typeof prisma.project.findMany>) => {
    const workspaceId = args[0]?.where && "workspaceId" in args[0].where ? args[0].where.workspaceId : undefined;
    if (workspaceId === "workspace-bad-stored-rows") {
      return [
        {
          id: project.id,
          workspaceId: project.workspaceId,
          name: project.name,
          policy: JSON.stringify(project.policy),
          planId: project.planId,
          createdAt: project.createdAt,
        },
        {
          id: "",
          workspaceId: "workspace-bad-stored-rows",
          name: "Broken Workspace Project",
          policy: JSON.stringify(project.policy),
          planId: "free",
          createdAt: project.createdAt,
        },
      ];
    }
    return await originalFindMany(...args);
  }) as unknown) as typeof prisma.project.findMany;

  try {
    const listed = await listProjectsByWorkspace("workspace-bad-stored-rows");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, project.id);

    await assert.rejects(async () => {
      await getProjectPolicy("broken-project-row");
    }, /PROJECTS_POLICY_INVALID:stored project is invalid/);

    assert.equal(await resolveProjectIdentity({ rawToken: issued.token }), null);
  } finally {
    (prisma.project as { findUnique: typeof prisma.project.findUnique }).findUnique = originalFindUnique;
    (prisma.project as { findMany: typeof prisma.project.findMany }).findMany = originalFindMany;
  }
});

test("api key read surfaces fail closed on malformed persisted key rows", async () => {
  const project = await createProject({
    name: "Project Bad Key Rows",
    workspaceId: "workspace-bad-key-rows",
  });
  const issued = await rotateApiKey(project.id);

  const originalFindUnique = prisma.apiKey.findUnique.bind(prisma.apiKey);
  const originalFindMany = prisma.apiKey.findMany.bind(prisma.apiKey);

  (prisma.apiKey as { findUnique: typeof prisma.apiKey.findUnique }).findUnique = ((async (...args: Parameters<typeof prisma.apiKey.findUnique>) => {
    const keyHash = args[0]?.where && "keyHash" in args[0].where ? args[0].where.keyHash : undefined;
    if (keyHash === issued.keyHash) {
      return {
        projectId: project.id,
        keyId: issued.keyId,
        keyHash: "",
        keyIdHash: issued.keyIdHash,
        createdAt: issued.createdAt,
        revoked: false,
      };
    }
    return await originalFindUnique(...args);
  }) as unknown) as typeof prisma.apiKey.findUnique;

  (prisma.apiKey as { findMany: typeof prisma.apiKey.findMany }).findMany = ((async (...args: Parameters<typeof prisma.apiKey.findMany>) => {
    const projectId = args[0]?.where && "projectId" in args[0].where ? args[0].where.projectId : undefined;
    if (projectId === project.id) {
      return [
        {
          projectId: project.id,
          keyId: issued.keyId,
          keyHash: issued.keyHash,
          keyIdHash: issued.keyIdHash,
          createdAt: issued.createdAt,
          revoked: false,
        },
        {
          projectId: project.id,
          keyId: "",
          keyHash: "bad-key-hash",
          keyIdHash: "bad-key-id-hash",
          createdAt: issued.createdAt,
          revoked: false,
        },
      ];
    }
    return await originalFindMany(...args);
  }) as unknown) as typeof prisma.apiKey.findMany;

  try {
    assert.equal(await verifyApiKey(issued.token), null);

    const listed = await listProjectKeys(project.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.keyId, issued.keyId);
  } finally {
    (prisma.apiKey as { findUnique: typeof prisma.apiKey.findUnique }).findUnique = originalFindUnique;
    (prisma.apiKey as { findMany: typeof prisma.apiKey.findMany }).findMany = originalFindMany;
  }
});
