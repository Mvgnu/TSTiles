import { strict as assert } from "node:assert";
import { classifySLOBreach, evaluateTileSLOs } from "../observability.service";
import { ObservabilityError, ObservabilityErrorCode } from "../types";
import { CONTRACT_SCHEMA_VERSION } from "../../../contracts/types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("observability SLO evaluation and validation", () => {
Object.assign(process.env, {
  OBJECT_STORE_BUCKET: "test-bucket",
  ADMIN_TOKEN: "admin-token",
  ALLOWED_ORIGINS: "*",
  ALLOWED_TILES_TOKENS: "",
  NODE_ENV: "development",
  CACHE_TTL_SECONDS: "5",
  METADATA_CACHE_TTL_SECONDS: "5",
  STORAGE_MAX_RANGE_BYTES: "1024",
  OBSERVABILITY_ENABLED: "true",
  CACHE_WARN_THRESHOLD: "0.9",
  CACHE_CRITICAL_THRESHOLD: "0.7",
  ERROR_WARN_THRESHOLD: "0.01",
  ERROR_CRITICAL_THRESHOLD: "0.03",
});

const warningWindow = classifySLOBreach({
  cacheHits: 8,
  totalRequests: 10,
  errors: 0,
});
assert.equal(warningWindow, "warn");

const criticalWindow = classifySLOBreach({
  cacheHits: 8,
  totalRequests: 10,
  errors: 1,
});
assert.equal(criticalWindow, "critical");

const emptyWindow = classifySLOBreach({
  cacheHits: 0,
  totalRequests: 0,
  errors: 0,
});
assert.equal(emptyWindow, "ok");

const okWindow = evaluateTileSLOs({
  schemaVersion: 1,
  artifactVersion: "artifact-a",
  tilePath: "/tiles/1/2/3.mvt",
  cacheStatus: "miss",
  originRead: true,
  responseBytes: 128,
  latencyMs: 10,
  statusCode: 200,
  normalizedMethod: "GET",
  receivedAt: "2026-01-01T00:00:00.000Z",
});
assert.equal(okWindow.endpointGroup, "/tiles/{z}/{x}/{y}.mvt");
assert.equal(okWindow.status === "critical" || okWindow.status === "warn" || okWindow.status === "ok", true);

process.env.OBSERVABILITY_ENABLED = "false";
const disabled = evaluateTileSLOs({
  schemaVersion: 1,
  artifactVersion: "artifact-b",
  tilePath: "/tiles/1/2/3.mvt",
  cacheStatus: "miss",
  originRead: true,
  responseBytes: 128,
  latencyMs: 10,
  statusCode: 200,
  normalizedMethod: "GET",
  receivedAt: "2026-01-01T00:01:00.000Z",
});
assert.equal(disabled.artifactVersion, "artifact-b");

const sameWindowFirst = evaluateTileSLOs({
  schemaVersion: 1,
  artifactVersion: "artifact-e",
  tilePath: "/tiles/4/5/6.mvt",
  cacheStatus: "hit",
  originRead: false,
  responseBytes: 256,
  latencyMs: 12,
  statusCode: 200,
  normalizedMethod: "GET",
  receivedAt: "2026-01-01T00:00:10.000Z",
});
const sameWindowSecond = evaluateTileSLOs({
  schemaVersion: 1,
  artifactVersion: "artifact-e",
  tilePath: "/tiles/4/5/6.mvt",
  cacheStatus: "miss",
  originRead: false,
  responseBytes: 256,
  latencyMs: 12,
  statusCode: 200,
  normalizedMethod: "GET",
  receivedAt: "2026-01-01T00:10:00.000Z",
});
assert.equal(sameWindowFirst.window.endpointGroup, "/tiles/{z}/{x}/{y}.mvt");
assert.equal(sameWindowSecond.window.windowStart, sameWindowFirst.window.windowStart);
assert.equal(sameWindowSecond.window.totalRequests, 2);

const metadataWindow = evaluateTileSLOs({
  schemaVersion: 1,
  artifactVersion: "artifact-e",
  tilePath: "/tiles/metadata",
  cacheStatus: "miss",
  originRead: true,
  responseBytes: 128,
  latencyMs: 9,
  statusCode: 200,
  normalizedMethod: "GET",
  receivedAt: "2026-01-01T00:10:10.000Z",
});
assert.equal(metadataWindow.window.endpointGroup, "/tiles/metadata");
assert.equal(metadataWindow.window.totalRequests, 1);

