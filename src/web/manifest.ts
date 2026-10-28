import type { MapManifest, VectorLayer } from "../contract.js";

export const MAX_MANIFEST_BYTES = 1024 * 1024;

export class ManifestError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ManifestError(label + " must be an object.");
  }
  return value;
}

function text(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new ManifestError(label + " must be " + (allowEmpty ? "text." : "non-empty text."));
  }
  return value;
}

function number(value: unknown, label: string, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)
      || value < minimum || value > maximum || (integer && !Number.isSafeInteger(value))) {
    throw new ManifestError(label + " must be " + (integer ? "an integer" : "a number")
      + " between " + minimum + " and " + maximum + ".");
  }
  return value;
}

function array(value: unknown, label: string, length?: number): readonly unknown[] {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) {
    throw new ManifestError(label + " must be an array" + (length === undefined ? "." : " of " + length + " values."));
  }
  return value;
}

function parseLayer(value: unknown, index: number): VectorLayer {
  const label = "vectorLayers[" + index + "]";
  const input = record(value, label);
  const id = text(input.id, label + ".id");
  const description = input.description === undefined ? undefined : text(input.description, label + ".description", true);
  const minzoom = input.minzoom === undefined ? undefined : number(input.minzoom, label + ".minzoom", 0, 26, true);
  const maxzoom = input.maxzoom === undefined ? undefined : number(input.maxzoom, label + ".maxzoom", 0, 26, true);
  if (minzoom !== undefined && maxzoom !== undefined && minzoom > maxzoom) {
    throw new ManifestError(label + ".minzoom cannot exceed maxzoom.");
  }
  const fields = input.fields === undefined ? undefined : Object.fromEntries(
    Object.entries(record(input.fields, label + ".fields")).map(([key, field]) => [key, text(field, label + ".fields." + key, true)]),
  );
  return { id, description, minzoom, maxzoom, fields };
}

/** Parse untrusted JSON once. All consumers share the PM-owned contract. */
export function parseManifest(value: unknown): MapManifest {
  const input = record(value, "Manifest");
  if (input.schemaVersion !== 1) {
    throw new ManifestError("Unsupported manifest schemaVersion. Expected 1.");
  }
  if (input.tileType !== "mvt") {
    throw new ManifestError("This viewer supports vector PMTiles (tileType: mvt).");
  }
  const sha256 = text(input.sha256, "sha256");
  if (!/^[a-f0-9]{64}$/iu.test(sha256)) {
    throw new ManifestError("sha256 must contain exactly 64 hexadecimal characters.");
  }
  const minZoom = number(input.minZoom, "minZoom", 0, 26, true);
  const maxZoom = number(input.maxZoom, "maxZoom", 0, 26, true);
  if (minZoom > maxZoom) {
    throw new ManifestError("minZoom cannot exceed maxZoom.");
  }
  const rawBounds = array(input.bounds, "bounds", 4);
  const bounds: MapManifest["bounds"] = [
    number(rawBounds[0], "bounds[0] (west)", -180, 180),
    number(rawBounds[1], "bounds[1] (south)", -90, 90),
    number(rawBounds[2], "bounds[2] (east)", -180, 180),
    number(rawBounds[3], "bounds[3] (north)", -90, 90),
  ];
  if (bounds[0] > bounds[2] || bounds[1] > bounds[3]) {
    throw new ManifestError("bounds must be ordered west, south, east, north.");
  }
  const rawCenter = array(input.center, "center", 3);
  const center: MapManifest["center"] = [
    number(rawCenter[0], "center[0] (longitude)", -180, 180),
    number(rawCenter[1], "center[1] (latitude)", -90, 90),
    number(rawCenter[2], "center[2] (zoom)", 0, 26),
  ];
  const style = input.style === undefined ? undefined : text(input.style, "style");
  const vectorLayers = array(input.vectorLayers, "vectorLayers").map(parseLayer);
  if (new Set(vectorLayers.map((layer) => layer.id)).size !== vectorLayers.length) {
    throw new ManifestError("vectorLayers must have unique layer IDs.");
  }
  if (vectorLayers.length === 0 && style === undefined) {
    throw new ManifestError("A data preview needs vectorLayers metadata. Supply a compatible style or republish with layer metadata.");
  }
  return {
    schemaVersion: 1,
    id: text(input.id, "id"),
    name: text(input.name, "name"),
    archive: text(input.archive, "archive"),
    sha256,
    bytes: number(input.bytes, "bytes", 1, Number.MAX_SAFE_INTEGER, true),
    tileType: "mvt",
    minZoom,
    maxZoom,
    bounds,
    center,
    vectorLayers,
    attribution: text(input.attribution, "attribution"),
    style,
  };
}

export function resolveHttpUrl(value: string, base: string): string {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new ManifestError("Invalid URL: " + value);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ManifestError("Map resources must use HTTP or HTTPS URLs.");
  }
  if (url.username || url.password) {
    throw new ManifestError("Map URLs cannot contain a username or password. Publish browser-readable resources.");
  }
  if (url.hash) {
    throw new ManifestError("Map resource URLs cannot contain a fragment.");
  }
  return url.href;
}

export interface ResolvedManifest {
  readonly manifest: MapManifest;
  readonly manifestUrl: string;
  readonly archiveUrl: string;
  readonly styleUrl?: string;
}

export function resolveManifest(manifest: MapManifest, manifestUrl: string): ResolvedManifest {
  return {
    manifest,
    manifestUrl,
    archiveUrl: resolveHttpUrl(manifest.archive, manifestUrl),
    styleUrl: manifest.style === undefined ? undefined : resolveHttpUrl(manifest.style, manifestUrl),
  };
}

/** Bound the response while streaming, including servers without Content-Length. */
export async function readManifestResponse(response: Response): Promise<MapManifest> {
  if (!response.ok) {
    throw new ManifestError("Manifest request returned HTTP " + response.status + ". Check its URL and host configuration.");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_MANIFEST_BYTES) {
    await response.body?.cancel();
    throw new ManifestError("Manifest exceeds the 1 MiB limit.");
  }
  if (!response.body) {
    throw new ManifestError("The manifest response is empty.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let contents = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MANIFEST_BYTES) {
        await reader.cancel();
        throw new ManifestError("Manifest exceeds the 1 MiB limit.");
      }
      contents += decoder.decode(value, { stream: true });
    }
    contents += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new ManifestError("The manifest is not valid JSON. Check that its URL serves a map manifest rather than an HTML page.");
  }
  return parseManifest(parsed);
}

export async function loadManifest(manifestUrl: string, baseUrl: string, signal?: AbortSignal): Promise<ResolvedManifest> {
  const requestedUrl = resolveHttpUrl(manifestUrl, baseUrl);
  let response: Response;
  try {
    response = await fetch(requestedUrl, { signal, credentials: "omit", cache: "no-cache" });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ManifestError("The manifest could not be fetched. Check its URL, HTTPS and cross-origin (CORS) headers.");
  }
  const manifest = await readManifestResponse(response);
  const finalUrl = resolveHttpUrl(response.url || requestedUrl, requestedUrl);
  return resolveManifest(manifest, finalUrl);
}
