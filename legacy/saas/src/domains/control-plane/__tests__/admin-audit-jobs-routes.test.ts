import { strict as assert } from "node:assert";
import { adminListAuditEventsRoute } from "../routes/admin-audit-events-route";
import { adminListJobsRoute } from "../routes/admin-jobs-route";
import { listAuditEventsEndpoint, listJobsEndpoint } from "../control-plane.service";
import { ControlPlaneError, ControlPlaneErrorCode } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.ADMIN_TOKEN = "admin-token";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.NODE_ENV = "development";

test("audit events route requires admin auth", async (): Promise<void> => {
  const denied = await adminListAuditEventsRoute("bad-token");
  assert.equal(denied.status, 401);
  assert.equal(denied.headers["cache-control"], "no-store");
});

test("jobs route requires admin auth", async (): Promise<void> => {
  const denied = await adminListJobsRoute("bad-token");
  assert.equal(denied.status, 401);
  assert.equal(denied.headers["cache-control"], "no-store");
});

test("audit events route returns array shape", async (): Promise<void> => {
  const ok = await adminListAuditEventsRoute("admin-token");
  assert.equal(ok.status, 200);
  assert.equal(Array.isArray(ok.body), true);
});

test("jobs route returns array shape", async (): Promise<void> => {
  const ok = await adminListJobsRoute("admin-token");
  assert.equal(ok.status, 200);
  assert.equal(Array.isArray(ok.body), true);
});

test("audit events route caps limit at 500", async (): Promise<void> => {
  const ok = await adminListAuditEventsRoute("admin-token", { limit: "10000" });
  assert.equal(ok.status, 200);
  assert.equal(Array.isArray(ok.body), true);
  // 500 row cap is enforced inside listAuditEventsEndpoint regardless of input.
  if (Array.isArray(ok.body)) {
    assert.equal(ok.body.length <= 500, true);
  }
});

test("jobs route caps limit at 200", async (): Promise<void> => {
  const ok = await adminListJobsRoute("admin-token", { limit: "10000" });
  assert.equal(ok.status, 200);
  assert.equal(Array.isArray(ok.body), true);
  if (Array.isArray(ok.body)) {
    assert.equal(ok.body.length <= 200, true);
  }
});

test("audit events route ignores malformed limit and uses default", async (): Promise<void> => {
  const ok = await adminListAuditEventsRoute("admin-token", { limit: "abc" });
  assert.equal(ok.status, 200);
  assert.equal(Array.isArray(ok.body), true);
});

test("listAuditEventsEndpoint rejects malformed admin tokens", async (): Promise<void> => {
  let captured: ControlPlaneError | null = null;
  try {
    await listAuditEventsEndpoint(42 as unknown as string);
  } catch (error) {
    if (error instanceof ControlPlaneError) {
      captured = error;
    }
  }
  assert.equal(captured?.code, ControlPlaneErrorCode.UNAUTHORIZED);
});

test("listJobsEndpoint rejects malformed admin tokens", async (): Promise<void> => {
  let captured: ControlPlaneError | null = null;
  try {
    await listJobsEndpoint(42 as unknown as string);
  } catch (error) {
    if (error instanceof ControlPlaneError) {
      captured = error;
    }
  }
  assert.equal(captured?.code, ControlPlaneErrorCode.UNAUTHORIZED);
});
