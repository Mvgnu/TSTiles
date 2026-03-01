import { readFile } from "node:fs/promises";
import { IngestError, IngestErrorCode, type PlanetSnapshot } from "../types";

const toBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

async function fetchFromUrl(url: string): Promise<Uint8Array> {
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
  try {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "snapshot response unreadable");
  }
}

async function fetchFromFile(url: string): Promise<Uint8Array> {
  const path = decodeURIComponent(url.replace(/^file:\/\//i, ""));
  try {
    const content = await readFile(path);
    return new Uint8Array(content);
  } catch {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "snapshot file unavailable");
  }
}

function decodeDataPayload(url: string): Uint8Array {
  const comma = url.indexOf(",");
  const header = url.substring(0, Math.max(comma, 0));
  const payload = comma >= 0 ? url.slice(comma + 1) : "";
  const normalizedHeader = header.toLowerCase();
  if (normalizedHeader.includes(";base64")) {
    return new Uint8Array(Buffer.from(payload, "base64"));
  }
  try {
    return toBytes(decodeURIComponent(payload));
  } catch {
    return toBytes(payload);
  }
}

export async function fetchPlanet(snapshot: PlanetSnapshot): Promise<Uint8Array> {
  const sourceUrl = snapshot.sourceUrl.trim();
  if (!sourceUrl) {
    throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "sourceUrl missing");
  }
  const normalizedSource = sourceUrl.toLowerCase();
  if (normalizedSource.startsWith("http://") || normalizedSource.startsWith("https://")) {
    return fetchFromUrl(sourceUrl);
  }
  if (normalizedSource.startsWith("file://")) {
    return fetchFromFile(sourceUrl);
  }
  if (normalizedSource.startsWith("data:")) {
    return decodeDataPayload(sourceUrl);
  }
  throw new IngestError(IngestErrorCode.SOURCE_UNAVAILABLE, "unsupported source scheme");
}
