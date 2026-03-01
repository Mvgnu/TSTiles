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

function isDeliverySignalPayload(value: unknown): value is DeliverySignal {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.schemaVersion !== "number" ||
    typeof candidate.artifactVersion !== "string" ||
    candidate.artifactVersion.length === 0 ||
    typeof candidate.tilePath !== "string" ||
    candidate.tilePath.length === 0 ||
    !candidate.tilePath.startsWith("/") ||
    (candidate.cacheStatus !== "hit" && candidate.cacheStatus !== "miss") ||
    typeof candidate.originRead !== "boolean" ||
    typeof candidate.responseBytes !== "number" ||
    !Number.isFinite(candidate.responseBytes) ||
    !Number.isInteger(candidate.responseBytes) ||
    candidate.responseBytes < 0 ||
    typeof candidate.latencyMs !== "number" ||
    !Number.isFinite(candidate.latencyMs) ||
    !Number.isInteger(candidate.latencyMs) ||
    candidate.latencyMs < 0 ||
    typeof candidate.statusCode !== "number" ||
    !Number.isFinite(candidate.statusCode) ||
    !Number.isInteger(candidate.statusCode) ||
    candidate.statusCode < 100 ||
    candidate.statusCode > 599 ||
    typeof candidate.receivedAt !== "string" ||
    candidate.receivedAt.length === 0 ||
    Number.isNaN(Date.parse(candidate.receivedAt)) ||
    !isHttpMethod(candidate.normalizedMethod)
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
