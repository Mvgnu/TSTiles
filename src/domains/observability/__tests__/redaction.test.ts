import { strict as assert } from "node:assert";
import { redactHeaders } from "../analytics/redaction";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("redactHeaders removes sensitive headers and query credentials", () => {
  const output = redactHeaders({
    authorization: "Bearer token-value",
    "x-api-key": "api-key-value",
    cookie: "session=abc",
    referer: "https://example.com/map?access_token=secret&x-amz-signature=sig#token=fragment-secret",
    "x-forwarded-url": "https://example.com/path?credential=cred&token=abc&x-amz-security-token=sst",
    "content-type": "application/json",
  });

  assert.equal(output.authorization, "[redacted]");
  assert.equal(output["x-api-key"], "[redacted]");
  assert.equal(output.cookie, "[redacted]");
  assert.equal(output.referer.includes("secret"), false);
  assert.equal(/[?&]x-amz-signature=sig(?:&|$)/i.test(output.referer), false);
  assert.equal(output.referer.includes("access_token=[redacted]"), true);
  assert.equal(output.referer.includes("x-amz-signature=[redacted]"), true);
  assert.equal(output.referer.includes("fragment-secret"), false);
  assert.equal(output.referer.includes("#[redacted]"), true);
  assert.equal(/[?&]credential=cred(?:&|$)/i.test(output["x-forwarded-url"]), false);
  assert.equal(output["x-forwarded-url"].includes("token=abc"), false);
  assert.equal(output["x-forwarded-url"].includes("x-amz-security-token=sst"), false);
  assert.equal(output["x-forwarded-url"].includes("credential=[redacted]"), true);
  assert.equal(output["x-forwarded-url"].includes("token=[redacted]"), true);
  assert.equal(output["x-forwarded-url"].includes("x-amz-security-token=[redacted]"), true);
  assert.equal(output["content-type"], "application/json");
});
