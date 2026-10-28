export type RenderFormat = "png" | "webp";

export const enum RenderErrorCode {
  STYLE_NOT_FOUND = "RENDER_STYLE_NOT_FOUND",
  TILE_RESOLVE_FAILED = "RENDER_TILE_RESOLVE_FAILED",
  BACKEND_UNAVAILABLE = "RENDER_BACKEND_UNAVAILABLE",
  BAD_REQUEST = "RENDER_BAD_REQUEST",
}

export class RenderError extends Error {
  public readonly code: RenderErrorCode;
  public readonly details?: string;

  public constructor(code: RenderErrorCode, details?: string) {
    super(details ? `${code}:${details}` : code);
    this.code = code;
    this.details = details;
    this.name = "RenderError";
  }
}

export interface RasterTileCoordinates {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export interface RasterTileRequest {
  readonly styleId: string;
  readonly z: number;
  readonly x: number;
  readonly y: number;
  readonly format: RenderFormat;
  readonly versionId?: string;
}

export interface StaticMapRequest {
  readonly styleId: string;
  readonly lon: number;
  readonly lat: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
  readonly overlays?: ReadonlyArray<string>;
  readonly format: RenderFormat;
  readonly versionId?: string;
}

export interface RenderedImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly cacheKey: string;
  readonly styleId: string;
  readonly styleVersionKey: string;
  readonly artifactId: string;
  readonly sourcePath: string;
  readonly format: RenderFormat;
}
