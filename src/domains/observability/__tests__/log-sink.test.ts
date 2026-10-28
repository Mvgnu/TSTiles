import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeliverySignal } from "../../../contracts/types";
import type { CacheHealthSignal } from "../types";
import { emitDeliverySignalToSink, emitSloSignalToSink } from "../analytics/log-sink";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

function buildDeliverySignal(): DeliverySignal {
  return {
    schemaVersion: 1,
    artifactVersion: "artifact-test",
    tilePath: "/v1/tiles/0/0/0.mvt?access_token=secret-token-value&keep=ok#frag",
    cacheStatus: "miss",
    originRead: true,
    responseBytes: 4096,
    latencyMs: 12,
    statusCode: 200,
    normalizedMethod: "GET",
    receivedAt: new Date().toISOString(),
  };
}

function buildCriticalCacheHealth(): CacheHealthSignal {
  return {
    artifactVersion: "artifact-test",
    endpointGroup: "/tiles/{z}/{x}/{y}.mvt",
    status: "critical",
    cacheHitRatio: 0.4,
    errorRate: 0.1,
    window: {
      artifactVersion: "artifact-test",
      endpointGroup: "/tiles/{z}/{x}/{y}.mvt",
      windowStart: 1_700_000_000_000,
      totalRequests: 100,
      cacheHits: 40,
      originReads: 60,
      errors: 10,
    },
  };
}

test("log-sink writes redacted delivery signal NDJSON to file", () => {
  const dir = mkdtempSync(join(tmpdir(), "tileserver-log-sink-"));
  const path = join(dir, "delivery.ndjson");
  try {
    emitDeliverySignalToSink({ kind: "file", path }, buildDeliverySignal());
    emitDeliverySignalToSink({ kind: "file", path }, buildDeliverySignal());

    const content = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(content.length, 2);
    const first = JSON.parse(content[0]) as Record<string, unknown>;
    assert.equal(first.type, "delivery_signal");
    assert.equal(first.artifactVersion, "artifact-test");
    assert.equal(first.statusCode, 200);
    assert.equal(typeof first.emittedAt, "string");
    // Token must be redacted, fragment dropped, unrelated query preserved.
    const tilePath = String(first.tilePath);
    assert.equal(tilePath.includes("secret-token-value"), false);
    assert.equal(tilePath.includes("[redacted]"), true);
    assert.equal(tilePath.includes("keep=ok"), true);
    assert.equal(tilePath.includes("#frag"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("log-sink emits SLO alerts only for warn or critical statuses", () => {
  const dir = mkdtempSync(join(tmpdir(), "tileserver-log-sink-slo-"));
  const path = join(dir, "alerts.ndjson");
  try {
    emitSloSignalToSink({ kind: "file", path }, { ...buildCriticalCacheHealth(), status: "ok" });
    let writtenAfterOk = "";
    try {
      writtenAfterOk = readFileSync(path, "utf8");
    } catch {
      writtenAfterOk = "";
    }
    assert.equal(writtenAfterOk, "");

    emitSloSignalToSink({ kind: "file", path }, buildCriticalCacheHealth());
    emitSloSignalToSink({ kind: "file", path }, { ...buildCriticalCacheHealth(), status: "warn" });

    const content = readFileSync(path, "utf8").trim().split("\n");
    assert.equal(content.length, 2);
    const first = JSON.parse(content[0]) as Record<string, unknown>;
    assert.equal(first.type, "slo_alert");
    assert.equal(first.status, "critical");
    assert.equal(first.totalRequests, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("log-sink with kind=none is a no-op for delivery and SLO emits", () => {
  const dir = mkdtempSync(join(tmpdir(), "tileserver-log-sink-none-"));
  const path = join(dir, "should-not-exist.ndjson");
  try {
    emitDeliverySignalToSink({ kind: "none" }, buildDeliverySignal());
    emitSloSignalToSink({ kind: "none" }, buildCriticalCacheHealth());
    let written = "";
    try {
      written = readFileSync(path, "utf8");
    } catch {
      written = "";
    }
    assert.equal(written, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
