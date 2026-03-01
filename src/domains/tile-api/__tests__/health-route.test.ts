import { strict as assert } from "node:assert";
import { handleHealthRequest } from "../tile-api.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("health endpoint returns service status without auth", async (): Promise<void> => {
  process.env.OBJECT_STORE_BUCKET = "test-bucket";
  process.env.ADMIN_TOKEN = "admin-token";
  process.env.NODE_ENV = "development";
  const originalHeadEnabled = process.env.HEAD_ENABLED;

  const healthGet = await handleHealthRequest({
    method: "GET",
    path: "/v1/health",
    headers: {},
  });
  assert.equal(healthGet.status, 200);
  assert.equal(healthGet.headers["content-type"], "application/json");
  assert.equal(healthGet.headers["cache-control"], "no-store");
  assert.equal(healthGet.body instanceof Uint8Array, true);
  if (healthGet.body instanceof Uint8Array) {
    const payload = JSON.parse(new TextDecoder().decode(healthGet.body)) as { status: string; service: string; timestamp: string };
    assert.equal(payload.status, "ok");
    assert.equal(payload.service, "tileserver");
    assert.equal(typeof payload.timestamp, "string");
    assert.equal(healthGet.headers["content-length"], String(healthGet.body.byteLength));
  }

  const healthHead = await handleHealthRequest({
    method: "HEAD",
    path: "/health",
    headers: {},
  });
  assert.equal(healthHead.status, 200);
  assert.equal(healthHead.body, undefined);
  assert.equal(healthHead.headers["cache-control"], "no-store");
  assert.equal(typeof healthHead.headers["content-length"], "string");

  process.env.HEAD_ENABLED = "false";
  const healthHeadDisabled = await handleHealthRequest({
    method: "HEAD",
    path: "/health",
    headers: {},
  });
  assert.equal(healthHeadDisabled.status, 405);
  assert.equal(healthHeadDisabled.body, undefined);
  assert.equal(healthHeadDisabled.headers["cache-control"], "no-store");
  if (originalHeadEnabled === undefined) {
    delete process.env.HEAD_ENABLED;
  } else {
    process.env.HEAD_ENABLED = originalHeadEnabled;
  }

  const healthBadMethod = await handleHealthRequest({
    method: "OPTIONS",
    path: "/health",
    headers: {},
  } as unknown as Parameters<typeof handleHealthRequest>[0]);
  assert.equal(healthBadMethod.status, 400);
  assert.equal(healthBadMethod.body instanceof Uint8Array, true);
  assert.equal(healthBadMethod.headers["cache-control"], "no-store");

  const healthBadPath = await handleHealthRequest({
    method: "GET",
    path: "/health/status",
    headers: {},
  });
  assert.equal(healthBadPath.status, 404);
  assert.equal(healthBadPath.headers["cache-control"], "no-store");
  assert.equal(healthBadPath.body instanceof Uint8Array, true);

  const healthBadPathHead = await handleHealthRequest({
    method: "HEAD",
    path: "/health/status",
    headers: {},
  });
  assert.equal(healthBadPathHead.status, 404);
  assert.equal(healthBadPathHead.headers["cache-control"], "no-store");
  assert.equal(healthBadPathHead.body, undefined);
});
