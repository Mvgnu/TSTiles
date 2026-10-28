import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveVectorTile } from "../../domains/tile-resolver/tile-resolver.service";
import { bootstrapDemoData } from "../demo-bootstrap";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

const validAdminToken = "0U0EkjpQDrwm6YDVV4IKHrOBUk-OoDFtX16CH1CWN6A";
const validCsrfKey = "0040eb7fc425136c97c36f23e6134959141821d5a74cb8f83eead0b6c862a0d3";
const validIpHashKey = "0b95b959cb5e5eb8135341cc64fb31cd9bca225f445806667a56e680bfb162c1";
const validMfaKey = "2c4b97e4c46f72900dd6eb20ed7cefb0d7f366ccf2275195fa2450c0072a334e";

const envKeys = [
  "NODE_ENV",
  "OBJECT_STORE_MODE",
  "OBJECT_STORE_BUCKET",
  "ADMIN_API_TOKEN",
  "ADMIN_TOKEN",
  "CSRF_SIGNING_KEY",
  "IP_HASH_KEY",
  "MFA_ENCRYPTION_KEY",
  "ALLOWED_TILES_TOKENS",
  "ALLOWED_ORIGINS",
  "DEMO_PMTILES_PATH",
  "DEMO_PMTILES_KEY",
  "DEMO_STYLE_FILES",
  "STYLE_SEED_KEYS",
  "DEMO_STYLE_SEED_KEYS",
] as const;

type ManagedEnvKey = (typeof envKeys)[number];

function captureEnv(): Record<ManagedEnvKey, string | undefined> {
  const snapshot = {} as Record<ManagedEnvKey, string | undefined>;
  for (const key of envKeys) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: Record<ManagedEnvKey, string | undefined>): void {
  for (const key of envKeys) {
    const value = snapshot[key];
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
}

test("bootstrapDemoData defaults development to the checked-in PMTiles fixture", async (): Promise<void> => {
  const env = captureEnv();
  try {
    process.env.NODE_ENV = "development";
    process.env.OBJECT_STORE_MODE = "memory";
    process.env.OBJECT_STORE_BUCKET = `fixture-bootstrap-${Date.now()}`;
    Reflect.deleteProperty(process.env, "ADMIN_API_TOKEN");
    Reflect.deleteProperty(process.env, "ADMIN_TOKEN");
    Reflect.deleteProperty(process.env, "CSRF_SIGNING_KEY");
    Reflect.deleteProperty(process.env, "IP_HASH_KEY");
    Reflect.deleteProperty(process.env, "MFA_ENCRYPTION_KEY");
    process.env.ALLOWED_TILES_TOKENS = "demo-public-token";
    process.env.ALLOWED_ORIGINS = "*";
    Reflect.deleteProperty(process.env, "DEMO_PMTILES_PATH");
    Reflect.deleteProperty(process.env, "DEMO_PMTILES_KEY");
    Reflect.deleteProperty(process.env, "DEMO_STYLE_FILES");
    Reflect.deleteProperty(process.env, "STYLE_SEED_KEYS");
    Reflect.deleteProperty(process.env, "DEMO_STYLE_SEED_KEYS");

    const state = await bootstrapDemoData();
    const tile = await resolveVectorTile({
      artifactId: state.artifactId,
      z: 0,
      x: 0,
      y: 0,
    });

    assert.equal(
      state.pmtilesLocalPath,
      resolve(__dirname, "../../domains/tile-resolver/__fixtures__/test_fixture_1.pmtiles"),
    );
    assert.equal(state.artifactAvailable, true);
    assert.equal(state.adminToken, "demo-admin-token");
    assert.equal(tile.contentType, "application/vnd.mapbox-vector-tile");
    assert.equal(tile.bytes.byteLength > 0, true);
  } finally {
    restoreEnv(env);
  }
});

test("bootstrapDemoData supports filesystem-backed PMTiles paths outside development", async (): Promise<void> => {
  const env = captureEnv();
  const root = await mkdtemp(join(tmpdir(), "tileserver-demo-bootstrap-"));
  try {
    const pmtilesPath = join(root, "demo.pmtiles");
    const stylePath = join(root, "demo-style.json");

    await writeFile(pmtilesPath, "demo-pmtiles-payload");
    await writeFile(
      stylePath,
      JSON.stringify({
        version: 8,
        sources: {
          map: {
            type: "vector",
            tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
          },
        },
        glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
        sprites: "/v1/styles/{styleId}/sprites/sprite",
        layers: [],
      }),
      "utf8",
    );

    process.env.NODE_ENV = "production";
    process.env.OBJECT_STORE_MODE = "filesystem";
    process.env.OBJECT_STORE_BUCKET = root;
    Reflect.deleteProperty(process.env, "ADMIN_API_TOKEN");
    process.env.ADMIN_TOKEN = validAdminToken;
    process.env.CSRF_SIGNING_KEY = validCsrfKey;
    process.env.IP_HASH_KEY = validIpHashKey;
    process.env.MFA_ENCRYPTION_KEY = validMfaKey;
    process.env.ALLOWED_TILES_TOKENS = "fixture-public-token";
    process.env.ALLOWED_ORIGINS = "*";
    process.env.DEMO_PMTILES_PATH = pmtilesPath;
    Reflect.deleteProperty(process.env, "DEMO_PMTILES_KEY");
    process.env.DEMO_STYLE_FILES = stylePath;
    Reflect.deleteProperty(process.env, "STYLE_SEED_KEYS");
    Reflect.deleteProperty(process.env, "DEMO_STYLE_SEED_KEYS");

    const state = await bootstrapDemoData();
    assert.equal(state.artifactAvailable, true);
    assert.equal(state.pmtilesLocalPath, pmtilesPath);
    assert.equal(state.pmtilesLocation, pmtilesPath);
    assert.equal(state.accessToken, "fixture-public-token");
    assert.equal(state.styleIds.includes("demo-style"), true);
  } finally {
    restoreEnv(env);
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrapDemoData refuses production before I/O when a required secret is missing", async (): Promise<void> => {
  const env = captureEnv();
  try {
    process.env.NODE_ENV = "production";
    process.env.OBJECT_STORE_MODE = "filesystem";
    process.env.OBJECT_STORE_BUCKET = "unused-production-bucket";
    Reflect.deleteProperty(process.env, "ADMIN_API_TOKEN");
    process.env.ADMIN_TOKEN = validAdminToken;
    process.env.ALLOWED_TILES_TOKENS = "production-tile-token";
    Reflect.deleteProperty(process.env, "CSRF_SIGNING_KEY");
    process.env.IP_HASH_KEY = validIpHashKey;
    process.env.MFA_ENCRYPTION_KEY = validMfaKey;
    Reflect.deleteProperty(process.env, "DEMO_PMTILES_PATH");
    Reflect.deleteProperty(process.env, "DEMO_PMTILES_KEY");

    await assert.rejects(bootstrapDemoData(), /CSRF_SIGNING_KEY/);
    assert.equal(process.env.ADMIN_TOKEN, validAdminToken);
  } finally {
    restoreEnv(env);
  }
});
