import { readFile, stat } from "node:fs/promises";
import { IngestError, IngestErrorCode, type PlanetSnapshot } from "../types";

const toBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

function assertWithinSourceLimit(byteLength: number, maxSourceBytes: number): void {
  if (byteLength <= maxSourceBytes) {
    return;
  }
  throw new IngestError(
    IngestErrorCode.SOURCE_TOO_LARGE,
    `snapshot source exceeds limit (${byteLength} > ${maxSourceBytes})`,
  );
}

function parsePositiveContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

async function fetchFromUrl(url: string, maxSourceBytes: number): Promise<Uint8Array> {
  const fetchFn = globalThis.fetch;
  if (!fetchFn) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "fetch is unavailable in runtime");
  }
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "snapshot fetch failed");
  }
  if (!response.ok) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, `snapshot fetch failed: ${response.status}`);
  }
  const responseLength = parsePositiveContentLength(response.headers.get("content-length"));
  if (responseLength !== undefined) {
    assertWithinSourceLimit(responseLength, maxSourceBytes);
  }
  try {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    assertWithinSourceLimit(bytes.byteLength, maxSourceBytes);
    return bytes;
  } catch {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "snapshot response unreadable");
  }
}

async function fetchFromFile(url: string, maxSourceBytes: number): Promise<Uint8Array> {
  const path = decodeURIComponent(url.replace(/^file:\/\//i, ""));
  try {
    const fileStats = await stat(path);
    assertWithinSourceLimit(fileStats.size, maxSourceBytes);
    const content = await readFile(path);
    const bytes = new Uint8Array(content);
    assertWithinSourceLimit(bytes.byteLength, maxSourceBytes);
    return bytes;
  } catch (error) {
    if (error instanceof IngestError) {
      throw error;
    }
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "snapshot file unavailable");
  }
}

function decodeDataPayload(url: string, maxSourceBytes: number): Uint8Array {
  const comma = url.indexOf(",");
  const header = url.substring(0, Math.max(comma, 0));
  const payload = comma >= 0 ? url.slice(comma + 1) : "";
  const normalizedHeader = header.toLowerCase();
  if (normalizedHeader.includes(";base64")) {
    const bytes = new Uint8Array(Buffer.from(payload, "base64"));
    assertWithinSourceLimit(bytes.byteLength, maxSourceBytes);
    return bytes;
  }
  try {
    const bytes = toBytes(decodeURIComponent(payload));
    assertWithinSourceLimit(bytes.byteLength, maxSourceBytes);
    return bytes;
  } catch {
    const bytes = toBytes(payload);
    assertWithinSourceLimit(bytes.byteLength, maxSourceBytes);
    return bytes;
  }
}

export async function fetchPlanet(snapshot: PlanetSnapshot, maxSourceBytes: number): Promise<Uint8Array> {
  const sourceUrl = snapshot.sourceUrl.trim();
  if (!sourceUrl) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "sourceUrl missing");
  }
  if (!Number.isFinite(maxSourceBytes) || !Number.isInteger(maxSourceBytes) || maxSourceBytes <= 0) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "invalid max source size");
  }
  const normalizedSource = sourceUrl.toLowerCase();
  if (normalizedSource.startsWith("http://") || normalizedSource.startsWith("https://")) {
    return fetchFromUrl(sourceUrl, maxSourceBytes);
  }
  if (normalizedSource.startsWith("file://")) {
    return fetchFromFile(sourceUrl, maxSourceBytes);
  }
  if (normalizedSource.startsWith("data:")) {
    return decodeDataPayload(sourceUrl, maxSourceBytes);
  }
  throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "unsupported source scheme");
}
