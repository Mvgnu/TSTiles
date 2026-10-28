import { strict as assert } from "node:assert";
import { generateCsrfToken } from "../components/csrf";
import { getIpHashKey } from "../components/secrets";
import { DEVELOPMENT_ONLY_SECURITY_DEFAULTS } from "../../../config/security-secrets";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

function restoreEnvironment(name: "NODE_ENV" | "CSRF_SIGNING_KEY" | "IP_HASH_KEY", value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    process.env[name] = value;
  }
}

test("production refuses to operate without auth signing secrets", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCsrfKey = process.env.CSRF_SIGNING_KEY;
  const previousIpKey = process.env.IP_HASH_KEY;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.CSRF_SIGNING_KEY;
    delete process.env.IP_HASH_KEY;

    assert.throws(() => generateCsrfToken("browser-session"), /CSRF_SIGNING_KEY/);
    assert.throws(() => getIpHashKey(), /IP_HASH_KEY/);
  } finally {
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("CSRF_SIGNING_KEY", previousCsrfKey);
    restoreEnvironment("IP_HASH_KEY", previousIpKey);
  }
});

test("development-only auth secret defaults are explicit and stable", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCsrfKey = process.env.CSRF_SIGNING_KEY;
  const previousIpKey = process.env.IP_HASH_KEY;
  try {
    process.env.NODE_ENV = "development";
    delete process.env.CSRF_SIGNING_KEY;
    delete process.env.IP_HASH_KEY;

    assert.equal(generateCsrfToken("browser-session"), generateCsrfToken("browser-session"));
    assert.equal(getIpHashKey(), DEVELOPMENT_ONLY_SECURITY_DEFAULTS.ipHashKey);
  } finally {
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("CSRF_SIGNING_KEY", previousCsrfKey);
    restoreEnvironment("IP_HASH_KEY", previousIpKey);
  }
});
