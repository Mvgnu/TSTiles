import type { HttpMethod } from "../../contracts/types";

export const enum RasterApiErrorCode {
  BAD_COORDINATES = "RASTER_BAD_COORDINATES",
  BAD_REQUEST = "RASTER_BAD_REQUEST",
  RENDER_FAILED = "RASTER_RENDER_FAILED",
  STYLE_NOT_FOUND = "RASTER_STYLE_NOT_FOUND",
  STATIC_BAD_REQUEST = "STATIC_BAD_REQUEST",
  HEAD_DISABLED = "HEAD_DISABLED",
}

export class RasterApiError extends Error {
  public readonly code: RasterApiErrorCode;

  public constructor(code: RasterApiErrorCode) {
    super(code);
    this.code = code;
    this.name = "RasterApiError";
  }
}

export interface RasterRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | string[] | undefined>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly clientIp?: string;
}

export interface RasterResponse {
  readonly status: number;
  readonly body?: Uint8Array;
  readonly headers: Record<string, string>;
}
