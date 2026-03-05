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

test("isAuthorized accepts canonical and bearer admin token formats", (): void => {
  process.env.OBJECT_STORE_BUCKET = "test-bucket";
  process.env.ADMIN_TOKEN = "admin-token";
  process.env.ALLOWED_ORIGINS = "*";
  process.env.ALLOWED_TILES_TOKENS = "";
  process.env.NODE_ENV = "development";

  assert.equal(isAuthorized(undefined), false);
  assert.equal(isAuthorized(""), false);
  assert.equal(isAuthorized("wrong-token"), false);
  assert.equal(isAuthorized("admin-token"), true);
  assert.equal(isAuthorized("  admin-token  "), true);
  assert.equal(isAuthorized("Bearer admin-token"), true);
  assert.equal(isAuthorized(" bearer admin-token  "), true);
});
