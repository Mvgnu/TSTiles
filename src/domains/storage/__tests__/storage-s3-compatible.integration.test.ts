import { strict as assert } from "node:assert";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { loadConfig } from "../../../config/load-config";
import { createObjectStore } from "../storage.service";
import { StorageErrorCode } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

function buildIntegrationEnv(): Record<string, string> {
  return {
    NODE_ENV: "development",
    OBJECT_STORE_MODE: "s3-compatible",
    OBJECT_STORE_BUCKET: process.env.S3_INTEGRATION_BUCKET ?? "tileserver-integration",
    OBJECT_STORE_ENDPOINT: process.env.S3_INTEGRATION_ENDPOINT ?? "http://127.0.0.1:9000",
    OBJECT_STORE_REGION: process.env.S3_INTEGRATION_REGION ?? "us-east-1",
    OBJECT_STORE_ACCESS_KEY_ID: process.env.S3_INTEGRATION_ACCESS_KEY ?? "minioadmin",
    OBJECT_STORE_SECRET_ACCESS_KEY: process.env.S3_INTEGRATION_SECRET_KEY ?? "minioadmin",
    ADMIN_TOKEN: "integration-admin-token",
    ALLOWED_ORIGINS: "*",
    ALLOWED_TILES_TOKENS: "",
  };
}

async function ensureBucket(env: Record<string, string>): Promise<void> {
  const client = new S3Client({
    endpoint: env.OBJECT_STORE_ENDPOINT,
    region: env.OBJECT_STORE_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.OBJECT_STORE_ACCESS_KEY_ID,
      secretAccessKey: env.OBJECT_STORE_SECRET_ACCESS_KEY,
    },
  });
  try {
    await client.send(new CreateBucketCommand({
      Bucket: env.OBJECT_STORE_BUCKET,
    }));
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null
      ? Reflect.get(error, "Code") ?? Reflect.get(error, "code")
      : undefined;
    if (code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists") {
      return;
    }
    throw error;
  }
}

test("s3-compatible storage adapter integration (opt-in)", async (): Promise<void> => {
  if (process.env.RUN_S3_COMPAT_INTEGRATION !== "1") {
    return;
  }

  const env = buildIntegrationEnv();
  await ensureBucket(env);
  const config = loadConfig(env);
  const store = createObjectStore(config);
  const key = `integration/${Date.now()}-${Math.random().toString(16).slice(2)}.pmtiles`;
  const bytes = new TextEncoder().encode("s3-compatible-payload");

  const put = await store.putObject(key, bytes, "application/octet-stream");
  assert.equal(put.key, key);
  assert.equal(put.size, bytes.byteLength);

  const head = await store.head(key);
  assert.equal(head.key, key);
  assert.equal(head.size, bytes.byteLength);

  const ranged = await store.getRange({
    key,
    start: 3,
    end: 11,
  });
  assert.equal(new TextDecoder().decode(ranged.bytes), "compatible");
  assert.equal(ranged.start, 3);
  assert.equal(ranged.end, 11);
  assert.equal(ranged.totalBytes, bytes.byteLength);

  try {
    await store.head(`${key}-missing`);
    assert.fail("expected missing object");
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null
      ? Reflect.get(error, "code")
      : undefined;
    assert.equal(code, StorageErrorCode.NOT_FOUND);
  }
});
