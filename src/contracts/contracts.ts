import type {
  AuthorizeResult,
  DenyReason,
  DeliverySignal,
  HttpMethod,
  IngestEvent,
  TileCoordinates,
} from "./types";
import { CONTRACT_SCHEMA_VERSION, ContractError, ContractErrorCode } from "./types";

export function normalizeHeaderMap(headers: Record<string, string | undefined>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[name.toLowerCase()] = value.trim();
    }
  }
  return normalized;
}

export function sanitizeToken(token?: string): string {
  if (!token) {
    return "anon";
  }
  if (token.length <= 12) {
    return `${token[0] ?? "?"}...`;
  }
  const head = token.slice(0, 4);
  const tail = token.slice(-4);
  return `${head}…${tail}`;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTileCoordinates(value: unknown): value is TileCoordinates {
  if (!isRecord(value)) {
    return false;
  }
  const z = value.z;
  const x = value.x;
  const y = value.y;
  return isNonNegativeInteger(z) && isNonNegativeInteger(x) && isNonNegativeInteger(y);
}

export function createDeliverySignal(input: {
  artifactVersion: string;
  tilePath: string;
  cacheStatus: "hit" | "miss";
  originRead: boolean;
  responseBytes: number;
  latencyMs: number;
  statusCode: number;
  normalizedMethod: HttpMethod;
}): DeliverySignal {
  if (input.artifactVersion.trim().length === 0) {
    throw new ContractError(ContractErrorCode.SCHEMA_INVALID, "artifactVersion is required");
  }
  if (input.tilePath.trim().length === 0) {
    throw new ContractError(ContractErrorCode.SCHEMA_INVALID, "tilePath is required");
  }
  if (!input.tilePath.trim().startsWith("/")) {
    throw new ContractError(ContractErrorCode.SCHEMA_INVALID, "tilePath must be an absolute path");
  }
  if (!Number.isInteger(input.responseBytes) || input.responseBytes < 0) {
    throw new ContractError(ContractErrorCode.SCHEMA_INVALID, "responseBytes must be a non-negative integer");
  }
  if (!Number.isInteger(input.latencyMs) || input.latencyMs < 0) {
    throw new ContractError(ContractErrorCode.SCHEMA_INVALID, "latencyMs must be a non-negative integer");
  }
  if (!Number.isInteger(input.statusCode) || input.statusCode < 100 || input.statusCode > 599) {
    throw new ContractError(ContractErrorCode.SCHEMA_INVALID, "statusCode must be an HTTP status code");
  }
  const artifactVersion = input.artifactVersion.trim();
  const tilePath = input.tilePath.trim();
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    artifactVersion,
    tilePath,
    cacheStatus: input.cacheStatus,
    originRead: input.originRead,
    responseBytes: input.responseBytes,
    latencyMs: input.latencyMs,
    statusCode: input.statusCode,
    normalizedMethod: input.normalizedMethod,
    receivedAt: new Date().toISOString(),
  };
}

export function denyPayload(reason: DenyReason, sanitizedIdentity?: string): AuthorizeResult {
  return {
    allow: false,
    denyReason: reason,
    sanitizedIdentity,
    reasonMessage: `Request denied: ${reason}`,
  };
}

export function redactIngestEvent(event: IngestEvent): IngestEvent {
  return {
    ...event,
    snapshotId: "redacted",
    checksum: "redacted",
  };
}

import { EventEmitter } from "node:events";
export const contractEventEmitter = new EventEmitter();

