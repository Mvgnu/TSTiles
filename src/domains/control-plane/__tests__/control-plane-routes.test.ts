import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { adminIngestRoute } from "../routes/admin-ingest-route";
import { adminListArtifactsRoute } from "../routes/admin-artifacts-route";
import { adminCreateProjectRoute } from "../routes/admin-create-project-route";
import { adminPromoteArtifactRoute } from "../routes/admin-promote-route";
import { adminRotateApiKeyRoute } from "../routes/admin-rotate-api-key-route";
import { adminProjectUsageRoute } from "../routes/admin-project-usage-route";
import { adminCreateStyleVersionRoute } from "../routes/admin-create-style-version-route";
import { adminPublishStyleVersionRoute } from "../routes/admin-publish-style-version-route";
import { adminRollbackArtifactRoute } from "../routes/admin-rollback-route";
import { controlPlaneHealthRoute } from "../routes/health-route";
import {
  createProjectEndpoint,
  promoteArtifactEndpoint,
  rotateApiKeyEndpoint,
  getProjectUsageEndpoint,
  createStyleVersionEndpoint,
  publishStyleVersionEndpoint,
} from "../control-plane.service";
import { ControlPlaneErrorCode } from "../types";
import { registerArtifact } from "../../artifact/artifact.service";
import { prisma } from "../../../config/db";
import { createOperatorSession } from "../../identity/identity.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.NODE_ENV = "development";
process.env.INGEST_SNAPSHOT_ID = "snapshot-from-control-plane";
process.env.INGEST_SNAPSHOT_URL = "data:text/plain,control-plane-ingest";
process.env.INGEST_EXPECTED_CHECKSUM = createHash("sha256")
  .update("control-plane-ingest")
  .digest("hex");

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const artifactsContain = (
  items: unknown,
  predicate: (artifact: Record<string, unknown>) => boolean,
): boolean => {
  if (!Array.isArray(items)) {
    return false;
  }
  return items.some((item) => {
    return predicate(item as Record<string, unknown>);
  });
};

