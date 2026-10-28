import {
  type DeliverySignal,
  type HttpMethod,
  ContractError,
  ContractErrorCode,
  CONTRACT_SCHEMA_VERSION,
} from "../types";

function isHttpMethod(value: unknown): value is HttpMethod {
  return value === "GET" || value === "HEAD" || value === "OPTIONS";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDeliverySignalPayload(value: unknown): value is DeliverySignal {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.schemaVersion !== "number" ||
    typeof value.artifactVersion !== "string" ||
    value.artifactVersion.length === 0 ||
    typeof value.tilePath !== "string" ||
    value.tilePath.length === 0 ||
    !value.tilePath.startsWith("/") ||
    (value.cacheStatus !== "hit" && value.cacheStatus !== "miss") ||
    typeof value.originRead !== "boolean" ||
    typeof value.responseBytes !== "number" ||
    !Number.isFinite(value.responseBytes) ||
    !Number.isInteger(value.responseBytes) ||
    value.responseBytes < 0 ||
    typeof value.latencyMs !== "number" ||
    !Number.isFinite(value.latencyMs) ||
    !Number.isInteger(value.latencyMs) ||
    value.latencyMs < 0 ||
    typeof value.statusCode !== "number" ||
    !Number.isFinite(value.statusCode) ||
    !Number.isInteger(value.statusCode) ||
    value.statusCode < 100 ||
    value.statusCode > 599 ||
    typeof value.receivedAt !== "string" ||
    value.receivedAt.length === 0 ||
    Number.isNaN(Date.parse(value.receivedAt)) ||
    !isHttpMethod(value.normalizedMethod)
  ) {
    return false;
  }

  return true;
}

function createContractError(
  code: ContractErrorCode,
  message: string,
): ContractError {
  return new ContractError(code, message);
}

export function toDeliverySignalJson(signal: DeliverySignal): string {
  return JSON.stringify(signal);
}

export function parseDeliverySignal(json: string): DeliverySignal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw createContractError(
      ContractErrorCode.SCHEMA_INVALID,
      "Unable to parse JSON for delivery signal",
    );
  }

  if (!isDeliverySignalPayload(parsed)) {
    throw createContractError(
      ContractErrorCode.SCHEMA_INVALID,
      "Invalid payload for delivery signal",
    );
  }

  if (parsed.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    throw createContractError(
      ContractErrorCode.VERSION_UNSUPPORTED,
      `Unsupported delivery-signal schema version ${String(parsed.schemaVersion)}`,
    );
  }

  return parsed;
}
