import type { RenderFormat } from "../types";
import { encodeRgbaToImage } from "./raster-encoder";
import { RendererUnavailableError, renderCartographic } from "./maplibre-native-renderer";

export interface RenderInput {
  readonly styleId: string;
  readonly styleVersionKey: string;
  readonly artifactId: string;
  readonly sourcePath: string;
  readonly format: RenderFormat;
  readonly width?: number;
  readonly height?: number;
  readonly overlays?: ReadonlyArray<string>;
  readonly styleVersionId?: string;
  readonly tileZ?: number;
  readonly tileX?: number;
  readonly tileY?: number;
  readonly viewLon?: number;
  readonly viewLat?: number;
  readonly viewZoom?: number;
}

export interface RenderAdapterOutput {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export class RenderBackendUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RenderBackendUnavailableError";
  }
}

function tileToLonLatCenter(z: number, x: number, y: number): { readonly lon: number; readonly lat: number } {
  const n = 2 ** z;
  const tileX = x + 0.5;
  const tileY = y + 0.5;
  const lon = (tileX / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lon, lat };
}

function resolveViewport(
  input: RenderInput,
  defaultWidth: number,
  defaultHeight: number,
): { readonly center: readonly [number, number]; readonly zoom: number; readonly width: number; readonly height: number } {
  if (
    typeof input.viewLon === "number"
    && typeof input.viewLat === "number"
    && typeof input.viewZoom === "number"
    && Number.isFinite(input.viewLon)
    && Number.isFinite(input.viewLat)
    && Number.isFinite(input.viewZoom)
  ) {
    return {
      center: [input.viewLon, input.viewLat],
      zoom: input.viewZoom,
      width: input.width ?? defaultWidth,
      height: input.height ?? defaultHeight,
    };
  }
  if (
    typeof input.tileZ === "number"
    && typeof input.tileX === "number"
    && typeof input.tileY === "number"
    && Number.isInteger(input.tileZ)
    && Number.isInteger(input.tileX)
    && Number.isInteger(input.tileY)
  ) {
    const { lon, lat } = tileToLonLatCenter(input.tileZ, input.tileX, input.tileY);
    return {
      center: [lon, lat],
      zoom: input.tileZ,
      width: input.width ?? 256,
      height: input.height ?? 256,
    };
  }
  throw new RenderBackendUnavailableError("viewport input is required for cartographic rendering");
}

export async function renderLocally(input: RenderInput): Promise<RenderAdapterOutput> {
  const width = input.width ?? 256;
  const height = input.height ?? 256;
  const viewport = resolveViewport(input, width, height);
  let result;
  try {
    result = await renderCartographic({
      styleId: input.styleId,
      styleVersionId: input.styleVersionId,
      artifactId: input.artifactId,
      width: viewport.width,
      height: viewport.height,
      center: viewport.center,
      zoom: viewport.zoom,
    });
  } catch (error) {
    if (error instanceof RendererUnavailableError) {
      throw new RenderBackendUnavailableError(error.message);
    }
    throw error;
  }
  const encoded = await encodeRgbaToImage(result.width, result.height, result.rgba, input.format);
  return {
    bytes: encoded.bytes,
    contentType: encoded.contentType,
  };
}
