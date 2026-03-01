import { strict as assert } from "node:assert";
import { sanitizeToken, isTileCoordinates, normalizeHeaderMap, denyPayload, createDeliverySignal } from "../contracts";
import { CONTRACT_SCHEMA_VERSION as SCHEMA_VERSION } from "../types";
import { ContractError, ContractErrorCode } from "../types";
import { createArtifactRegisteredEvent, createArtifactPromotedEvent, createArtifactRollbackEvent } from "../events/artifact-events";
import { createIngestCompletedEvent } from "../events/ingest-events";
import { parseDeliverySignal, toDeliverySignalJson } from "../events/delivery-signal";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("contracts encode and parse payloads", () => {
  const headers = normalizeHeaderMap({
    "Content-Type": "  application/json ",
    "x-custom": "value",
  });
  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers["x-custom"], "value");

  assert.equal(sanitizeToken(undefined), "anon");
  assert.equal(sanitizeToken("123456789012"), "1...");
  assert.equal(sanitizeToken("1234567890123"), "1234…0123");

  assert.equal(isTileCoordinates({ z: 1, x: 2, y: 3 }), true);
  assert.equal(isTileCoordinates({ z: 1, x: -1, y: 3 }), false);
  assert.equal(isTileCoordinates("not-a-point"), false);

  const denied = denyPayload("ACCESS_UNAUTHORIZED", "ac...");
  assert.equal(denied.allow, false);
  assert.equal(denied.denyReason, "ACCESS_UNAUTHORIZED");
  assert.equal(denied.reasonMessage, "Request denied: ACCESS_UNAUTHORIZED");

  const deliverySignal = createDeliverySignal({
    artifactVersion: " artifact-a ",
    tilePath: " /tiles/1/2/3.mvt ",
    cacheStatus: "hit",
    originRead: false,
    responseBytes: 123,
    latencyMs: 45,
    statusCode: 200,
    normalizedMethod: "GET",
  });
  assert.equal(deliverySignal.schemaVersion, SCHEMA_VERSION);
  assert.equal(deliverySignal.artifactVersion, "artifact-a");
  assert.equal(deliverySignal.tilePath, "/tiles/1/2/3.mvt");
  const serialized = toDeliverySignalJson(deliverySignal);
  const parsed = parseDeliverySignal(serialized);
  assert.equal(parsed.artifactVersion, deliverySignal.artifactVersion);
  assert.equal(parsed.tilePath, deliverySignal.tilePath);
  assert.equal(parsed.schemaVersion, SCHEMA_VERSION);

  let parseFailed = false;
  try {
    parseDeliverySignal("{");
  } catch (error: unknown) {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, ContractErrorCode.SCHEMA_INVALID);
    parseFailed = true;
  }
  assert.equal(parseFailed, true);

  const invalidSchemaSerialized = JSON.stringify({
    ...deliverySignal,
    schemaVersion: SCHEMA_VERSION,
    responseBytes: -1,
  });
  let invalidParseFailed = false;
  try {
    parseDeliverySignal(invalidSchemaSerialized);
  } catch (error: unknown) {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, ContractErrorCode.SCHEMA_INVALID);
    invalidParseFailed = true;
  }
  assert.equal(invalidParseFailed, true);

  const unsupportedVersionSerialized = JSON.stringify({
    ...deliverySignal,
    schemaVersion: 2,
  });
  let unsupportedVersionFailed = false;
  try {
    parseDeliverySignal(unsupportedVersionSerialized);
  } catch (error: unknown) {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, ContractErrorCode.VERSION_UNSUPPORTED);
    unsupportedVersionFailed = true;
  }
  assert.equal(unsupportedVersionFailed, true);

  const artifactRegistered = createArtifactRegisteredEvent({
    versionId: "artifact-a",
    key: "artifacts/artifact-a/tiles.pmtiles",
  });
  assert.equal(artifactRegistered.versionId, "artifact-a");
  assert.equal(artifactRegistered.eventType, "artifact.registered");

  const artifactPromoted = createArtifactPromotedEvent({
    versionId: " artifact-b ",
    key: " artifacts/artifact-b/tiles.pmtiles ",
  });
  assert.equal(artifactPromoted.eventType, "artifact.promoted");
  assert.equal(artifactPromoted.versionId, "artifact-b");
  assert.equal(artifactPromoted.key, "artifacts/artifact-b/tiles.pmtiles");
  assert.equal(artifactPromoted.activeVersionId, null);

  const artifactRolledBack = createArtifactRollbackEvent({
    versionId: "artifact-c",
    key: "artifacts/artifact-c/tiles.pmtiles",
    actor: " ops ",
    activeVersionId: " artifact-b ",
  });
  assert.equal(artifactRolledBack.actor, "ops");
  assert.equal(artifactRolledBack.activeVersionId, "artifact-b");

  const ingestEvent = createIngestCompletedEvent({
    snapshotId: " snapshot-a ",
    artifactVersion: " artifact-a ",
    artifactKey: " artifacts/artifact-a/tiles.pmtiles ",
    checksum: " abc ",
    byteSize: 1024,
    validated: true,
  });
  assert.equal(ingestEvent.schemaVersion, SCHEMA_VERSION);
  assert.equal(ingestEvent.eventType, "ingest.completed");
  assert.equal(ingestEvent.snapshotId, "snapshot-a");
  assert.equal(ingestEvent.artifactVersion, "artifact-a");
  assert.equal(ingestEvent.artifactKey, "artifacts/artifact-a/tiles.pmtiles");
  assert.equal(ingestEvent.checksum, "abc");

  let invalidDeliveryFailed = false;
  try {
    createDeliverySignal({
      artifactVersion: "artifact-a",
      tilePath: "/tiles/1/2/3.mvt",
      cacheStatus: "miss",
      originRead: true,
      responseBytes: -1,
      latencyMs: 10,
      statusCode: 200,
      normalizedMethod: "GET",
    });
  } catch (error: unknown) {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, ContractErrorCode.SCHEMA_INVALID);
    invalidDeliveryFailed = true;
  }
  assert.equal(invalidDeliveryFailed, true);

  let invalidDeliveryPathFailed = false;
  try {
    createDeliverySignal({
      artifactVersion: "artifact-a",
      tilePath: "tiles/1/2/3.mvt",
      cacheStatus: "miss",
      originRead: true,
      responseBytes: 1,
      latencyMs: 1,
      statusCode: 200,
      normalizedMethod: "GET",
    });
  } catch (error: unknown) {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, ContractErrorCode.SCHEMA_INVALID);
    invalidDeliveryPathFailed = true;
  }
  assert.equal(invalidDeliveryPathFailed, true);

  let invalidArtifactEventFailed = false;
  try {
    createArtifactRegisteredEvent({
      versionId: " ",
      key: "artifacts/a/tiles.pmtiles",
    });
  } catch (error: unknown) {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, ContractErrorCode.SCHEMA_INVALID);
    invalidArtifactEventFailed = true;
  }
  assert.equal(invalidArtifactEventFailed, true);

  let invalidIngestEventFailed = false;
  try {
    createIngestCompletedEvent({
      snapshotId: "snapshot-a",
      artifactVersion: "artifact-a",
      artifactKey: "artifacts/artifact-a/tiles.pmtiles",
      checksum: "abc",
      byteSize: -1,
      validated: true,
    });
  } catch (error: unknown) {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, ContractErrorCode.SCHEMA_INVALID);
    invalidIngestEventFailed = true;
  }
  assert.equal(invalidIngestEventFailed, true);

  const invalidPathSerialized = JSON.stringify({
    ...deliverySignal,
    tilePath: "tiles/1/2/3.mvt",
  });
  let invalidPathParseFailed = false;
  try {
    parseDeliverySignal(invalidPathSerialized);
  } catch (error: unknown) {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, ContractErrorCode.SCHEMA_INVALID);
    invalidPathParseFailed = true;
  }
  assert.equal(invalidPathParseFailed, true);
});