const prefixedTileWindow = evaluateTileSLOs({
  schemaVersion: 1,
  artifactVersion: " artifact-prefixed ",
  tilePath: " /v1/tiles/4/5/6.mvt?access_token=redacted ",
  cacheStatus: "hit",
  originRead: false,
  responseBytes: 256,
  latencyMs: 12,
  statusCode: 200,
  normalizedMethod: "GET",
  receivedAt: "2026-01-01T00:11:00.000Z",
});
assert.equal(prefixedTileWindow.window.endpointGroup, "/tiles/{z}/{x}/{y}.mvt");
assert.equal(prefixedTileWindow.artifactVersion, "artifact-prefixed");

const prefixedMetadataWindow = evaluateTileSLOs({
  schemaVersion: 1,
  artifactVersion: "artifact-prefixed-meta",
  tilePath: "/v1/tiles/metadata?access_token=redacted",
  cacheStatus: "miss",
  originRead: true,
  responseBytes: 128,
  latencyMs: 9,
  statusCode: 200,
  normalizedMethod: "GET",
  receivedAt: "2026-01-01T00:12:00.000Z",
});
assert.equal(prefixedMetadataWindow.window.endpointGroup, "/tiles/metadata");

const rasterWindow = evaluateTileSLOs({
  schemaVersion: 1,
  artifactVersion: "artifact-raster",
  tilePath: "/v1/raster/basic/1/2/3.png?access_token=redacted",
  cacheStatus: "hit",
  originRead: false,
  responseBytes: 512,
  latencyMs: 14,
  statusCode: 200,
  normalizedMethod: "GET",
  receivedAt: "2026-01-01T00:12:30.000Z",
});
assert.equal(rasterWindow.window.endpointGroup, "/raster/{styleId}/{z}/{x}/{y}.{format}");

const staticWindow = evaluateTileSLOs({
  schemaVersion: 1,
  artifactVersion: "artifact-static",
  tilePath: "/v1/static/basic/-122.4194,37.7749,12/640x480.webp?access_token=redacted",
  cacheStatus: "miss",
  originRead: true,
  responseBytes: 1024,
  latencyMs: 20,
  statusCode: 200,
  normalizedMethod: "GET",
  receivedAt: "2026-01-01T00:13:00.000Z",
});
assert.equal(staticWindow.window.endpointGroup, "/static/{styleId}/{lon},{lat},{zoom}/{width}x{height}.{format}");

let invalidSignalFailed = false;
try {
  evaluateTileSLOs({
    artifactVersion: "artifact-c",
    tilePath: "bad",
    cacheStatus: "bad" as unknown as "hit" | "miss",
    originRead: true,
    responseBytes: 128,
    latencyMs: 10,
    statusCode: 200,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    normalizedMethod: "GET",
    receivedAt: "2026-01-01T00:02:00.000Z",
  } as unknown as {
    readonly artifactVersion: string;
    readonly tilePath: string;
    readonly cacheStatus: "hit" | "miss";
    readonly originRead: boolean;
    readonly responseBytes: number;
    readonly latencyMs: number;
    readonly statusCode: number;
    readonly schemaVersion: 1;
    readonly normalizedMethod: "GET" | "HEAD" | "OPTIONS";
    readonly receivedAt: string;
  });
} catch (error: unknown) {
  invalidSignalFailed = true;
  assert.ok(error instanceof ObservabilityError);
  assert.equal((error as ObservabilityError).code, ObservabilityErrorCode.SIGNAL_SCHEMA_INVALID);
}
assert.equal(invalidSignalFailed, true);

let invalidPathShapeFailed = false;
try {
  evaluateTileSLOs({
    schemaVersion: 1,
    artifactVersion: "artifact-invalid-path",
    tilePath: "tiles/1/2/3.mvt",
    cacheStatus: "hit",
    originRead: false,
    responseBytes: 64,
    latencyMs: 4,
    statusCode: 200,
    normalizedMethod: "GET",
    receivedAt: "2026-01-01T00:14:00.000Z",
  });
} catch (error: unknown) {
  invalidPathShapeFailed = true;
  assert.ok(error instanceof ObservabilityError);
  assert.equal((error as ObservabilityError).code, ObservabilityErrorCode.SIGNAL_SCHEMA_INVALID);
}
assert.equal(invalidPathShapeFailed, true);