test("admin routes enforce auth and state transitions", async (): Promise<void> => {
  // Test asserts rollbackUnavailable on a fresh active-pointer/history; reset
  // shared artifact persistence so concurrent tests cannot leave history rows
  // that would mask the no-history assertion below.
  await prisma.artifactPromotionHistory.deleteMany({});
  await prisma.activeArtifact.deleteMany({});

  const bad = await adminIngestRoute("bad-token");
  assert.equal(bad.status, 401);
  assert.equal(bad.headers["cache-control"], "no-store");
  const badList = await adminListArtifactsRoute("bad-token");
  assert.equal(badList.status, 401);
  assert.equal(badList.headers["cache-control"], "no-store");
  const badPromote = await adminPromoteArtifactRoute("bad-token", "cp-artifact-a");
  assert.equal(badPromote.status, 401);
  assert.equal(badPromote.headers["cache-control"], "no-store");
  const badRollback = await adminRollbackArtifactRoute("bad-token");
  assert.equal(badRollback.status, 401);
  assert.equal(badRollback.headers["cache-control"], "no-store");
  const badHealth = await controlPlaneHealthRoute("bad-token");
  assert.equal(badHealth.status, 401);
  assert.equal(badHealth.headers["cache-control"], "no-store");

  await registerArtifact({
    id: "cp-artifact-a",
    key: "artifacts/artifact-a/tiles.pmtiles",
    checksum: "abc",
    byteSize: 120,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  await registerArtifact({
    id: "cp-artifact-b",
    key: "artifacts/artifact-b/tiles.pmtiles",
    checksum: "def",
    byteSize: 120,
    createdAt: new Date().toISOString(),
    validated: true,
  });

  const token = "admin-token";
  const trimmedHealth = await controlPlaneHealthRoute("  admin-token  ");
  assert.equal(trimmedHealth.status, 200);
  assert.equal(trimmedHealth.headers["cache-control"], "public, max-age=5");
  const bearerHealth = await controlPlaneHealthRoute("Bearer admin-token");
  assert.equal(bearerHealth.status, 200);
  assert.equal(bearerHealth.headers["cache-control"], "public, max-age=5");
  const health = await controlPlaneHealthRoute(token);
  assert.equal(health.status, 200);
  assert.equal(health.headers["cache-control"], "public, max-age=5");

  const list = await adminListArtifactsRoute(token);
  assert.equal(list.status, 200);
  assert.equal(list.headers["cache-control"], "no-store");

  const first = await adminPromoteArtifactRoute(token, " cp-artifact-a ");
  assert.equal(first.status, 200);
  assert.equal(first.headers["cache-control"], "no-store");
  const promoteMissing = await adminPromoteArtifactRoute(token, "missing-artifact");
  assert.equal(promoteMissing.status, 409);
  const promoteBlank = await adminPromoteArtifactRoute(token, "   ");
  assert.equal(promoteBlank.status, 400);
  assert.equal((promoteBlank.body as { error?: string }).error, "versionId is required");
  const promoteBadType = await adminPromoteArtifactRoute(token, 42 as unknown as string);
  assert.equal(promoteBadType.status, 400);
  assert.equal((promoteBadType.body as { error?: string }).error, "versionId must be a string");
  const promoteSlash = await adminPromoteArtifactRoute(token, "artifact/a");
  assert.equal(promoteSlash.status, 400);
  assert.equal((promoteSlash.body as { error?: string }).error, "versionId contains unsupported path characters");
  const promoteEmbeddedTraversal = await adminPromoteArtifactRoute(token, "artifact..b");
  assert.equal(promoteEmbeddedTraversal.status, 400);
  assert.equal((promoteEmbeddedTraversal.body as { error?: string }).error, "versionId contains unsupported path characters");
  const promote = await adminPromoteArtifactRoute(token, "cp-artifact-b");
  assert.equal(promote.status, 200);
  const promoteConflict = await adminPromoteArtifactRoute(token, "cp-artifact-b");
  assert.equal(promoteConflict.status, 409);
  const rollback = await adminRollbackArtifactRoute(token);
  assert.equal(rollback.status, 200);
  assert.equal(rollback.headers["cache-control"], "no-store");
  const rollbackUnavailable = await adminRollbackArtifactRoute(token);
  assert.equal(rollbackUnavailable.status, 409);

  const projectCreate = await adminCreateProjectRoute(token, { name: "control-plane-project" });
  assert.equal(projectCreate.status, 201);
  assert.equal(projectCreate.headers["cache-control"], "no-store");
  assert.equal(typeof (projectCreate.body as { id?: string }).id, "string");
  const projectCreateBlank = await adminCreateProjectRoute(token, { name: "   " });
  assert.equal(projectCreateBlank.status, 400);
  const projectCreateMissingBody = await adminCreateProjectRoute(
    token,
    undefined as unknown as { name: string },
  );
  assert.equal(projectCreateMissingBody.status, 400);
  assert.equal(
    (projectCreateMissingBody.body as { error?: string }).error,
    "Project payload is required",
  );
  const projectCreateBadPlanType = await adminCreateProjectRoute(
    token,
    { name: "typed-project", planId: 42 as unknown as string },
  );
  assert.equal(projectCreateBadPlanType.status, 400);
  assert.equal(
    (projectCreateBadPlanType.body as { error?: string }).error,
    "planId must be a string",
  );
  const projectCreateBlankPlan = await adminCreateProjectRoute(
    token,
    { name: "blank-plan-project", planId: "   " },
  );
  assert.equal(projectCreateBlankPlan.status, 400);
  assert.equal(
    (projectCreateBlankPlan.body as { error?: string }).error,
    "planId must be non-empty",
  );
  const projectCreateBadPlanShape = await adminCreateProjectRoute(
    token,
    { name: "bad-plan-project", planId: "pro/enterprise" },
  );
  assert.equal(projectCreateBadPlanShape.status, 400);
  assert.equal(
    (projectCreateBadPlanShape.body as { error?: string }).error,
    "planId must be alphanumeric (plus _ or -)",
  );
  const projectCreateOriginWithPath = await adminCreateProjectRoute(
    token,
    {
      name: "project-origin-path",
      policy: {
        allowedOrigins: ["https://maps.example/path"],
      },
    },
  );
  assert.equal(projectCreateOriginWithPath.status, 400);
  assert.equal(
    (projectCreateOriginWithPath.body as { error?: string }).error,
    "policy.allowedOrigins entries must be bare origins without path, query, or fragment",
  );
  const projectCreateOriginWithCredentials = await adminCreateProjectRoute(
    token,
    {
      name: "project-origin-creds",
      policy: {
        allowedOrigins: ["https://user:secret@maps.example"],
      },
    },
  );
  assert.equal(projectCreateOriginWithCredentials.status, 400);
  assert.equal(
    (projectCreateOriginWithCredentials.body as { error?: string }).error,
    "policy.allowedOrigins entries must not include credentials",
  );
  const projectCreateOriginWithScheme = await adminCreateProjectRoute(
    token,
    {
      name: "project-origin-scheme",
      policy: {
        allowedOrigins: ["ftp://maps.example"],
      },
    },
  );
  assert.equal(projectCreateOriginWithScheme.status, 400);
  assert.equal(
    (projectCreateOriginWithScheme.body as { error?: string }).error,
    "policy.allowedOrigins entries must be absolute http(s) origins",
  );
  const projectCreateDedupedOrigins = await adminCreateProjectRoute(
    token,
    {
      name: "project-origin-deduped",
      policy: {
        allowedOrigins: [
          " https://maps.example ",
          "https://maps.example",
          "http://preview.example",
        ],
      },
    },
  );
  assert.equal(projectCreateDedupedOrigins.status, 201);
  assert.deepEqual(
    (projectCreateDedupedOrigins.body as { policy?: { allowedOrigins?: string[] } }).policy?.allowedOrigins,
    [
      "https://maps.example",
      "http://preview.example",
    ],
  );

  const rotate = await adminRotateApiKeyRoute((projectCreate.body as { id?: string }).id ?? "missing", token);
  assert.equal(rotate.status, 200);
  assert.equal(rotate.headers["cache-control"], "no-store");
  assert.equal(typeof (rotate.body as { keyId?: string }).keyId, "string");
  assert.equal(typeof (rotate.body as { token?: string }).token, "string");
  const rotateTrimmed = await adminRotateApiKeyRoute(` ${(projectCreate.body as { id?: string }).id ?? "missing"} `, token);
  assert.equal(rotateTrimmed.status, 200);
  const rotateBlank = await adminRotateApiKeyRoute(" ", token);
  assert.equal(rotateBlank.status, 400);
  assert.equal((rotateBlank.body as { error?: string }).error, "projectId is required");
  const rotateBadType = await adminRotateApiKeyRoute(42 as unknown as string, token);
  assert.equal(rotateBadType.status, 400);
  assert.equal((rotateBadType.body as { error?: string }).error, "projectId must be a string");
  const rotateBackslash = await adminRotateApiKeyRoute("project\\id", token);
  assert.equal(rotateBackslash.status, 400);
  assert.equal((rotateBackslash.body as { error?: string }).error, "projectId contains unsupported path characters");
  const rotateEmbeddedTraversal = await adminRotateApiKeyRoute("project..id", token);
  assert.equal(rotateEmbeddedTraversal.status, 400);
  assert.equal((rotateEmbeddedTraversal.body as { error?: string }).error, "projectId contains unsupported path characters");

  const ingestResult = await adminIngestRoute(token);
  assert.equal(ingestResult.status, 202);

  await wait(10);
  const artifactList = await adminListArtifactsRoute(token);
  assert.equal(artifactList.status, 200);
  assert.equal(
    artifactsContain(artifactList.body, (artifact) =>
      artifact.key === `artifacts/${process.env.INGEST_SNAPSHOT_ID}/tiles.pmtiles`
    ),
    true,
  );

  const usage = await adminProjectUsageRoute((projectCreate.body as { id?: string }).id ?? "missing", "day", token);
  assert.equal(usage.status, 200);
  assert.equal(usage.headers["cache-control"], "no-store");
  assert.equal(Array.isArray(usage.body), true);

  const usageInvalidWindow = await adminProjectUsageRoute((projectCreate.body as { id?: string }).id ?? "missing", "year", token);
  assert.equal(usageInvalidWindow.status, 400);
  assert.equal((usageInvalidWindow.body as { error: string }).error, "Invalid usage window");
  const usageMissingWindow = await adminProjectUsageRoute((projectCreate.body as { id?: string }).id ?? "missing", "", token);
  assert.equal(usageMissingWindow.status, 400);
  const usageBadWindowType = await adminProjectUsageRoute(
    (projectCreate.body as { id?: string }).id ?? "missing",
    42 as unknown as string,
    token,
  );
  assert.equal(usageBadWindowType.status, 400);
  assert.equal((usageBadWindowType.body as { error?: string }).error, "Invalid usage window");
  const usageTrimmedInputs = await adminProjectUsageRoute(` ${(projectCreate.body as { id?: string }).id ?? "missing"} `, " month ", token);
  assert.equal(usageTrimmedInputs.status, 200);
  const usageBlankProject = await adminProjectUsageRoute("  ", "day", token);
  assert.equal(usageBlankProject.status, 400);
  assert.equal((usageBlankProject.body as { error?: string }).error, "projectId is required");
  const usageBadProjectType = await adminProjectUsageRoute(42 as unknown as string, "day", token);
  assert.equal(usageBadProjectType.status, 400);
  assert.equal((usageBadProjectType.body as { error?: string }).error, "projectId must be a string");
  const usageTraversalProject = await adminProjectUsageRoute("..", "day", token);
  assert.equal(usageTraversalProject.status, 400);
  assert.equal((usageTraversalProject.body as { error?: string }).error, "projectId contains unsupported path characters");
  const usageEmbeddedTraversalProject = await adminProjectUsageRoute("project..id", "day", token);
  assert.equal(usageEmbeddedTraversalProject.status, 400);
  assert.equal((usageEmbeddedTraversalProject.body as { error?: string }).error, "projectId contains unsupported path characters");
  const usageMissingProject = await adminProjectUsageRoute("missing-project", "day", token);
  assert.equal(usageMissingProject.status, 409);
  assert.equal((usageMissingProject.body as { error?: string }).error, "project not found");

  const styleDocument = {
    version: 8,
    sources: {
      map: {
        type: "vector",
        tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
  };
  const createdStyle = await adminCreateStyleVersionRoute(
    " docs-style ",
    styleDocument,
    token,
  );
  assert.equal(createdStyle.status, 201);
  assert.equal(createdStyle.headers["cache-control"], "no-store");
  assert.equal(typeof (createdStyle.body as { id?: string }).id, "string");
  const createdStyleBlank = await adminCreateStyleVersionRoute(
    "  ",
    styleDocument,
    token,
  );
  assert.equal(createdStyleBlank.status, 400);
  assert.equal((createdStyleBlank.body as { error?: string }).error, "styleId is required");
  const createdStyleBadType = await adminCreateStyleVersionRoute(
    42 as unknown as string,
    styleDocument,
    token,
  );
  assert.equal(createdStyleBadType.status, 400);
  assert.equal((createdStyleBadType.body as { error?: string }).error, "styleId must be a string");
  const createdStyleSlash = await adminCreateStyleVersionRoute(
    "docs/style",
    styleDocument,
    token,
  );
  assert.equal(createdStyleSlash.status, 400);
  assert.equal((createdStyleSlash.body as { error?: string }).error, "styleId contains unsupported path characters");
  const createdStyleEmbeddedTraversal = await adminCreateStyleVersionRoute(
    "docs..style",
    styleDocument,
    token,
  );
  assert.equal(createdStyleEmbeddedTraversal.status, 400);
  assert.equal((createdStyleEmbeddedTraversal.body as { error?: string }).error, "styleId contains unsupported path characters");
  const publishedStyle = await adminPublishStyleVersionRoute(
    " docs-style ",
    ` ${(createdStyle.body as { id?: string }).id ?? "missing"} `,
    token,
  );
  assert.equal(publishedStyle.status, 200);
  assert.equal(publishedStyle.body !== undefined, true);
  assert.equal(publishedStyle.headers["cache-control"], "no-store");
  const publishStyleConflict = await adminPublishStyleVersionRoute(
    "docs-style",
    (createdStyle.body as { id?: string }).id ?? "missing",
    token,
  );
  assert.equal(publishStyleConflict.status, 409);
  const publishStyleBlank = await adminPublishStyleVersionRoute("docs-style", " ", token);
  assert.equal(publishStyleBlank.status, 400);
  assert.equal((publishStyleBlank.body as { error?: string }).error, "versionId is required");
  const publishStyleBadType = await adminPublishStyleVersionRoute(
    "docs-style",
    42 as unknown as string,
    token,
  );
  assert.equal(publishStyleBadType.status, 400);
  assert.equal((publishStyleBadType.body as { error?: string }).error, "versionId must be a string");
  const publishStyleBackslash = await adminPublishStyleVersionRoute("docs-style", "version\\id", token);
  assert.equal(publishStyleBackslash.status, 400);
  assert.equal((publishStyleBackslash.body as { error?: string }).error, "versionId contains unsupported path characters");
  const publishStyleEmbeddedTraversal = await adminPublishStyleVersionRoute("docs-style", "version..id", token);
  assert.equal(publishStyleEmbeddedTraversal.status, 400);
  assert.equal((publishStyleEmbeddedTraversal.body as { error?: string }).error, "versionId contains unsupported path characters");
  const publishStyleMissing = await adminPublishStyleVersionRoute("docs-style", "missing-version", token);
  assert.equal(publishStyleMissing.status, 409);

  const rotateMissing = await adminRotateApiKeyRoute("missing-project", token);
  assert.equal(rotateMissing.status, 409);

  const auditBeforeFailure = await controlPlaneHealthRoute(token);
  assert.equal(auditBeforeFailure.status, 200);
  const beforeFailureCount = (auditBeforeFailure.body as { auditEventsInWindow?: number }).auditEventsInWindow ?? 0;

  const promoteMissingForAudit = await adminPromoteArtifactRoute(token, "audit-missing-artifact");
  assert.equal(promoteMissingForAudit.status, 409);
  const usageMissingForAudit = await adminProjectUsageRoute("audit-missing-project", "day", token);
  assert.equal(usageMissingForAudit.status, 409);

  const auditAfterFailure = await controlPlaneHealthRoute(token);
  assert.equal(auditAfterFailure.status, 200);
  const afterFailureCount = (auditAfterFailure.body as { auditEventsInWindow?: number }).auditEventsInWindow ?? 0;
  assert.equal(afterFailureCount >= beforeFailureCount + 2, true);
});

test("control-plane exported endpoints reject non-string ids with bad-request errors", async (): Promise<void> => {
  await assert.rejects(
    () => createProjectEndpoint({ name: 42 as unknown as string }, "admin-token"),
    (error: { code?: string; details?: string }) => {
      assert.equal(error.code, ControlPlaneErrorCode.BAD_REQUEST);
      assert.equal(error.details, "Project name is required");
      return true;
    },
  );

  await assert.rejects(
    () => promoteArtifactEndpoint(42 as unknown as string, "admin-token"),
    (error: { code?: string; details?: string }) => {
      assert.equal(error.code, ControlPlaneErrorCode.BAD_REQUEST);
      assert.equal(error.details, "versionId must be a string");
      return true;
    },
  );

  await assert.rejects(
    () => rotateApiKeyEndpoint(42 as unknown as string, "admin-token"),
    (error: { code?: string; details?: string }) => {
      assert.equal(error.code, ControlPlaneErrorCode.BAD_REQUEST);
      assert.equal(error.details, "projectId must be a string");
      return true;
    },
  );

  await assert.rejects(
    () => getProjectUsageEndpoint(42 as unknown as string, "day", "admin-token"),
    (error: { code?: string; details?: string }) => {
      assert.equal(error.code, ControlPlaneErrorCode.BAD_REQUEST);
      assert.equal(error.details, "projectId must be a string");
      return true;
    },
  );

  await assert.rejects(
    () => createStyleVersionEndpoint(42 as unknown as string, { version: 8, sources: {} }, "admin-token"),
    (error: { code?: string; details?: string }) => {
      assert.equal(error.code, ControlPlaneErrorCode.BAD_REQUEST);
      assert.equal(error.details, "styleId must be a string");
      return true;
    },
  );

  await assert.rejects(
    () => publishStyleVersionEndpoint("docs-style", 42 as unknown as string, "admin-token"),
    (error: { code?: string; details?: string }) => {
      assert.equal(error.code, ControlPlaneErrorCode.BAD_REQUEST);
      assert.equal(error.details, "versionId must be a string");
      return true;
    },
  );
});

test("control-plane exported endpoints fail closed on malformed runtime admin tokens", async (): Promise<void> => {
  await assert.rejects(
    () => promoteArtifactEndpoint("cp-artifact-a", 42 as unknown as string),
    (error: { code?: string; details?: string }) => {
      assert.equal(error.code, ControlPlaneErrorCode.UNAUTHORIZED);
      assert.equal(error.details, "Unauthorized");
      return true;
    },
  );

  await assert.rejects(
    () => createProjectEndpoint({ name: "control-plane-project" }, { token: "admin-token" } as unknown as string),
    (error: { code?: string; details?: string }) => {
      assert.equal(error.code, ControlPlaneErrorCode.UNAUTHORIZED);
      assert.equal(error.details, "Unauthorized");
      return true;
    },
  );

  const unauthorizedHealth = await controlPlaneHealthRoute(42 as unknown as string);
  assert.equal(unauthorizedHealth.status, 401);
  assert.equal(
    (unauthorizedHealth.body as { error?: string }).error,
    "Unauthorized",
  );
});

test("control-plane routes allow ops_session and verify operator attribution in audit logs", async (): Promise<void> => {
  const operatorUserId = "op-attributable-user-test";
  await prisma.identityUser.upsert({
    where: { id: operatorUserId },
    create: {
      id: operatorUserId,
      email: "op-test@example.com",
      name: "Operator Test User",
      roleOperatorGrantedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    update: {
      roleOperatorGrantedAt: new Date().toISOString(),
      deletedAt: null,
    },
  });

  const session = await createOperatorSession(operatorUserId);

  const healthRes = await controlPlaneHealthRoute(session.token);
  assert.equal(healthRes.status, 200);

  const project = await createProjectEndpoint({ name: "op-attributable-project" }, session.token);
  assert.equal(typeof project.id, "string");

  const auditRows = await prisma.adminAuditEvent.findMany({
    where: { operation: "create_project" },
    orderBy: { recordedAt: "desc" },
    take: 1,
  });

  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].actor, `operator:${operatorUserId}`);
  assert.equal(auditRows[0].outcome, "ok");
});

