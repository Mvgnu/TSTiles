import { createObjectStore } from "../../storage/storage.service";
import { loadConfig } from "../../../config/load-config";
import { resolveArchiveTile } from "../../tile-resolver/pmtiles/archive-source";
import { listArtifacts } from "../../artifact/artifact.service";
import { getStyle, resolveStyleAssets } from "../../styles/styles.service";
import { handleStyleRequest } from "../../styles/styles-route.service";
import type { ArtifactVersion } from "../../artifact/types";
import type { StyleDocument } from "../../styles/types";

interface MaplibreRequest {
  readonly url: string;
  readonly kind: number;
}

interface MaplibreResponse {
  readonly data?: Buffer;
}

type MaplibreCallback = (error: Error | null, response?: MaplibreResponse) => void;

interface MaplibreMapOptions {
  readonly request: (req: MaplibreRequest, callback: MaplibreCallback) => void;
  readonly ratio?: number;
}

interface MaplibreRenderOptions {
  readonly zoom: number;
  readonly center: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly bearing?: number;
  readonly pitch?: number;
}

interface MaplibreMap {
  load(style: unknown): void;
  render(options: MaplibreRenderOptions, callback: (error: Error | null, buffer?: Buffer) => void): void;
  release(): void;
}

interface MaplibreModule {
  readonly Map: new (options: MaplibreMapOptions) => MaplibreMap;
}

export interface CartographicRenderInput {
  readonly styleId: string;
  readonly styleVersionId?: string;
  readonly artifactId: string;
  readonly width: number;
  readonly height: number;
  readonly center: readonly [number, number];
  readonly zoom: number;
}

export interface CartographicRenderResult {
  /** Raw RGBA pixel buffer (4 bytes per pixel, width*height*4 total). */
  readonly rgba: Uint8Array;
  readonly width: number;
  readonly height: number;
}

const MAPLIBRE_INTERNAL_HOST = "http://maplibre-internal";

let cachedModule: MaplibreModule | null | undefined = undefined;
let availabilityLogged = false;

function loadMaplibreModule(): MaplibreModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@maplibre/maplibre-gl-native") as MaplibreModule;
    if (mod && typeof mod.Map === "function") {
      cachedModule = mod;
      if (!availabilityLogged) {
        availabilityLogged = true;
        console.info("[render] maplibre-native binding loaded; cartographic rendering active.");
      }
      return mod;
    }
    cachedModule = null;
    return null;
  } catch (error) {
    cachedModule = null;
    if (!availabilityLogged) {
      availabilityLogged = true;
      const message = error instanceof Error ? error.message : "unknown";
      console.error(
        `[render] FATAL: @maplibre/maplibre-gl-native binding unavailable (${message}). Raster and static map endpoints will return RENDER_BACKEND_UNAVAILABLE. Install Node 20 LTS or 22 with the prebuilt binary, or build the binding from source.`,
      );
    }
    return null;
  }
}

export class RendererUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RendererUnavailableError";
  }
}

export function isCartographicRendererAvailable(): boolean {
  return loadMaplibreModule() !== null;
}

interface ParsedTileUrl {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

function parseTileUrl(url: string): ParsedTileUrl | null {
  const match = /\/(\d+)\/(\d+)\/(\d+)(?:\.[a-z0-9]+)?(?:\?.*)?$/.exec(url);
  if (!match) {
    return null;
  }
  const z = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return null;
  }
  return { z, x, y };
}

async function resolveArtifact(artifactId: string): Promise<ArtifactVersion | null> {
  const artifacts = await listArtifacts();
  return artifacts.find((entry) => entry.id === artifactId) ?? null;
}

async function buildBrowserStyle(
  styleId: string,
  styleVersionId: string | undefined,
): Promise<StyleDocument> {
  const document = await getStyle(styleId, styleVersionId);
  await resolveStyleAssets(styleId, styleVersionId);
  const tileTemplate = `${MAPLIBRE_INTERNAL_HOST}/v1/tiles/{z}/{x}/{y}.mvt`;
  // Sprite + glyph URLs the maplibre callback knows how to resolve back to
  // the styles domain's static asset path. The styles-route handler picks
  // the correct sprite variant from the styleId, so we keep `{styleId}`
  // in the placeholder but materialize the concrete styleId here so the
  // request callback receives a path it can pattern-match directly.
  const spriteBase = `${MAPLIBRE_INTERNAL_HOST}/v1/styles/${encodeURIComponent(styleId)}/sprites/sprite`;
  const glyphTemplate = `${MAPLIBRE_INTERNAL_HOST}/v1/fonts/{fontstack}/{range}.pbf`;
  const sources: Record<string, unknown> = {};
  for (const [key, source] of Object.entries(document.sources ?? {})) {
    if (source && typeof source === "object" && (source as { type?: unknown }).type === "vector") {
      sources[key] = {
        ...source,
        tiles: [tileTemplate],
        url: undefined,
      };
    } else {
      sources[key] = source;
    }
  }
  return {
    ...document,
    sources,
    glyphs: glyphTemplate,
    sprite: spriteBase,
  } as StyleDocument;
}