process.env.CACHE_WARN_THRESHOLD = "0.5";
process.env.CACHE_CRITICAL_THRESHOLD = "0.7";
let unsupportedSchemaFailed = false;
try {
  evaluateTileSLOs({
    schemaVersion: (CONTRACT_SCHEMA_VERSION + 1) as unknown as 1,
    artifactVersion: "artifact-version",
    tilePath: "/tiles/1/2/3.mvt",
    cacheStatus: "miss",
    originRead: true,
    responseBytes: 128,
    latencyMs: 10,
    statusCode: 200,
    normalizedMethod: "GET",
    receivedAt: "2026-01-01T00:03:00.000Z",
  });
} catch (error: unknown) {
  unsupportedSchemaFailed = true;
  assert.ok(error instanceof ObservabilityError);
  assert.equal((error as ObservabilityError).code, ObservabilityErrorCode.SIGNAL_SCHEMA_INVALID);
}
assert.equal(unsupportedSchemaFailed, true);

let thresholdFailed = false;
try {
  evaluateTileSLOs({
    schemaVersion: 1,
    artifactVersion: "artifact-d",
    tilePath: "/tiles/1/2/3.mvt",
    cacheStatus: "miss",
    originRead: true,
    responseBytes: 128,
    latencyMs: 10,
    statusCode: 200,
    normalizedMethod: "GET",
    receivedAt: "2026-01-01T00:03:00.000Z",
  });
} catch (error: unknown) {
  thresholdFailed = true;
  assert.ok(error instanceof ObservabilityError);
  assert.equal((error as ObservabilityError).code, ObservabilityErrorCode.SLO_THRESHOLD_MISCONFIGURED);
}
assert.equal(thresholdFailed, true);

let equalThresholdFailed = false;
process.env.CACHE_WARN_THRESHOLD = "0.8";
process.env.CACHE_CRITICAL_THRESHOLD = "0.8";
try {
  evaluateTileSLOs({
    schemaVersion: 1,
    artifactVersion: "artifact-e",
    tilePath: "/tiles/1/2/3.mvt",
    cacheStatus: "miss",
    originRead: true,
    responseBytes: 128,
    latencyMs: 10,
    statusCode: 200,
    normalizedMethod: "GET",
    receivedAt: "2026-01-01T00:04:00.000Z",
  });
} catch (error: unknown) {
  equalThresholdFailed = true;
  assert.ok(error instanceof ObservabilityError);
  assert.equal((error as ObservabilityError).code, ObservabilityErrorCode.SLO_THRESHOLD_MISCONFIGURED);
}
assert.equal(equalThresholdFailed, true);

process.env.CACHE_WARN_THRESHOLD = "0.9";
process.env.CACHE_CRITICAL_THRESHOLD = "0.7";
process.env.OBSERVABILITY_ENABLED = "true";
process.env.OBS_ALERT_FORCE_FAIL = "true";
let alertDispatchFailed = false;
try {
  evaluateTileSLOs({
    schemaVersion: 1,
    artifactVersion: "artifact-alert-fail",
    tilePath: "/tiles/1/1/1.mvt",
    cacheStatus: "miss",
    originRead: true,
    responseBytes: 32,
    latencyMs: 3,
    statusCode: 200,
    normalizedMethod: "GET",
    receivedAt: "2026-01-01T00:15:00.000Z",
  });
} catch (error: unknown) {
  alertDispatchFailed = true;
  assert.ok(error instanceof ObservabilityError);
  assert.equal((error as ObservabilityError).code, ObservabilityErrorCode.ALERT_DISPATCH_FAILED);
}
assert.equal(alertDispatchFailed, true);

process.env.OBSERVABILITY_ENABLED = "false";
const alertFailureSuppressedWhenDisabled = evaluateTileSLOs({
  schemaVersion: 1,
  artifactVersion: "artifact-alert-disabled",
  tilePath: "/tiles/1/1/1.mvt",
  cacheStatus: "miss",
  originRead: true,
  responseBytes: 32,
  latencyMs: 3,
  statusCode: 200,
  normalizedMethod: "GET",
  receivedAt: "2026-01-01T00:16:00.000Z",
});
assert.equal(alertFailureSuppressedWhenDisabled.artifactVersion, "artifact-alert-disabled");

process.env.OBSERVABILITY_ENABLED = "true";
delete process.env.OBS_ALERT_FORCE_FAIL;
});
