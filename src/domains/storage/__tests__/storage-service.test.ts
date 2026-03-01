import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../../../config/load-config";
import { createObjectStore } from "../storage.service";
import { StorageErrorCode } from "../types";

const baseEnv = {
  NODE_ENV: "development",
  OBJECT_STORE_BUCKET: "storage-service-bucket",
  ADMIN_TOKEN: "admin-token",
  ALLOWED_ORIGINS: "*",
  ALLOWED_TILES_TOKENS: "",
  OBJECT_STORE_MODE: "memory",
  CORS_ALLOW_CREDENTIALS: "false",
  CORS_MAX_AGE_SECONDS: "600",
  ENABLE_RATE_LIMIT: "true",
  RATE_LIMIT_MAX_REQUESTS_PER_MINUTE: "120",
  CACHE_TTL_SECONDS: "300",
  METADATA_CACHE_TTL_SECONDS: "120",
  HEAD_ENABLED: "true",
  STORAGE_MAX_RANGE_BYTES: "1048576",
  OBSERVABILITY_ENABLED: "true",
  CACHE_WARN_THRESHOLD: "0.85",
  CACHE_CRITICAL_THRESHOLD: "0.7",
  ERROR_WARN_THRESHOLD: "0.02",
  ERROR_CRITICAL_THRESHOLD: "0.05",
  INGEST_SNAPSHOT_ID: "snapshot-latest",
  INGEST_SNAPSHOT_URL: "https://example.com/planet-latest.osm.pbf",
};

Object.assign(process.env, baseEnv);

const toBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