async function resolveTileBytes(url: string, artifact: ArtifactVersion): Promise<Buffer | null> {
  const coords = parseTileUrl(url);
  if (!coords) {
    return null;
  }
  const config = loadConfig();
  const store = createObjectStore(config);
  try {
    const result = await resolveArchiveTile(store, artifact, coords.z, coords.x, coords.y);
    return Buffer.from(result.bytes);
  } catch {
    return null;
  }
}

function stripInternalHost(url: string): string {
  if (url.startsWith(MAPLIBRE_INTERNAL_HOST)) {
    return url.slice(MAPLIBRE_INTERNAL_HOST.length);
  }
  return url;
}

async function resolveStyleAssetBytes(url: string): Promise<Buffer | null> {
  const path = stripInternalHost(url);
  if (!path.startsWith("/v1/")) {
    return null;
  }
  try {
    const response = await handleStyleRequest({
      method: "GET",
      path,
      baseUrl: MAPLIBRE_INTERNAL_HOST,
    });
    if (response.status !== 200 || response.body === undefined) {
      return null;
    }
    if (response.body instanceof Uint8Array) {
      return Buffer.from(response.body);
    }
    return Buffer.from(response.body, "utf8");
  } catch {
    return null;
  }
}

/**
 * Render a single static-map view via the native maplibre binding. Throws
 * `RendererUnavailableError` if the binding is not loadable. Throws other
 * errors for runtime failures (style load errors, missing artifact, etc.) so
 * callers can map them to a proper RenderError.
 */
export async function renderCartographic(
  input: CartographicRenderInput,
): Promise<CartographicRenderResult> {
  const mod = loadMaplibreModule();
  if (!mod) {
    throw new RendererUnavailableError("maplibre-native binding is unavailable");
  }
  const artifact = await resolveArtifact(input.artifactId);
  if (!artifact) {
    throw new Error(`artifact unavailable: ${input.artifactId}`);
  }
  const style = await buildBrowserStyle(input.styleId, input.styleVersionId);

  return await new Promise<CartographicRenderResult>((resolve, reject) => {
    const map = new mod.Map({
      ratio: 1,
      request: (req, callback) => {
        // Resource kinds: 1=Unknown, 2=Style, 3=Source, 4=Tile, 5=Glyphs,
        // 6=SpriteImage, 7=SpriteJSON, 8=Image. Tile bytes come from the
        // PMTiles archive directly; everything else (glyphs, sprites, etc.)
        // routes through the styles domain's static asset handler so labels
        // and POI icons render correctly.
        if (req.kind === 4) {
          resolveTileBytes(req.url, artifact)
            .then((bytes) => {
              if (bytes && bytes.byteLength > 0) {
                callback(null, { data: bytes });
                return;
              }
              // Empty buffer = "tile exists but has no features" signal so
              // maplibre doesn't retry. Real fetch failures fall through to
              // the error branch above.
              callback(null, { data: Buffer.alloc(0) });
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "tile fetch failed";
              callback(new Error(message));
            });
          return;
        }
        if (req.kind === 5 || req.kind === 6 || req.kind === 7) {
          resolveStyleAssetBytes(req.url)
            .then((bytes) => {
              callback(null, { data: bytes ?? Buffer.alloc(0) });
            })
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "asset fetch failed";
              callback(new Error(message));
            });
          return;
        }
        // Unknown / Source / Style / Image kinds get an empty buffer so
        // the renderer continues without retrying.
        callback(null, { data: Buffer.alloc(0) });
      },
    });

    let released = false;
    const cleanup = (): void => {
      if (released) {
        return;
      }
      released = true;
      try {
        map.release();
      } catch {
        // best-effort release
      }
    };

    try {
      map.load(style);
    } catch (error: unknown) {
      cleanup();
      reject(error instanceof Error ? error : new Error("style load failed"));
      return;
    }

    map.render(
      {
        zoom: input.zoom,
        center: input.center,
        width: input.width,
        height: input.height,
      },
      (error, buffer) => {
        cleanup();
        if (error || !buffer) {
          reject(error ?? new Error("render produced no buffer"));
          return;
        }
        resolve({
          rgba: new Uint8Array(buffer),
          width: input.width,
          height: input.height,
        });
      },
    );
  });
}
