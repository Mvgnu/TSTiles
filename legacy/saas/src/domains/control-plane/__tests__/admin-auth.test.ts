import { strict as assert } from "node:assert";
import { isAuthorized, normalizeAdminToken } from "../auth/admin-auth";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("normalizeAdminToken trims and strips bearer prefix", (): void => {
  assert.equal(normalizeAdminToken(undefined), undefined);
  assert.equal(normalizeAdminToken("   "), undefined);
  assert.equal(normalizeAdminToken("admin-token"), "admin-token");
  assert.equal(normalizeAdminToken("  Bearer admin-token  "), "admin-token");
});

test("isAuthorized accepts canonical and bearer admin token formats", async (): Promise<void> => {
  process.env.OBJECT_STORE_BUCKET = "test-bucket";
  process.env.ADMIN_TOKEN = "admin-token";
  process.env.ALLOWED_ORIGINS = "*";
  process.env.ALLOWED_TILES_TOKENS = "";
  process.env.NODE_ENV = "development";

  assert.equal(await isAuthorized(undefined), false);
  assert.equal(await isAuthorized(""), false);
  assert.equal(await isAuthorized("wrong-token"), false);
  assert.equal(await isAuthorized("admin-token"), true);
  assert.equal(await isAuthorized("  admin-token  "), true);
  assert.equal(await isAuthorized("Bearer admin-token"), true);
  assert.equal(await isAuthorized(" bearer admin-token  "), true);
});