const getConfig = () => loadConfig(process.env);

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("storage service writes, reads, and enforces constraints", async (): Promise<void> => {
  const originalMaxRange = process.env.STORAGE_MAX_RANGE_BYTES;

  const config = getConfig();
  const store = createObjectStore(config);

  const key = "artifacts/test/version-a/tiles.pmtiles";
  const source = toBytes("pmtiles-payload");
  const metadata = await store.putObject(key, source, "application/vnd.microsoft.portable");

  assert.equal(metadata.key, key);
  assert.equal(metadata.size, source.byteLength);
  assert.equal(metadata.contentType, "application/vnd.microsoft.portable");

  const head = await store.head(key);
  assert.equal(head.key, key);
  assert.equal(head.size, source.byteLength);
  assert.equal(head.etag, metadata.etag);

  const full = await store.getRange({ key, start: 0, end: source.byteLength - 1 });
  assert.equal(full.start, 0);
  assert.equal(full.end, source.byteLength - 1);
  assert.equal(full.totalBytes, source.byteLength);
  assert.equal(new TextDecoder().decode(full.bytes), "pmtiles-payload");

  const clamped = await store.getRange({ key, start: 4, end: source.byteLength + 5 });
  assert.equal(clamped.start, 4);
  assert.equal(clamped.end, source.byteLength - 1);
  assert.equal(new TextDecoder().decode(clamped.bytes), "les-payload");

  const tail = await store.getRange({ key, start: 4, end: 10 });
  assert.equal(new TextDecoder().decode(tail.bytes), "les-pay");

  const openEnd = await store.getRange({ key, start: 0 });
  assert.equal(openEnd.start, 0);
  assert.equal(openEnd.end, source.byteLength - 1);

  try {
    await store.getRange({ key, start: source.byteLength, end: source.byteLength + 10 });
    assert.fail("expected out-of-range start to fail");
  } catch (error: unknown) {
    assert.equal((error as { code?: string }).code, StorageErrorCode.RANGE_INVALID);
  }

  try {
    await createObjectStore(getConfig()).head("does-not-exist");
    assert.fail("expected missing object to fail");
  } catch (error: unknown) {
    assert.equal((error as { code?: string }).code, StorageErrorCode.NOT_FOUND);
  }

  try {
    await createObjectStore(getConfig()).head("does-not-exist?access_token=secret&x-amz-signature=sig&credential=cred&x-amz-security-token=sst#token=fragment-secret");
    assert.fail("expected missing object to fail with redacted key");
  } catch (error: unknown) {
    assert.equal((error as { code?: string }).code, StorageErrorCode.NOT_FOUND);
    const key = (error as { key?: string }).key ?? "";
    assert.equal(key.includes("secret"), false);
    assert.equal(/[?&]x-amz-signature=sig(?:&|$)/i.test(key), false);
    assert.equal(/[?&]credential=cred(?:&|$)/i.test(key), false);
    assert.equal(/[?&]x-amz-security-token=sst(?:&|$)/i.test(key), false);
    assert.equal(key.includes("access_token=[redacted]"), true);
    assert.equal(key.includes("x-amz-signature=[redacted]"), true);
    assert.equal(key.includes("credential=[redacted]"), true);
    assert.equal(key.includes("x-amz-security-token=[redacted]"), true);
    assert.equal(key.includes("fragment-secret"), false);
    assert.equal(key.includes("#[redacted]"), true);
  }

  try {
    await createObjectStore(getConfig()).getRange({ key: "does-not-exist", start: 0, end: 0 });
    assert.fail("expected missing object range read to fail");
  } catch (error: unknown) {
    assert.equal((error as { code?: string }).code, StorageErrorCode.NOT_FOUND);
  }

  try {
    await store.putObject("artifacts/test/empty.pmtiles", new Uint8Array());
    assert.fail("expected empty write to fail");
  } catch (error: unknown) {
    assert.equal((error as { code?: string }).code, StorageErrorCode.PRECONDITION_FAILED);
  }

  try {
    await store.head("   ");
    assert.fail("expected blank key head to fail");
  } catch (error: unknown) {
    assert.equal((error as { code?: string }).code, StorageErrorCode.PRECONDITION_FAILED);
  }

  try {
    await store.getRange({ key: "   ", start: 0, end: 1 });
    assert.fail("expected blank key range to fail");
  } catch (error: unknown) {
    assert.equal((error as { code?: string }).code, StorageErrorCode.PRECONDITION_FAILED);
  }

  try {
    await store.putObject("   ", source);
    assert.fail("expected blank key write to fail");
  } catch (error: unknown) {
    assert.equal((error as { code?: string }).code, StorageErrorCode.PRECONDITION_FAILED);
  }

  process.env.STORAGE_MAX_RANGE_BYTES = "5";
  const boundedStore = createObjectStore(getConfig());
  const bounded = await boundedStore.getRange({ key, start: 0, end: 20 });
  assert.equal(bounded.start, 0);
  assert.equal(bounded.end, 4);
  assert.equal(new TextDecoder().decode(bounded.bytes), "pmtil");

  if (originalMaxRange === undefined) {
    delete process.env.STORAGE_MAX_RANGE_BYTES;
  } else {
    process.env.STORAGE_MAX_RANGE_BYTES = originalMaxRange;
  }
});

test("storage service supports file:// range reads for external PMTiles", async (): Promise<void> => {
  const config = getConfig();
  const store = createObjectStore(config);

  const root = await mkdtemp(join(tmpdir(), "tileserver-storage-"));
  try {
    const filePath = join(root, "fixture.pmtiles");
    const payload = toBytes("0123456789abcdefghijklmnopqrstuvwxyz");
    await writeFile(filePath, payload);

    const key = pathToFileURL(filePath).toString();
    const head = await store.head(key);
    assert.equal(head.key, key);
    assert.equal(head.size, payload.byteLength);

    const ranged = await store.getRange({ key, start: 10, end: 20 });
    assert.equal(new TextDecoder().decode(ranged.bytes), "abcdefghijk");

    try {
      await store.putObject(key, payload);
      assert.fail("expected file object writes to fail");
    } catch (error: unknown) {
      assert.equal((error as { code?: string }).code, StorageErrorCode.PRECONDITION_FAILED);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
