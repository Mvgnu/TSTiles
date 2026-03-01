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
import { registerArtifact } from "../../artifact/artifact.service";

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
  const bad = await adminIngestRoute("bad-token");
  assert.equal(bad.status, 401);
  assert.equal(bad.headers["cache-control"], "no-store");
  const badList = await adminListArtifactsRoute("bad-token");
  assert.equal(badList.status, 401);
  assert.equal(badList.headers["cache-control"], "no-store");
  const badPromote = await adminPromoteArtifactRoute("bad-token", "artifact-a");
  assert.equal(badPromote.status, 401);
  assert.equal(badPromote.headers["cache-control"], "no-store");
  const badRollback = await adminRollbackArtifactRoute("bad-token");
  assert.equal(badRollback.status, 401);
  assert.equal(badRollback.headers["cache-control"], "no-store");
  const badHealth = await controlPlaneHealthRoute("bad-token");
  assert.equal(badHealth.status, 401);
  assert.equal(badHealth.headers["cache-control"], "no-store");

  registerArtifact({
    id: "artifact-a",
    key: "artifacts/artifact-a/tiles.pmtiles",
    checksum: "abc",
    byteSize: 120,
    createdAt: new Date().toISOString(),
    validated: true,
  });
  registerArtifact({
    id: "artifact-b",
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

  const first = await adminPromoteArtifactRoute(token, " artifact-a ");
  assert.equal(first.status, 200);
  assert.equal(first.headers["cache-control"], "no-store");
  const promoteMissing = await adminPromoteArtifactRoute(token, "missing-artifact");
  assert.equal(promoteMissing.status, 409);
  const promoteBlank = await adminPromoteArtifactRoute(token, "   ");
  assert.equal(promoteBlank.status, 400);
  const promote = await adminPromoteArtifactRoute(token, "artifact-b");
  assert.equal(promote.status, 200);
  const promoteConflict = await adminPromoteArtifactRoute(token, "artifact-b");
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

  const rotate = await adminRotateApiKeyRoute((projectCreate.body as { id?: string }).id ?? "missing", token);
  assert.equal(rotate.status, 200);
  assert.equal(rotate.headers["cache-control"], "no-store");
  assert.equal(typeof (rotate.body as { keyId?: string }).keyId, "string");
  const rotateTrimmed = await adminRotateApiKeyRoute(` ${(projectCreate.body as { id?: string }).id ?? "missing"} `, token);
  assert.equal(rotateTrimmed.status, 200);
  const rotateBlank = await adminRotateApiKeyRoute(" ", token);
  assert.equal(rotateBlank.status, 400);

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
  const usageTrimmedInputs = await adminProjectUsageRoute(` ${(projectCreate.body as { id?: string }).id ?? "missing"} `, " month ", token);
  assert.equal(usageTrimmedInputs.status, 200);
  const usageBlankProject = await adminProjectUsageRoute("  ", "day", token);
  assert.equal(usageBlankProject.status, 400);

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
  const publishStyleMissing = await adminPublishStyleVersionRoute("docs-style", "missing-version", token);
  assert.equal(publishStyleMissing.status, 409);

  const rotateMissing = await adminRotateApiKeyRoute("missing-project", token);
  assert.equal(rotateMissing.status, 409);

  const auditBeforeFailure = await controlPlaneHealthRoute(token);
  assert.equal(auditBeforeFailure.status, 200);
  const beforeFailureCount = (auditBeforeFailure.body as { auditEventsInWindow?: number }).auditEventsInWindow ?? 0;

  const promoteMissingForAudit = await adminPromoteArtifactRoute(token, "audit-missing-artifact");
  assert.equal(promoteMissingForAudit.status, 409);

  const auditAfterFailure = await controlPlaneHealthRoute(token);
  assert.equal(auditAfterFailure.status, 200);
  const afterFailureCount = (auditAfterFailure.body as { auditEventsInWindow?: number }).auditEventsInWindow ?? 0;
  assert.equal(afterFailureCount >= beforeFailureCount + 1, true);
});
